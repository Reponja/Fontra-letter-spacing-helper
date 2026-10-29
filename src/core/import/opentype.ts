import * as opentype from "opentype.js";
import type { Contour, FontProject, Glyph, PathCommand } from "../types";
import { categoryFromGlyph } from "../geometry";
import { createEmptyProject, kerningKey, normalizeProject } from "../project";

export interface OpentypeImportResult {
  project: FontProject;
  warnings: string[];
}

function toPathCommands(path: opentype.Path): PathCommand[] {
  const commands: PathCommand[] = [];
  for (const command of path.commands) {
    switch (command.type) {
      case "M":
        commands.push({ type: "M", x: command.x, y: command.y });
        break;
      case "L":
        commands.push({ type: "L", x: command.x, y: command.y });
        break;
      case "C":
        commands.push({
          type: "C",
          x1: command.x1,
          y1: command.y1,
          x2: command.x2,
          y2: command.y2,
          x: command.x,
          y: command.y,
        });
        break;
      case "Q":
        commands.push({
          type: "Q",
          x1: command.x1,
          y1: command.y1,
          x: command.x,
          y: command.y,
        });
        break;
      case "Z":
        commands.push({ type: "Z" });
        break;
    }
  }
  return commands;
}

function splitContours(commands: PathCommand[]): Contour[] {
  const contours: Contour[] = [];
  let current: PathCommand[] = [];
  let closed = false;
  for (const command of commands) {
    if (command.type === "M") {
      if (current.length > 1) {
        contours.push({ commands: current, closed });
      }
      current = [command];
      closed = false;
    } else {
      current.push(command);
      if (command.type === "Z") {
        closed = true;
      }
    }
  }
  if (current.length > 1) {
    contours.push({ commands: current, closed });
  }
  return contours;
}

function fontName(font: opentype.Font): string {
  const names = font.names as unknown as Record<string, Record<string, string> | undefined>;
  return (
    names.fullName?.en ??
    names.fontFamily?.en ??
    names.postScriptName?.en ??
    "Imported font"
  );
}

export function importOpentypeBuffer(
  buffer: ArrayBuffer,
  fallbackName = "Imported font"
): OpentypeImportResult {
  const warnings: string[] = [];
  const font = opentype.parse(buffer);
  const project = createEmptyProject(fontName(font) || fallbackName);
  project.unitsPerEm = font.unitsPerEm || 1000;
  project.ascender = font.ascender || Math.round(project.unitsPerEm * 0.75);
  project.descender = font.descender || -Math.round(project.unitsPerEm * 0.25);
  project.xHeight =
    (font.tables.os2 as { sxHeight?: number } | undefined)?.sxHeight ??
    Math.round(project.unitsPerEm * 0.5);
  project.capHeight =
    (font.tables.os2 as { sCapHeight?: number } | undefined)?.sCapHeight ??
    Math.round(project.unitsPerEm * 0.7);
  project.sources[0].name = "Regular";

  for (let i = 0; i < font.glyphs.length; i++) {
    const glyph = font.glyphs.get(i);
    if (!glyph) continue;
    if (glyph.name === ".notdef") continue;
    const path = glyph.getPath(0, 0, project.unitsPerEm);
    const commands = toPathCommands(path);
    const contours = splitContours(commands);
    const unicode = glyph.unicode;
    const glyphName = glyph.name || (unicode ? `uni${unicode.toString(16).toUpperCase().padStart(4, "0")}` : `glyph${i}`);
    project.sources[0].glyphs.push({
      name: glyphName,
      unicode,
      advanceWidth: Math.round(glyph.advanceWidth ?? 0),
      contours,
      category: categoryFromGlyph(glyphName, unicode),
    });
  }

  // opentype.js exposes a legacy kern table as either a flat
  // { "leftIndex,rightIndex": value } map or a nested name map, depending on
  // the font and code path used to parse it.
  const nameByIndex = new Map<number, string>();
  for (let i = 0; i < font.glyphs.length; i++) {
    const glyph = font.glyphs.get(i);
    if (glyph?.name) nameByIndex.set(i, glyph.name);
  }
  const kerningPairs = (font as unknown as {
    kerningPairs?: Record<string, number | Record<string, number>>;
  }).kerningPairs;
  if (kerningPairs) {
    for (const [left, rights] of Object.entries(kerningPairs)) {
      if (typeof rights === "number") {
        const [leftIndex, rightIndex] = left.split(",");
        const leftName = nameByIndex.get(Number(leftIndex));
        const rightName = nameByIndex.get(Number(rightIndex));
        if (leftName && rightName) {
          project.sources[0].kerning[kerningKey(leftName, rightName)] = Number(rights);
        }
        continue;
      }
      if (!rights || typeof rights !== "object") continue;
      for (const [right, value] of Object.entries(rights)) {
        project.sources[0].kerning[kerningKey(left, right)] = Number(value);
      }
    }
  } else {
    warnings.push(
      "Kerning in GPOS tables is not imported from TTF/OTF. Import a UFO or .fontra project for full kerning fidelity."
    );
  }

  const names = new Set(project.sources[0].glyphs.map((glyph) => glyph.name));
  project.keyGlyphs = {
    lowerStem: names.has("n") ? "n" : "n",
    lowerRound: names.has("o") ? "o" : "n",
    upperStem: names.has("H") ? "H" : "n",
    upperRound: names.has("O") ? "O" : "o",
  };
  return { project: normalizeProject(project), warnings };
}

export async function importOpentypeFile(file: File): Promise<OpentypeImportResult> {
  return importOpentypeBuffer(await file.arrayBuffer(), file.name.replace(/\.[^.]+$/, ""));
}

export async function loadDemoOpentype(url = "/demo.ttf"): Promise<OpentypeImportResult> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load demo font (${response.status})`);
  return importOpentypeBuffer(await response.arrayBuffer(), "Atkinson Hyperlegible");
}
