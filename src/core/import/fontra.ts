import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Contour, FontProject, Glyph, PathCommand } from "../types";
import { categoryFromGlyph } from "../geometry";
import { createEmptyProject, normalizeProject } from "../project";

interface FontraPoint {
  x: number;
  y: number;
  type?: "cubic" | "quadratic" | "line";
  smooth?: boolean;
}

interface FontraContour {
  points: FontraPoint[];
  isClosed?: boolean;
}

interface FontraGlyphLayer {
  glyph: {
    path?: { contours: FontraContour[] };
    xAdvance?: number;
  };
}

interface FontraGlyphJSON {
  name: string;
  layers: Record<string, FontraGlyphLayer>;
  customData?: Record<string, unknown>;
}

interface FontraFontData {
  sources?: Record<string, { name?: string; lineMetricsHorizontalLayout?: Record<string, { value: number }> }>;
}

export interface FontraImportResult {
  project: FontProject;
  warnings: string[];
}

function isOffCurve(point: FontraPoint): boolean {
  return point.type === "cubic" || point.type === "quadratic";
}

/**
 * Convert Fontra's point-list contour into absolute path commands.
 * In Fontra, off-curve points carry a type ("cubic" or "quadratic"); on-curve
 * points are usually untyped, with `smooth` as metadata.
 */
export function fontraContourToCommands(contour: FontraContour): PathCommand[] {
  const points = contour.points ?? [];
  if (points.length < 2) return [];
  const firstOn = points.findIndex((point) => !isOffCurve(point));
  if (firstOn === -1) return [];
  const start = points[firstOn];
  const commands: PathCommand[] = [{ type: "M", x: start.x, y: start.y }];
  let currentX = start.x;
  let currentY = start.y;
  const n = points.length;
  let index = firstOn;
  let guard = 0;
  while (guard++ < n + 2) {
    const nextIndex = (index + 1) % n;
    if (nextIndex === firstOn) break;
    const next = points[nextIndex];
    if (!isOffCurve(next)) {
      if (next.x !== currentX || next.y !== currentY) {
        commands.push({ type: "L", x: next.x, y: next.y });
        currentX = next.x;
        currentY = next.y;
      }
      index = nextIndex;
      continue;
    }
    const offCurves: FontraPoint[] = [];
    let scan = nextIndex;
    while (isOffCurve(points[scan])) {
      offCurves.push(points[scan]);
      scan = (scan + 1) % n;
      if (scan === firstOn) break;
    }
    const onCurve = points[scan];
    if (!onCurve || isOffCurve(onCurve)) break;
    if (offCurves.length >= 2) {
      const [c1, c2] = offCurves;
      commands.push({
        type: "C",
        x1: c1.x,
        y1: c1.y,
        x2: c2.x,
        y2: c2.y,
        x: onCurve.x,
        y: onCurve.y,
      });
    } else if (offCurves.length === 1) {
      commands.push({
        type: "Q",
        x1: offCurves[0].x,
        y1: offCurves[0].y,
        x: onCurve.x,
        y: onCurve.y,
      });
    } else if (onCurve.x !== currentX || onCurve.y !== currentY) {
      commands.push({ type: "L", x: onCurve.x, y: onCurve.y });
    }
    currentX = onCurve.x;
    currentY = onCurve.y;
    index = scan;
    if (index === firstOn) break;
  }
  if (contour.isClosed) {
    commands.push({ type: "Z" });
  }
  return commands;
}

function parseGlyphInfo(csv: string): Map<string, number | undefined> {
  const map = new Map<string, number | undefined>();
  for (const line of csv.split(/\r?\n/)) {
    if (!line || /^glyph name/i.test(line)) continue;
    const [name, codePoints] = line.split(";");
    if (!name) continue;
    const match = codePoints?.match(/U\+([0-9A-Fa-f]+)/);
    map.set(name.trim(), match ? parseInt(match[1], 16) : undefined);
  }
  return map;
}

export function importFontraFromFiles(
  files: Map<string, string | Uint8Array>,
  projectName = "Fontra project"
): FontraImportResult {
  const warnings: string[] = [];
  const decoder = new TextDecoder();
  const readText = (path: string): string | undefined => {
    const data = files.get(path) ?? files.get(path.replaceAll("\\", "/"));
    if (!data) return undefined;
    return typeof data === "string" ? data : decoder.decode(data);
  };

  const fontDataText = readText("font-data.json");
  const fontData: FontraFontData = fontDataText ? JSON.parse(fontDataText) : {};
  const sourceEntry = Object.values(fontData.sources ?? {})[0];
  const metrics = sourceEntry?.lineMetricsHorizontalLayout ?? {};
  const glyphInfoText = readText("glyph-info.csv") ?? "";
  const glyphMap = parseGlyphInfo(glyphInfoText);
  const project = createEmptyProject(projectName);
  project.ascender = metrics.ascender?.value ?? 750;
  project.descender = metrics.descender?.value ?? -250;
  project.xHeight = metrics.xHeight?.value ?? 500;
  project.capHeight = metrics.capHeight?.value ?? 700;
  project.sources[0].name = sourceEntry?.name || "Regular";

  for (const [path, data] of files) {
    const normalized = path.replaceAll("\\", "/");
    const match = normalized.match(/(?:^|\/)glyphs\/([^/]+)\.json$/);
    if (!match) continue;
    const fileName = decodeURIComponent(match[1]);
    const glyphName = fileName.replace(/^.*?_/, "");
    let parsed: FontraGlyphJSON;
    try {
      const text = typeof data === "string" ? data : decoder.decode(data);
      parsed = JSON.parse(text);
    } catch (error) {
      warnings.push(`Could not parse ${normalized}`);
      continue;
    }
    const layerNames = Object.keys(parsed.layers ?? {});
    if (!layerNames.length) continue;
    const layer = parsed.layers[layerNames[0]];
    const contours: Contour[] = [];
    for (const contour of layer.glyph?.path?.contours ?? []) {
      const commands = fontraContourToCommands(contour);
      if (commands.length > 1) {
        contours.push({ commands, closed: !!contour.isClosed });
      }
    }
    const unicode = glyphMap.get(parsed.name ?? glyphName) ?? glyphMap.get(glyphName);
    const keys = parsed.customData?.["org.fontra.fit.metricsKeys"];
    const glyph: Glyph = {
      name: parsed.name ?? glyphName,
      unicode,
      advanceWidth: layer.glyph?.xAdvance ?? 0,
      contours,
      category: categoryFromGlyph(parsed.name ?? glyphName, unicode),
      metricsKeys:
        keys && typeof keys === "object"
          ? (keys as { left?: string; right?: string })
          : undefined,
    };
    project.sources[0].glyphs.push(glyph);
  }

  // Fit writes groups and kerning to a sidecar because Fontra's on-disk
  // format does not store kerning in the per-glyph JSON files.
  const kerningSidecar = readText("fit-kerning.json");
  let keyGlyphsFromFile = false;
  if (kerningSidecar) {
    try {
      const parsed = JSON.parse(kerningSidecar) as {
        groups?: { left?: Record<string, string[]>; right?: Record<string, string[]> };
        kerning?: Record<string, number>;
        tracking?: FontProject["tracking"];
        keyGlyphs?: FontProject["keyGlyphs"];
      };
      if (parsed.groups?.left) project.groups.left = parsed.groups.left;
      if (parsed.groups?.right) project.groups.right = parsed.groups.right;
      if (parsed.kerning) project.sources[0].kerning = parsed.kerning;
      if (parsed.tracking) project.tracking = parsed.tracking;
      if (parsed.keyGlyphs) {
        project.keyGlyphs = parsed.keyGlyphs;
        keyGlyphsFromFile = true;
      }
    } catch {
      warnings.push("Could not parse fit-kerning.json");
    }
  }

  if (!project.sources[0].glyphs.length) {
    warnings.push("No glyphs found. Expected glyphs/*.json next to font-data.json.");
  }
  if (!keyGlyphsFromFile) {
    const names = new Set(project.sources[0].glyphs.map((glyph) => glyph.name));
    project.keyGlyphs = {
      lowerStem: names.has("n") ? "n" : names.has("o") ? "o" : "n",
      lowerRound: names.has("o") ? "o" : "n",
      upperStem: names.has("H") ? "H" : names.has("n") ? "n" : "H",
      upperRound: names.has("O") ? "O" : names.has("o") ? "o" : "O",
    };
  }
  return { project: normalizeProject(project), warnings };
}

export async function loadBundledFontraDemo(basePath = "/demo-fontra"): Promise<FontraImportResult> {
  const files = new Map<string, string>();
  const fontData = await fetch(`${basePath}/font-data.json`).then((r) => r.text());
  files.set("font-data.json", fontData);
  try {
    files.set("glyph-info.csv", await fetch(`${basePath}/glyph-info.csv`).then((r) => r.text()));
  } catch {
    // optional
  }
  const glyphInfo = files.get("glyph-info.csv") ?? "";
  const names = glyphInfo
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(";")[0]?.trim())
    .filter(Boolean);
  for (const name of names) {
    try {
      const response = await fetch(`${basePath}/glyphs/${encodeURIComponent(name)}.json`);
      if (!response.ok) continue;
      files.set(`glyphs/${name}.json`, await response.text());
    } catch {
      // ignore missing glyph
    }
  }
  return importFontraFromFiles(files, "Fontulja");
}

export async function readFontraDirectory(files: FileList): Promise<FontraImportResult> {
  const map = new Map<string, string>();
  let projectName = "Fontra project";
  for (const file of Array.from(files)) {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const parts = relative.split("/");
    if (parts.length > 1) {
      projectName = parts[0].replace(/\.fontra$/i, "");
    }
    const normalized = parts.slice(1).join("/") || file.name;
    if (
      normalized === "font-data.json" ||
      normalized === "glyph-info.csv" ||
      normalized === "fit-kerning.json" ||
      normalized.startsWith("glyphs/")
    ) {
      map.set(normalized, await file.text());
    }
  }
  return importFontraFromFiles(map, projectName);
}

export async function readFontraZip(buffer: ArrayBuffer): Promise<FontraImportResult> {
  const unzipped = unzipSync(new Uint8Array(buffer));
  const map = new Map<string, Uint8Array>();
  let root = "";
  for (const [path, data] of Object.entries(unzipped)) {
    const normalized = path.replaceAll("\\", "/");
    if (normalized.endsWith("/font-data.json")) {
      root = normalized.slice(0, -"font-data.json".length);
      break;
    }
  }
  for (const [path, data] of Object.entries(unzipped)) {
    const normalized = path.replaceAll("\\", "/");
    const relative = root && normalized.startsWith(root) ? normalized.slice(root.length) : normalized;
    if (
      relative === "font-data.json" ||
      relative === "glyph-info.csv" ||
      relative === "fit-kerning.json" ||
      relative.startsWith("glyphs/")
    ) {
      map.set(relative, data);
    }
  }
  const name = root.split("/").filter(Boolean).pop()?.replace(/\.fontra$/i, "") || "Fontra project";
  return importFontraFromFiles(map, name);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function commandsToFontraPoints(commands: PathCommand[]): FontraPoint[] {
  const points: FontraPoint[] = [];
  let current = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  for (const command of commands) {
    switch (command.type) {
      case "M":
        points.push({ x: command.x, y: command.y });
        current = { x: command.x, y: command.y };
        start = current;
        break;
      case "L":
        points.push({ x: command.x, y: command.y });
        current = { x: command.x, y: command.y };
        break;
      case "C":
        points.push({ x: command.x1, y: command.y1, type: "cubic" });
        points.push({ x: command.x2, y: command.y2, type: "cubic" });
        points.push({ x: command.x, y: command.y });
        current = { x: command.x, y: command.y };
        break;
      case "Q": {
        const c1 = {
          x: current.x + (2 / 3) * (command.x1 - current.x),
          y: current.y + (2 / 3) * (command.y1 - current.y),
        };
        const c2 = {
          x: command.x + (2 / 3) * (command.x1 - command.x),
          y: command.y + (2 / 3) * (command.y1 - command.y),
        };
        points.push({ x: c1.x, y: c1.y, type: "cubic" });
        points.push({ x: c2.x, y: c2.y, type: "cubic" });
        points.push({ x: command.x, y: command.y });
        current = { x: command.x, y: command.y };
        break;
      }
      case "Z":
        if (points.length > 1) {
          const last = points[points.length - 1];
          if (Math.abs(last.x - start.x) < 1e-6 && Math.abs(last.y - start.y) < 1e-6) {
            points.pop();
          }
        }
        break;
    }
  }
  return points;
}

export function exportFontraZip(project: FontProject): Uint8Array {
  const source = project.sources[project.activeSource];
  const files: Record<string, Uint8Array> = {};
  const sourceId = "src00001";
  files["font-data.json"] = strToU8(
    JSON.stringify(
      {
        sources: {
          [sourceId]: {
            name: source.name,
            lineMetricsHorizontalLayout: {
              ascender: { value: project.ascender, zone: 16 },
              descender: { value: project.descender, zone: -16 },
              xHeight: { value: project.xHeight, zone: 16 },
              capHeight: { value: project.capHeight, zone: 16 },
              baseline: { value: 0, zone: -16 },
            },
          },
        },
      },
      null,
      2
    )
  );
  const csvLines = ["glyph name;code points"];
  for (const glyph of source.glyphs) {
    csvLines.push(`${glyph.name};${glyph.unicode ? `U+${glyph.unicode.toString(16).toUpperCase().padStart(4, "0")}` : ""}`);
    const contours = glyph.contours.map((contour) => ({
      points: commandsToFontraPoints(contour.commands),
      isClosed: contour.closed,
    }));
    const glyphJSON = {
      name: glyph.name,
      sources: [{ name: "", layerName: sourceId, locationBase: sourceId }],
      layers: {
        [sourceId]: {
          glyph: {
            ...(contours.length ? { path: { contours } } : {}),
            xAdvance: glyph.advanceWidth,
          },
        },
      },
      ...(glyph.metricsKeys?.left || glyph.metricsKeys?.right
        ? { customData: { "org.fontra.fit.metricsKeys": glyph.metricsKeys } }
        : {}),
    };
    files[`glyphs/${glyph.name}.json`] = strToU8(JSON.stringify(glyphJSON, null, 2));
  }
  files["glyph-info.csv"] = strToU8(csvLines.join("\n"));
  // Preserve kerning and groups in a sidecar that the importer can read.
  files["fit-kerning.json"] = strToU8(
    JSON.stringify(
      {
        groups: project.groups,
        kerning: source.kerning,
        tracking: project.tracking,
        keyGlyphs: project.keyGlyphs,
      },
      null,
      2
    )
  );
  return zipSync(files, { level: 6 });
}
