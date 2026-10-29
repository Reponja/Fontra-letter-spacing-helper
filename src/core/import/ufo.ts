import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Contour, FontProject, Glyph, PathCommand } from "../types";
import { categoryFromGlyph } from "../geometry";
import { createEmptyProject, kerningKey, normalizeProject, splitKerningKey } from "../project";

interface UfoPoint {
  x: number;
  y: number;
  type?: string;
  name?: string;
}

interface UfoContour {
  points: UfoPoint[];
  closed: boolean;
}

export interface UfoImportResult {
  project: FontProject;
  warnings: string[];
}

export function parsePlist(xml: string): unknown {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const error = doc.querySelector("parsererror");
  if (error) {
    throw new Error(`Invalid plist: ${error.textContent}`);
  }
  const plist = doc.documentElement;
  const child = plist.firstElementChild;
  return child ? plistNodeToValue(child) : undefined;
}

function plistNodeToValue(node: Element): unknown {
  switch (node.tagName.toLowerCase()) {
    case "dict": {
      const result: Record<string, unknown> = {};
      const children = Array.from(node.children);
      for (let i = 0; i + 1 < children.length; i += 2) {
        const key = children[i];
        const value = children[i + 1];
        if (key.tagName.toLowerCase() === "key") {
          result[key.textContent ?? ""] = plistNodeToValue(value);
        }
      }
      return result;
    }
    case "array":
      return Array.from(node.children).map(plistNodeToValue);
    case "true":
      return true;
    case "false":
      return false;
    case "integer":
    case "real":
      return Number(node.textContent ?? 0);
    case "string":
    case "date":
    case "data":
    default:
      return node.textContent ?? "";
  }
}

function plistEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function toPlist(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (typeof value === "string") {
    return `${pad}<string>${plistEscape(value)}</string>`;
  }
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? `${pad}<integer>${value}</integer>`
      : `${pad}<real>${value}</real>`;
  }
  if (typeof value === "boolean") {
    return `${pad}<${value ? "true" : "false"}/>`;
  }
  if (Array.isArray(value)) {
    return `${pad}<array>\n${value.map((item) => toPlist(item, indent + 1)).join("\n")}\n${pad}</array>`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    return `${pad}<dict>\n${entries
      .map(
        ([key, item]) =>
          `${pad}  <key>${plistEscape(key)}</key>\n${toPlist(item, indent + 1)}`
      )
      .join("\n")}\n${pad}</dict>`;
  }
  return `${pad}<string></string>`;
}

export function makePlist(value: unknown): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${toPlist(value)}\n</plist>\n`;
}

function isOnCurve(point: UfoPoint): boolean {
  return point.type !== "offcurve";
}

/**
 * Convert a UFO point-list contour to absolute path commands.
 */
export function ufoContourToCommands(contour: UfoContour): PathCommand[] {
  const points = contour.points;
  if (points.length < 2) return [];
  const firstOn = points.findIndex(isOnCurve);
  if (firstOn === -1) return [];
  const start = points[firstOn];
  const commands: PathCommand[] = [{ type: "M", x: start.x, y: start.y }];
  let current = { x: start.x, y: start.y };
  let index = firstOn;
  let guard = 0;
  while (guard++ < points.length + 2) {
    const nextIndex = (index + 1) % points.length;
    if (nextIndex === firstOn) break;
    const next = points[nextIndex];
    if (isOnCurve(next)) {
      if (next.x !== current.x || next.y !== current.y) {
        commands.push({ type: "L", x: next.x, y: next.y });
        current = { x: next.x, y: next.y };
      }
      index = nextIndex;
      continue;
    }
    const offCurves: UfoPoint[] = [];
    let scan = nextIndex;
    while (!isOnCurve(points[scan])) {
      offCurves.push(points[scan]);
      scan = (scan + 1) % points.length;
      if (scan === firstOn) break;
    }
    const onCurve = points[scan];
    if (!onCurve || !isOnCurve(onCurve)) break;
    if (offCurves.length >= 2) {
      commands.push({
        type: "C",
        x1: offCurves[0].x,
        y1: offCurves[0].y,
        x2: offCurves[1].x,
        y2: offCurves[1].y,
        x: onCurve.x,
        y: onCurve.y,
      });
    } else {
      commands.push({
        type: "Q",
        x1: offCurves[0].x,
        y1: offCurves[0].y,
        x: onCurve.x,
        y: onCurve.y,
      });
    }
    current = { x: onCurve.x, y: onCurve.y };
    index = scan;
    if (index === firstOn) break;
  }
  if (contour.closed) {
    commands.push({ type: "Z" });
  }
  return commands;
}

function parseGlif(xml: string): {
  name: string;
  advanceWidth: number;
  unicode?: number;
  contours: Contour[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const error = doc.querySelector("parsererror");
  if (error) throw new Error(`Invalid GLIF: ${error.textContent}`);
  const glyph = doc.documentElement;
  const name = glyph.getAttribute("name") ?? "";
  const advance = glyph.querySelector("advance");
  const advanceWidth = Number(advance?.getAttribute("width") ?? 0);
  const unicodeAttr = glyph.querySelector("unicode");
  const unicode = unicodeAttr?.getAttribute("hex")
    ? parseInt(unicodeAttr.getAttribute("hex")!, 16)
    : undefined;
  const contours: Contour[] = [];
  for (const contourEl of Array.from(glyph.querySelectorAll("outline > contour"))) {
    const points: UfoPoint[] = [];
    for (const pointEl of Array.from(contourEl.querySelectorAll("point"))) {
      points.push({
        x: Number(pointEl.getAttribute("x") ?? 0),
        y: Number(pointEl.getAttribute("y") ?? 0),
        type: pointEl.getAttribute("type") ?? undefined,
        name: pointEl.getAttribute("name") ?? undefined,
      });
    }
    if (points.length < 2) continue;
    const closed = !points.some((point) => point.type === "move");
    const commands = ufoContourToCommands({ points, closed });
    if (commands.length > 1) contours.push({ commands, closed });
  }
  if (advanceWidth === 0) {
    warnings.push(`${name}: advance width is zero`);
  }
  return { name, advanceWidth, unicode, contours, warnings };
}

export function importUfoFromFiles(
  files: Map<string, string | Uint8Array>,
  projectName = "UFO project"
): UfoImportResult {
  const warnings: string[] = [];
  const decoder = new TextDecoder();
  const readText = (path: string): string | undefined => {
    const data = files.get(path) ?? files.get(path.replaceAll("\\", "/"));
    if (!data) return undefined;
    return typeof data === "string" ? data : decoder.decode(data);
  };

  let root = "";
  for (const path of files.keys()) {
    const normalized = path.replaceAll("\\", "/");
    if (normalized.endsWith("metainfo.plist") || normalized.endsWith("fontinfo.plist")) {
      root = normalized.slice(0, normalized.lastIndexOf("/") + 1);
      break;
    }
  }
  const at = (path: string) => `${root}${path}`;
  const fontInfoText = readText(at("fontinfo.plist"));
  const fontInfo = fontInfoText ? (parsePlist(fontInfoText) as Record<string, unknown>) : {};
  const libText = readText(at("lib.plist"));
  const lib = libText ? (parsePlist(libText) as Record<string, unknown>) : {};
  const metricsKeys = lib["org.fontra.fit.metricsKeys"] as
    | Record<string, { left?: string; right?: string }>
    | undefined;
  const storedTracking = lib["org.fontra.fit.tracking"] as
    | FontProject["tracking"]
    | undefined;
  const storedKeyGlyphs = lib["org.fontra.fit.keyGlyphs"] as
    | FontProject["keyGlyphs"]
    | undefined;
  const project = createEmptyProject(projectName);
  if (storedTracking) project.tracking = storedTracking;
  if (storedKeyGlyphs) project.keyGlyphs = storedKeyGlyphs;
  project.unitsPerEm = Number(fontInfo.unitsPerEm ?? 1000) || 1000;
  project.ascender = Number(fontInfo.ascender ?? 750) || 750;
  project.descender = Number(fontInfo.descender ?? -250) || -250;
  project.xHeight = Number(fontInfo.xHeight ?? 500) || 500;
  project.capHeight = Number(fontInfo.capHeight ?? 700) || 700;
  project.sources[0].name = String(fontInfo.styleName ?? "Regular");

  const groupsText = readText(at("groups.plist"));
  if (groupsText) {
    const groups = parsePlist(groupsText) as Record<string, string[]>;
    for (const [groupName, glyphs] of Object.entries(groups)) {
      if (groupName.startsWith("public.kern1.")) {
        project.groups.left[groupName.slice("public.kern1.".length)] = [...glyphs];
      } else if (groupName.startsWith("public.kern2.")) {
        project.groups.right[groupName.slice("public.kern2.".length)] = [...glyphs];
      } else if (groupName.startsWith("@")) {
        project.groups.left[groupName.slice(1)] = [...glyphs];
      }
    }
  }

  const kerningText = readText(at("kerning.plist"));
  if (kerningText) {
    const kerning = parsePlist(kerningText) as Record<string, Record<string, number>>;
    for (const [left, rights] of Object.entries(kerning)) {
      for (const [right, value] of Object.entries(rights)) {
        const leftName = left.startsWith("public.kern1.")
          ? `@${left.slice("public.kern1.".length)}`
          : left;
        const rightName = right.startsWith("public.kern2.")
          ? `@${right.slice("public.kern2.".length)}`
          : right;
        project.sources[0].kerning[kerningKey(leftName, rightName)] = Number(value);
      }
    }
  }

  const contentsText = readText(at("glyphs/contents.plist"));
  const contents = contentsText
    ? (parsePlist(contentsText) as Record<string, string>)
    : undefined;
  const glyphFileEntries: Array<[string, string]> = [];
  if (contents) {
    for (const [name, filename] of Object.entries(contents)) {
      glyphFileEntries.push([name, at(`glyphs/${filename}`)]);
    }
  } else {
    for (const path of files.keys()) {
      const normalized = path.replaceAll("\\", "/");
      if (normalized.includes("/glyphs/") && normalized.endsWith(".glif")) {
        const filename = normalized.slice(normalized.lastIndexOf("/") + 1);
        glyphFileEntries.push([filename.replace(/\.glif$/, ""), normalized]);
      }
    }
  }

  for (const [name, path] of glyphFileEntries) {
    const xml = readText(path);
    if (!xml) {
      warnings.push(`Missing GLIF: ${path}`);
      continue;
    }
    try {
      const parsed = parseGlif(xml);
      const unicode = parsed.unicode ?? unicodeForName(name);
      const glyphName = parsed.name || name;
      const glyph: Glyph = {
        name: glyphName,
        unicode,
        advanceWidth: parsed.advanceWidth,
        contours: parsed.contours,
        category: categoryFromGlyph(glyphName, unicode),
        metricsKeys: metricsKeys?.[glyphName],
      };
      project.sources[0].glyphs.push(glyph);
      warnings.push(...parsed.warnings);
    } catch (error) {
      warnings.push(`Could not parse ${path}: ${String(error)}`);
    }
  }

  if (!storedKeyGlyphs) {
    const names = new Set(project.sources[0].glyphs.map((glyph) => glyph.name));
    project.keyGlyphs = {
      lowerStem: names.has("n") ? "n" : "n",
      lowerRound: names.has("o") ? "o" : "n",
      upperStem: names.has("H") ? "H" : "n",
      upperRound: names.has("O") ? "O" : "o",
    };
  }
  return { project: normalizeProject(project), warnings };
}

function unicodeForName(name: string): number | undefined {
  const uni = name.match(/^uni([0-9A-Fa-f]{4})$/);
  if (uni) return parseInt(uni[1], 16);
  const u = name.match(/^u([0-9A-Fa-f]{4,6})$/);
  if (u) return parseInt(u[1], 16);
  const basic = name.match(/^([A-Za-z0-9])$/);
  if (basic) return basic[1].codePointAt(0);
  return undefined;
}

export async function readUfoZip(buffer: ArrayBuffer): Promise<UfoImportResult> {
  const unzipped = unzipSync(new Uint8Array(buffer));
  const map = new Map<string, Uint8Array>();
  let root = "";
  for (const path of Object.keys(unzipped)) {
    const normalized = path.replaceAll("\\", "/");
    if (normalized.endsWith("fontinfo.plist")) {
      root = normalized.slice(0, normalized.lastIndexOf("/") + 1);
      break;
    }
  }
  for (const [path, data] of Object.entries(unzipped)) {
    const normalized = path.replaceAll("\\", "/");
    const relative = root && normalized.startsWith(root) ? normalized.slice(root.length) : normalized;
    map.set(relative, data);
  }
  const name = root.split("/").filter(Boolean).pop()?.replace(/\.ufo$/i, "") || "UFO project";
  return importUfoFromFiles(map, name);
}

export async function readUfoDirectory(files: FileList): Promise<UfoImportResult> {
  const map = new Map<string, string>();
  let projectName = "UFO project";
  for (const file of Array.from(files)) {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const parts = relative.split("/");
    if (parts.length > 1) {
      projectName = parts[0].replace(/\.ufo$/i, "");
    }
    const normalized = parts.slice(1).join("/") || file.name;
    map.set(normalized, await file.text());
  }
  return importUfoFromFiles(map, projectName);
}

function commandsToUfoPoints(commands: PathCommand[]): { points: UfoPoint[]; closed: boolean } {
  const points: UfoPoint[] = [];
  let current = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let closed = false;
  for (const command of commands) {
    switch (command.type) {
      case "M":
        points.push({ x: command.x, y: command.y, type: "move" });
        current = { x: command.x, y: command.y };
        start = current;
        break;
      case "L":
        points.push({ x: command.x, y: command.y, type: "line" });
        current = { x: command.x, y: command.y };
        break;
      case "C":
        points.push({ x: command.x1, y: command.y1, type: "offcurve" });
        points.push({ x: command.x2, y: command.y2, type: "offcurve" });
        points.push({ x: command.x, y: command.y, type: "curve" });
        current = { x: command.x, y: command.y };
        break;
      case "Q":
        points.push({ x: command.x1, y: command.y1, type: "offcurve" });
        points.push({ x: command.x, y: command.y, type: "qcurve" });
        current = { x: command.x, y: command.y };
        break;
      case "Z":
        closed = true;
        break;
    }
  }
  if (closed) {
    // Remove the explicit move point: a closed UFO contour starts on-curve.
    if (points.length && points[0].type === "move") {
      points[0].type = "line";
    }
    const last = points[points.length - 1];
    if (last && Math.abs(last.x - start.x) < 1e-6 && Math.abs(last.y - start.y) < 1e-6) {
      points.pop();
    }
  }
  return { points, closed };
}

function glifForGlyph(glyph: Glyph): string {
  const contours = glyph.contours
    .map((contour) => {
      const { points } = commandsToUfoPoints(contour.commands);
      const pointLines = points
        .map((point) => {
          const attrs = [
            `x="${point.x}"`,
            `y="${point.y}"`,
            point.type ? `type="${point.type}"` : "",
            point.name ? `name="${plistEscape(point.name)}"` : "",
          ]
            .filter(Boolean)
            .join(" ");
          return `      <point ${attrs}/>`;
        })
        .join("\n");
      return `    <contour>\n${pointLines}\n    </contour>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<glyph name="${plistEscape(glyph.name)}" format="2">
  <advance width="${Math.round(glyph.advanceWidth)}"/>
  ${glyph.unicode ? `<unicode hex="${glyph.unicode.toString(16).toUpperCase().padStart(4, "0")}"/>` : ""}
  <outline>
${contours}
  </outline>
</glyph>
`;
}

export function exportUfoFiles(
  project: FontProject,
  sourceIndex = project.activeSource
): Record<string, Uint8Array> {
  const source = project.sources[sourceIndex] ?? project.sources[0];
  const files: Record<string, Uint8Array> = {};
  files["metainfo.plist"] = strToU8(
    makePlist({ creator: "org.fontra.fit", formatVersion: 3 })
  );
  files["fontinfo.plist"] = strToU8(
    makePlist({
      familyName: project.name,
      styleName: source.name,
      unitsPerEm: project.unitsPerEm,
      ascender: project.ascender,
      descender: project.descender,
      xHeight: project.xHeight,
      capHeight: project.capHeight,
    })
  );
  const groups: Record<string, string[]> = {};
  for (const [name, glyphs] of Object.entries(project.groups.left)) {
    groups[`public.kern1.${name}`] = glyphs;
  }
  for (const [name, glyphs] of Object.entries(project.groups.right)) {
    groups[`public.kern2.${name}`] = glyphs;
  }
  files["groups.plist"] = strToU8(makePlist(groups));
  const kerning: Record<string, Record<string, number>> = {};
  for (const [key, value] of Object.entries(source.kerning)) {
    const [leftRaw, rightRaw] = splitKerningKey(key);
    const left = leftRaw.startsWith("@")
      ? `public.kern1.${leftRaw.slice(1)}`
      : leftRaw;
    const right = rightRaw.startsWith("@")
      ? `public.kern2.${rightRaw.slice(1)}`
      : rightRaw;
    if (!kerning[left]) kerning[left] = {};
    kerning[left][right] = value;
  }
  files["kerning.plist"] = strToU8(makePlist(kerning));
  files["layercontents.plist"] = strToU8(makePlist([["public.default", "glyphs"]]));
  const metricKeyData: Record<string, { left?: string; right?: string }> = {};
  for (const glyph of source.glyphs) {
    if (!glyph.metricsKeys?.left && !glyph.metricsKeys?.right) continue;
    const entry: { left?: string; right?: string } = {};
    if (glyph.metricsKeys?.left) entry.left = glyph.metricsKeys.left;
    if (glyph.metricsKeys?.right) entry.right = glyph.metricsKeys.right;
    metricKeyData[glyph.name] = entry;
  }
  files["lib.plist"] = strToU8(
    makePlist({
      "org.fontra.fit.tracking": project.tracking,
      "org.fontra.fit.metricsKeys": metricKeyData,
      "org.fontra.fit.keyGlyphs": project.keyGlyphs,
    })
  );
  const contents: Record<string, string> = {};
  for (const glyph of source.glyphs) {
    const filename = `${glyph.name.replaceAll("/", "_")}.glif`;
    contents[glyph.name] = filename;
    files[`glyphs/${filename}`] = strToU8(glifForGlyph(glyph));
  }
  files["glyphs/contents.plist"] = strToU8(makePlist(contents));
  return files;
}

export function exportUfoZip(project: FontProject, sourceIndex = project.activeSource): Uint8Array {
  return zipSync(exportUfoFiles(project, sourceIndex), { level: 6 });
}

export function ufoZipToFiles(buffer: ArrayBuffer): Map<string, Uint8Array> {
  const unzipped = unzipSync(new Uint8Array(buffer));
  const map = new Map<string, Uint8Array>();
  let root = "";
  for (const path of Object.keys(unzipped)) {
    if (path.endsWith("fontinfo.plist")) {
      root = path.slice(0, path.lastIndexOf("/") + 1);
      break;
    }
  }
  for (const [path, data] of Object.entries(unzipped)) {
    const relative = root && path.startsWith(root) ? path.slice(root.length) : path;
    map.set(relative, data);
  }
  return map;
}
