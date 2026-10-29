import { strToU8, zipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import type { FontProject, FontSource } from "../types";
import { createEmptyProject, normalizeProject } from "../project";
import { exportUfoFiles, importUfoFromFiles } from "./ufo";

export interface DesignspaceImportResult {
  project: FontProject;
  warnings: string[];
}

interface DesignspaceAxis {
  tag?: string;
  name?: string;
  minimum?: number | string;
  maximum?: number | string;
  default?: number | string;
}

interface DesignspaceDimension {
  "@_name"?: string;
  "@_xvalue"?: number | string;
  "@_yvalue"?: number | string;
}

interface DesignspaceSource {
  "@_filename"?: string;
  "@_name"?: string;
  "@_familyname"?: string;
  "@_stylename"?: string;
  location?: { dimension?: DesignspaceDimension | DesignspaceDimension[] };
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dirname(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index + 1);
}

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

/**
 * Import a Designspace folder containing UFO sources.
 *
 * Each source becomes a FontSource with its own glyphs, kerning and axis
 * location. The default source (the one closest to the axis defaults) supplies
 * the project-level metrics and groups.
 */
export function importDesignspaceFromFiles(
  files: Map<string, string | Uint8Array>,
  projectName = "Designspace project"
): DesignspaceImportResult {
  const warnings: string[] = [];
  const designspacePath = [...files.keys()].find((path) =>
    path.toLowerCase().endsWith(".designspace")
  );
  if (!designspacePath) {
    throw new Error("No .designspace file found in the selected folder.");
  }
  const raw = files.get(designspacePath);
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
    parseTagValue: false,
  });
  const parsed = parser.parse(text) as {
    designspace?: {
      axes?: { axis?: DesignspaceAxis | DesignspaceAxis[] };
      sources?: { source?: DesignspaceSource | DesignspaceSource[] };
    };
  };
  const designspace = parsed.designspace;
  if (!designspace) {
    throw new Error("The .designspace file could not be parsed.");
  }
  const axes = asArray(designspace.axes?.axis);
  const axisDefaults = new Map<string, { value: number; range: number }>();
  for (const axis of axes) {
    const name = axis.name;
    if (!name) continue;
    const fallback = numberOr(axis.default, 0);
    const min = numberOr(axis.minimum, fallback);
    const max = numberOr(axis.maximum, fallback);
    axisDefaults.set(name, {
      value: fallback,
      range: Math.max(1, max - min),
    });
  }

  const root = dirname(designspacePath);
  const sourceEntries = asArray(designspace.sources?.source);
  const sources: FontSource[] = [];
  const sourceMeta: Array<{
    name: string;
    filename: string;
    location: Record<string, number>;
    score: number;
  }> = [];

  for (const entry of sourceEntries) {
    const filename = entry["@_filename"];
    if (!filename) {
      warnings.push("Skipped a designspace source without a filename.");
      continue;
    }
    const displayName = entry["@_name"] || entry["@_stylename"] || basename(filename);
    const sourceRoot = `${root}${filename.replaceAll("\\", "/").replace(/\/+$/, "")}/`;
    const sourceFiles = new Map<string, string | Uint8Array>();
    for (const [path, data] of files) {
      const normalized = path.replaceAll("\\", "/");
      if (normalized.startsWith(sourceRoot)) {
        sourceFiles.set(normalized.slice(sourceRoot.length), data);
      }
    }
    if (!sourceFiles.size) {
      // Be forgiving about a designspace that references a directory with a
      // different case or a path relative to the selected folder.
      const suffix = `/${filename.replaceAll("\\", "/").replace(/\/+$/, "")}/`;
      for (const [path, data] of files) {
        const normalized = path.replaceAll("\\", "/");
        const index = normalized.indexOf(suffix);
        if (index !== -1) {
          sourceFiles.set(normalized.slice(index + suffix.length), data);
        }
      }
    }
    if (!sourceFiles.size) {
      warnings.push(`No UFO files found for source "${displayName}" (${filename}).`);
      continue;
    }

    let location: Record<string, number> = {};
    let score = 0;
    const dimensions = asArray(entry.location?.dimension);
    for (const dimension of dimensions) {
      const name = dimension["@_name"];
      if (!name) continue;
      const value = numberOr(dimension["@_xvalue"] ?? dimension["@_yvalue"], 0);
      location[name] = value;
      const axis = axisDefaults.get(name);
      if (axis) {
        score += Math.abs(value - axis.value) / axis.range;
      }
    }

    try {
      const imported = importUfoFromFiles(sourceFiles, displayName);
      warnings.push(...imported.warnings);
      const source = imported.project.sources[0];
      source.name = displayName;
      source.location = Object.keys(location).length ? location : undefined;
      sources.push(source);
      sourceMeta.push({ name: displayName, filename, location, score });
    } catch (error) {
      warnings.push(`Could not import source "${displayName}": ${String(error)}`);
    }
  }

  if (!sources.length) {
    throw new Error("The designspace did not yield any readable UFO sources.");
  }

  let defaultIndex = 0;
  for (let i = 1; i < sourceMeta.length; i++) {
    if (sourceMeta[i].score < sourceMeta[defaultIndex].score) defaultIndex = i;
  }

  const base = createEmptyProject(projectName.replace(/\.designspace$/i, ""));
  const template = createEmptyProject(sources[defaultIndex].name);
  base.unitsPerEm = template.unitsPerEm;
  base.ascender = template.ascender;
  base.descender = template.descender;
  base.xHeight = template.xHeight;
  base.capHeight = template.capHeight;
  // Pull metrics and groups from the default UFO project, which is not kept
  // around by importUfoFromFiles beyond the source itself.
  const defaultRoot = `${root}${sourceMeta[defaultIndex].filename.replace(/\/+$/, "")}/`;
  const defaultFiles = new Map<string, string | Uint8Array>();
  for (const [path, data] of files) {
    const normalized = path.replaceAll("\\", "/");
    if (normalized.startsWith(defaultRoot)) {
      defaultFiles.set(normalized.slice(defaultRoot.length), data);
    }
  }
  if (defaultFiles.size) {
    const defaultProject = importUfoFromFiles(defaultFiles, sources[defaultIndex].name).project;
    base.unitsPerEm = defaultProject.unitsPerEm;
    base.ascender = defaultProject.ascender;
    base.descender = defaultProject.descender;
    base.xHeight = defaultProject.xHeight;
    base.capHeight = defaultProject.capHeight;
    base.groups = defaultProject.groups;
    base.keyGlyphs = defaultProject.keyGlyphs;
    base.tracking = defaultProject.tracking;
  }

  base.sources = sources;
  base.activeSource = defaultIndex;
  base.metadata = {
    ...(base.metadata ?? {}),
    sourceFormat: "designspace",
    axes: JSON.stringify(
      axes.map((axis) => ({
        name: axis.name,
        tag: axis.tag,
        min: numberOr(axis.minimum, 0),
        default: numberOr(axis.default, 0),
        max: numberOr(axis.maximum, 0),
      }))
    ),
  };
  const activeGlyphs = sources[defaultIndex].glyphs;
  if (activeGlyphs.length) {
    const names = new Set(activeGlyphs.map((glyph) => glyph.name));
    base.keyGlyphs = {
      lowerStem: names.has("n") ? "n" : names.has("o") ? "o" : activeGlyphs[0].name,
      lowerRound: names.has("o") ? "o" : names.has("n") ? "n" : activeGlyphs[0].name,
      upperStem: names.has("H") ? "H" : names.has("n") ? "n" : activeGlyphs[0].name,
      upperRound: names.has("O") ? "O" : names.has("o") ? "o" : activeGlyphs[0].name,
    };
  }
  return { project: normalizeProject(base), warnings };
}

interface ExportAxis {
  name: string;
  tag: string;
  min: number;
  default: number;
  max: number;
}

function safeFileName(value: string): string {
  return (
    value
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/^-+|-+$/g, "") || "font"
  );
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function axisTagFor(name: string): string {
  const known: Record<string, string> = {
    Weight: "wght",
    Width: "wdth",
    Slant: "slnt",
    Italic: "ital",
    "Optical Size": "opsz",
    Optical: "opsz",
  };
  if (known[name]) return known[name];
  return safeFileName(name).replaceAll("-", "").slice(0, 4).toLowerCase().padEnd(4, "x");
}

function axesForProject(project: FontProject): ExportAxis[] {
  const fromMetadata: ExportAxis[] = [];
  if (project.metadata?.axes) {
    try {
      const parsed = JSON.parse(project.metadata.axes) as Array<{
        name?: string;
        tag?: string;
        min?: number;
        default?: number;
        max?: number;
      }>;
      for (const axis of parsed) {
        if (!axis.name) continue;
        const value = numberOr(axis.default, 0);
        const min = numberOr(axis.min, value);
        const max = numberOr(axis.max, value);
        fromMetadata.push({
          name: axis.name,
          tag: axis.tag || axisTagFor(axis.name),
          min,
          default: value,
          max,
        });
      }
    } catch {
      // Ignore malformed metadata and infer axes below.
    }
  }
  if (fromMetadata.length) return fromMetadata;

  const names = new Set<string>();
  for (const source of project.sources) {
    for (const name of Object.keys(source.location ?? {})) names.add(name);
  }
  const axes: ExportAxis[] = [];
  for (const name of names) {
    const values = project.sources
      .map((source) => source.location?.[name])
      .filter((value): value is number => typeof value === "number");
    if (!values.length) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const value = values[0];
    axes.push({
      name,
      tag: axisTagFor(name),
      min: min === max ? min - 100 : min,
      default: value,
      max: min === max ? max + 100 : max,
    });
  }
  return axes;
}

/**
 * Export every source as a UFO plus a designspace descriptor in one zip.
 * Round-trips with `importDesignspaceFromFiles` and with Fontra's UFO readers.
 */
export function exportDesignspaceZip(project: FontProject): Uint8Array {
  const axes = axesForProject(project);
  const family = safeFileName(project.name);
  const files: Record<string, Uint8Array> = {};
  const usedFolders = new Set<string>();
  const sourceEntries: Array<{ source: FontSource; folder: string; index: number }> = [];
  for (const [index, source] of project.sources.entries()) {
    let folder = `${family}-${safeFileName(source.name)}.ufo`;
    let suffix = 2;
    while (usedFolders.has(folder)) {
      folder = `${family}-${safeFileName(source.name)}-${suffix}.ufo`;
      suffix += 1;
    }
    usedFolders.add(folder);
    for (const [path, data] of Object.entries(exportUfoFiles(project, index))) {
      files[`${folder}/${path}`] = data;
    }
    sourceEntries.push({ source, folder, index });
  }

  const axisXml = axes
    .map(
      (axis) =>
        `    <axis tag="${escapeXml(axis.tag)}" name="${escapeXml(axis.name)}" minimum="${axis.min}" maximum="${axis.max}" default="${axis.default}"/>`
    )
    .join("\n");
  const sourceXml = sourceEntries
    .map(({ source, folder }) => {
      const dimensions = axes
        .map((axis) => {
          const value = source.location?.[axis.name] ?? axis.default;
          return `        <dimension name="${escapeXml(axis.name)}" xvalue="${value}"/>`;
        })
        .join("\n");
      return `    <source filename="${escapeXml(folder)}" name="${escapeXml(source.name)}" familyname="${escapeXml(project.name)}" stylename="${escapeXml(source.name)}">
${dimensions ? `      <location>\n${dimensions}\n      </location>\n` : ""}    </source>`;
    })
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<designspace format="5.0">
  <axes>
${axisXml}
  </axes>
  <sources>
${sourceXml}
  </sources>
</designspace>
`;
  files[`${family}.designspace`] = strToU8(xml);
  return zipSync(files, { level: 6 });
}

export async function readDesignspaceDirectory(files: FileList): Promise<DesignspaceImportResult> {
  const map = new Map<string, string>();
  let projectName = "Designspace project";
  for (const file of Array.from(files)) {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const parts = relative.split("/");
    if (parts.length > 1) {
      projectName = parts[0].replace(/\.designspace$/i, "");
    }
    const normalized = parts.slice(1).join("/") || file.name;
    const lower = normalized.toLowerCase();
    if (
      lower.endsWith(".designspace") ||
      lower.endsWith(".plist") ||
      lower.endsWith(".glif") ||
      lower.endsWith(".fea") ||
      lower === "fontinfo.plist" ||
      lower.endsWith("lib.plist")
    ) {
      map.set(normalized, await file.text());
    }
  }
  if (![...map.keys()].some((path) => path.toLowerCase().endsWith(".designspace"))) {
    // The user may have selected the folder containing the designspace, in
    // which case the designspace path was not stripped.
    for (const file of Array.from(files)) {
      const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      if (relative.toLowerCase().endsWith(".designspace")) {
        map.set(relative, await file.text());
        projectName = basename(relative).replace(/\.designspace$/i, "");
      }
    }
  }
  return importDesignspaceFromFiles(map, projectName);
}
