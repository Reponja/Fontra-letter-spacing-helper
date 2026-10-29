import type { Bounds, Contour, PathCommand } from "./types";

export interface Pt {
  x: number;
  y: number;
}

const DEFAULT_STEPS = 14;

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function quadPoint(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const mt = 1 - t;
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  };
}

export function cubicPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const mt = 1 - t;
  return {
    x:
      mt * mt * mt * p0.x +
      3 * mt * mt * t * p1.x +
      3 * mt * t * t * p2.x +
      t * t * t * p3.x,
    y:
      mt * mt * mt * p0.y +
      3 * mt * mt * t * p1.y +
      3 * mt * t * t * p2.y +
      t * t * t * p3.y,
  };
}

export function flattenContour(contour: Contour, steps = DEFAULT_STEPS): Pt[] {
  const points: Pt[] = [];
  let current: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let emitted = false;

  for (const command of contour.commands) {
    switch (command.type) {
      case "M":
        current = { x: command.x, y: command.y };
        start = current;
        points.push(current);
        emitted = true;
        break;
      case "L":
        current = { x: command.x, y: command.y };
        points.push(current);
        break;
      case "Q": {
        const p0 = current;
        const p1 = { x: command.x1, y: command.y1 };
        const p2 = { x: command.x, y: command.y };
        for (let i = 1; i <= steps; i++) {
          points.push(quadPoint(p0, p1, p2, i / steps));
        }
        current = p2;
        break;
      }
      case "C": {
        const p0 = current;
        const p1 = { x: command.x1, y: command.y1 };
        const p2 = { x: command.x2, y: command.y2 };
        const p3 = { x: command.x, y: command.y };
        for (let i = 1; i <= steps; i++) {
          points.push(cubicPoint(p0, p1, p2, p3, i / steps));
        }
        current = p3;
        break;
      }
      case "Z":
        if (emitted) {
          const last = points[points.length - 1];
          if (last.x !== start.x || last.y !== start.y) {
            points.push(start);
          }
          current = start;
        }
        break;
    }
  }
  return dedupeConsecutive(points);
}

function dedupeConsecutive(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - point.x) > 1e-9 || Math.abs(last.y - point.y) > 1e-9) {
      out.push(point);
    }
  }
  return out;
}

export function contoursToPolygons(contours: Contour[], steps = DEFAULT_STEPS): Pt[][] {
  return contours.map((contour) => flattenContour(contour, steps)).filter((poly) => poly.length > 1);
}

export function computeBounds(points: Pt[]): Bounds | undefined {
  if (!points.length) {
    return undefined;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export function unionBounds(bounds: (Bounds | undefined)[]): Bounds | undefined {
  const valid = bounds.filter((b): b is Bounds => !!b);
  if (!valid.length) {
    return undefined;
  }
  return valid.reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.minX),
    minY: Math.min(acc.minY, b.minY),
    maxX: Math.max(acc.maxX, b.maxX),
    maxY: Math.max(acc.maxY, b.maxY),
  }));
}

export function translateContours(contours: Contour[], dx: number, dy = 0): void {
  for (const contour of contours) {
    for (const command of contour.commands) {
      switch (command.type) {
        case "M":
        case "L":
          command.x += dx;
          command.y += dy;
          break;
        case "Q":
          command.x += dx;
          command.y += dy;
          command.x1 += dx;
          command.y1 += dy;
          break;
        case "C":
          command.x += dx;
          command.y += dy;
          command.x1 += dx;
          command.y1 += dy;
          command.x2 += dx;
          command.y2 += dy;
          break;
        case "Z":
          break;
      }
    }
  }
}

export function scaleContours(contours: Contour[], sx: number, sy: number, ox = 0, oy = 0): void {
  for (const contour of contours) {
    for (const command of contour.commands) {
      switch (command.type) {
        case "M":
        case "L":
          command.x = ox + (command.x - ox) * sx;
          command.y = oy + (command.y - oy) * sy;
          break;
        case "Q":
          command.x = ox + (command.x - ox) * sx;
          command.y = oy + (command.y - oy) * sy;
          command.x1 = ox + (command.x1 - ox) * sx;
          command.y1 = oy + (command.y1 - oy) * sy;
          break;
        case "C":
          command.x = ox + (command.x - ox) * sx;
          command.y = oy + (command.y - oy) * sy;
          command.x1 = ox + (command.x1 - ox) * sx;
          command.y1 = oy + (command.y1 - oy) * sy;
          command.x2 = ox + (command.x2 - ox) * sx;
          command.y2 = oy + (command.y2 - oy) * sy;
          break;
        case "Z":
          break;
      }
    }
  }
}

export function commandsToSvgPath(commands: PathCommand[]): string {
  const parts: string[] = [];
  for (const command of commands) {
    switch (command.type) {
      case "M":
        parts.push(`M ${command.x} ${command.y}`);
        break;
      case "L":
        parts.push(`L ${command.x} ${command.y}`);
        break;
      case "Q":
        parts.push(`Q ${command.x1} ${command.y1} ${command.x} ${command.y}`);
        break;
      case "C":
        parts.push(
          `C ${command.x1} ${command.y1} ${command.x2} ${command.y2} ${command.x} ${command.y}`
        );
        break;
      case "Z":
        parts.push("Z");
        break;
    }
  }
  return parts.join(" ");
}

export function contoursToSvgPath(contours: Contour[]): string {
  return contours.map((contour) => commandsToSvgPath(contour.commands)).join(" ");
}

/**
 * Returns the horizontal ink runs at a given y, sorted and paired.
 * This is an even-odd style scanline, which is correct for normal glyph
 * contours and holes.
 */
/**
 * Scanline intersection for already-flattened polygons. Use this when sampling
 * many y values for the same glyph; flattening is the expensive part.
 */
export function xRunsAtYFromPolygons(
  polygons: Pt[][],
  y: number
): Array<[number, number]> {
  const xs: number[] = [];
  for (const polygon of polygons) {
    if (polygon.length < 2) continue;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      if (a.y === b.y) {
        continue;
      }
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        const t = (y - a.y) / (b.y - a.y);
        xs.push(a.x + (b.x - a.x) * t);
      }
    }
  }
  xs.sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > 1e-7) {
      runs.push([xs[i], xs[i + 1]]);
    }
  }
  return runs;
}

export function xRunsAtY(contours: Contour[], y: number, steps = DEFAULT_STEPS): Array<[number, number]> {
  return xRunsAtYFromPolygons(contoursToPolygons(contours, steps), y);
}

export function inkExtentAtYFromPolygons(
  polygons: Pt[][],
  y: number
): { minX: number; maxX: number } | undefined {
  const runs = xRunsAtYFromPolygons(polygons, y);
  if (!runs.length) return undefined;
  return { minX: runs[0][0], maxX: runs[runs.length - 1][1] };
}

export function inkExtentAtY(
  contours: Contour[],
  y: number,
  steps = DEFAULT_STEPS
): { minX: number; maxX: number } | undefined {
  return inkExtentAtYFromPolygons(contoursToPolygons(contours, steps), y);
}

export function stemRunsAtY(
  contours: Contour[],
  y: number,
  steps = DEFAULT_STEPS
): Array<{ start: number; end: number; center: number; width: number }> {
  return xRunsAtY(contours, y, steps).map(([start, end]) => ({
    start,
    end,
    center: (start + end) / 2,
    width: end - start,
  }));
}

export function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
