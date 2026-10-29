import type { FontProject, Glyph, PathCommand } from "../core/types";
import { activeSource, resolveKerning } from "../core/project";
import { currentTrackingPerMille } from "../core/tracking";
import { glyphBounds } from "../core/geometry";

export interface LayoutItem {
  glyph: Glyph;
  char: string;
  index: number;
  x: number;
  y: number;
  advance: number;
  kerning: number;
  tracking: number;
  width: number;
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface TextLayout {
  items: LayoutItem[];
  totalWidth: number;
  em: number;
}

function glyphForToken(project: FontProject, token: string): Glyph | undefined {
  const glyphs = activeSource(project).glyphs;
  if (token.startsWith("/")) {
    return glyphs.find((glyph) => glyph.name === token.slice(1));
  }
  const codePoint = token.codePointAt(0);
  if (codePoint === undefined) return undefined;
  return glyphs.find((glyph) => glyph.unicode === codePoint);
}

export function layoutText(
  project: FontProject,
  text: string,
  options: { trackingPerMille?: number; applyKerning?: boolean; applyTracking?: boolean } = {}
): TextLayout {
  const source = activeSource(project);
  const tracking =
    options.trackingPerMille ?? (options.applyTracking === false ? 0 : currentTrackingPerMille(project));
  const trackingUnits = (tracking / 1000) * project.unitsPerEm;
  const items: LayoutItem[] = [];
  let x = 0;
  const tokens = [...text];
  for (let index = 0; index < tokens.length; index++) {
    const char = tokens[index];
    if (char === "\n") {
      continue;
    }
    const glyph = glyphForToken(project, char);
    if (!glyph) {
      x += project.unitsPerEm * 0.25;
      continue;
    }
    const previous = items[items.length - 1];
    const kerning =
      previous && options.applyKerning !== false
        ? resolveKerning(project, previous.glyph.name, glyph.name)
        : 0;
    const trackingValue = items.length ? trackingUnits : 0;
    if (previous) {
      x += kerning + trackingValue;
    }
    const bounds = glyphBounds(glyph);
    items.push({
      glyph,
      char,
      index,
      x,
      y: 0,
      advance: glyph.advanceWidth,
      kerning,
      tracking: trackingValue,
      width: glyph.advanceWidth,
      bounds,
    });
    x += glyph.advanceWidth;
  }
  return {
    items,
    totalWidth: Math.max(1, x),
    em: project.unitsPerEm,
  };
}

export function commandsToPath2D(commands: PathCommand[]): Path2D {
  const path = new Path2D();
  for (const command of commands) {
    switch (command.type) {
      case "M":
        path.moveTo(command.x, command.y);
        break;
      case "L":
        path.lineTo(command.x, command.y);
        break;
      case "Q":
        path.quadraticCurveTo(command.x1, command.y1, command.x, command.y);
        break;
      case "C":
        path.bezierCurveTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y);
        break;
      case "Z":
        path.closePath();
        break;
    }
  }
  return path;
}

export function glyphPaths(glyph: Glyph): Path2D[] {
  return glyph.contours.map((contour) => commandsToPath2D(contour.commands));
}
