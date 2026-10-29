import type {
  Bounds,
  Contour,
  FontProject,
  Glyph,
  GlyphCategory,
  Sidebearings,
} from "./types";
import {
  computeBounds,
  contoursToPolygons,
  inkExtentAtY,
  median,
  stemRunsAtY,
  translateContours,
  type Pt,
} from "./path";

export interface SideProfile {
  side: "left" | "right";
  yStart: number;
  yEnd: number;
  averageExtra: number;
  maxExtra: number;
  coverage: number;
  samples: number[];
}

export interface StemInfo {
  interval: number;
  width: number;
  runs: Array<{ start: number; end: number; center: number; width: number }>;
}

export function roundTo(value: number, step: number): number {
  if (!step) {
    return value;
  }
  return Math.round(value / step) * step;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function glyphPolygons(glyph: Glyph, steps = 14): Pt[][] {
  return contoursToPolygons(glyph.contours, steps);
}

export function glyphBounds(glyph: Glyph): Bounds | undefined {
  const polygons = glyphPolygons(glyph);
  return computeBounds(polygons.flat());
}

export function glyphInkWidth(glyph: Glyph): number {
  const bounds = glyphBounds(glyph);
  return bounds ? bounds.maxX - bounds.minX : 0;
}

export function sidebearingsOf(glyph: Glyph): Sidebearings {
  const bounds = glyphBounds(glyph);
  if (!bounds) {
    return {
      left: 0,
      right: glyph.advanceWidth,
      advance: glyph.advanceWidth,
      inkWidth: 0,
    };
  }
  return {
    left: bounds.minX,
    right: glyph.advanceWidth - bounds.maxX,
    advance: glyph.advanceWidth,
    inkWidth: bounds.maxX - bounds.minX,
  };
}

export function translateGlyph(glyph: Glyph, dx: number, dy = 0): void {
  translateContours(glyph.contours, dx, dy);
}

/**
 * Set both sidebearings at once, preserving the outline shape.
 * The glyph is shifted so its left bound sits at `left`, and the advance
 * is set to left + inkWidth + right.
 */
export function applySidebearings(glyph: Glyph, left: number, right: number): void {
  const bounds = glyphBounds(glyph);
  if (!bounds) {
    glyph.advanceWidth = Math.max(0, Math.round(left + right));
    return;
  }
  const inkWidth = bounds.maxX - bounds.minX;
  const dx = left - bounds.minX;
  translateGlyph(glyph, dx, 0);
  glyph.advanceWidth = Math.max(0, Math.round(left + inkWidth + right));
}

/**
 * Change one sidebearing. By default the opposite side is preserved, which
 * means the outline is shifted and the advance width changes. Set
 * `keepOtherSide` to false to move the glyph inside its existing advance.
 */
export function setSidebearing(
  glyph: Glyph,
  side: "left" | "right",
  value: number,
  keepOtherSide = true
): void {
  const bounds = glyphBounds(glyph);
  if (!bounds) {
    return;
  }
  if (side === "left") {
    const delta = value - bounds.minX;
    translateGlyph(glyph, delta, 0);
    if (keepOtherSide) {
      glyph.advanceWidth = Math.max(0, glyph.advanceWidth + delta);
    }
  } else {
    const currentRight = glyph.advanceWidth - bounds.maxX;
    const delta = value - currentRight;
    glyph.advanceWidth = Math.max(0, glyph.advanceWidth + delta);
  }
}

export function setAdvanceWidth(glyph: Glyph, advance: number, align: "left" | "center" = "left"): void {
  const old = glyph.advanceWidth;
  glyph.advanceWidth = Math.max(0, advance);
  if (align === "center") {
    translateGlyph(glyph, (advance - old) / 2, 0);
  }
}

export function zoneForGlyph(
  project: FontProject,
  glyph: Glyph,
  zone: "auto" | "xheight" | "capheight" = "auto"
): { yStart: number; yEnd: number } {
  if (zone === "xheight") {
    return { yStart: 0, yEnd: project.xHeight };
  }
  if (zone === "capheight") {
    return { yStart: 0, yEnd: project.capHeight };
  }
  switch (glyph.category) {
    case "Uppercase":
    case "Smallcaps":
    case "Number":
      return { yStart: 0, yEnd: project.capHeight };
    case "Lowercase":
    case "Punctuation":
    case "Symbol":
    case "Other":
    default:
      return { yStart: 0, yEnd: project.xHeight };
  }
}

/**
 * Measures how much the glyph's edge recedes from its bounding box over the
 * spacing zone. A flat stem has ~0 extra; a round bowl has a positive value.
 * This is the core shape signal used by the optical spacing engine.
 */
export function sideProfile(
  glyph: Glyph,
  side: "left" | "right",
  yStart: number,
  yEnd: number,
  sampleCount = 24
): SideProfile {
  const bounds = glyphBounds(glyph);
  if (!bounds || sampleCount < 2) {
    return {
      side,
      yStart,
      yEnd,
      averageExtra: 0,
      maxExtra: 0,
      coverage: 0,
      samples: [],
    };
  }
  const samples: number[] = [];
  let covered = 0;
  for (let i = 0; i < sampleCount; i++) {
    const t = (i + 0.5) / sampleCount;
    const y = yStart + (yEnd - yStart) * t;
    const extent = inkExtentAtY(glyph.contours, y);
    if (!extent) {
      samples.push(0);
      continue;
    }
    covered += 1;
    const extra =
      side === "left" ? extent.minX - bounds.minX : bounds.maxX - extent.maxX;
    samples.push(Math.max(0, extra));
  }
  const total = samples.reduce((a, b) => a + b, 0);
  return {
    side,
    yStart,
    yEnd,
    averageExtra: total / sampleCount,
    maxExtra: Math.max(0, ...samples),
    coverage: covered / sampleCount,
    samples,
  };
}

export function stemInfo(
  glyph: Glyph,
  y: number
): StemInfo {
  const runs = stemRunsAtY(glyph.contours, y);
  if (runs.length < 2) {
    return { interval: 0, width: runs[0]?.width ?? 0, runs };
  }
  const distances: number[] = [];
  for (let i = 1; i < runs.length; i++) {
    distances.push(runs[i].center - runs[i - 1].center);
  }
  return {
    interval: median(distances),
    width:
      runs.reduce((sum, run) => sum + run.width, 0) / runs.length,
    runs,
  };
}

export function measureKeyStem(
  project: FontProject,
  glyphName: string,
  zone: "auto" | "xheight" | "capheight" = "auto"
): StemInfo {
  const glyph = project.sources[project.activeSource]?.glyphs.find(
    (candidate) => candidate.name === glyphName
  );
  if (!glyph) {
    return { interval: 0, width: 0, runs: [] };
  }
  const { yStart, yEnd } = zoneForGlyph(project, glyph, zone);
  const y = yStart + (yEnd - yStart) * 0.5;
  return stemInfo(glyph, y);
}

export type SideClass = "flat" | "soft" | "round" | "open" | "empty";

export function classifySide(
  glyph: Glyph,
  side: "left" | "right",
  yStart: number,
  yEnd: number,
  unitsPerEm: number
): SideClass {
  const profile = sideProfile(glyph, side, yStart, yEnd);
  if (profile.coverage < 0.08) {
    return "empty";
  }
  const normalized = profile.averageExtra / unitsPerEm;
  if (normalized < 0.012) {
    return "flat";
  }
  if (normalized < 0.04) {
    return "soft";
  }
  if (normalized < 0.1) {
    return "round";
  }
  return "open";
}

export function glyphShapeClass(
  glyph: Glyph,
  project: FontProject,
  zone: "auto" | "xheight" | "capheight" = "auto"
): string {
  const { yStart, yEnd } = zoneForGlyph(project, glyph, zone);
  const left = classifySide(glyph, "left", yStart, yEnd, project.unitsPerEm);
  const right = classifySide(glyph, "right", yStart, yEnd, project.unitsPerEm);
  if (left === "empty" && right === "empty") {
    return "empty";
  }
  return `${left}-${right}`;
}

export function categoryFromGlyph(name: string, unicode?: number): GlyphCategory {
  if (!unicode) {
    if (/^space$|^nbspace$|^uni00A0$/i.test(name)) return "Space";
    if (/comb|mark|acute|grave|dieresis|cedilla|tilde/i.test(name)) return "Mark";
    return "Other";
  }
  const char = String.fromCodePoint(unicode);
  if (/\s/.test(char)) return "Space";
  if (/[A-Z]/.test(char)) return "Uppercase";
  if (/[a-z]/.test(char)) return "Lowercase";
  if (/[0-9]/.test(char)) return "Number";
  if (/[\p{P}\p{S}]/u.test(char)) {
    if (/[\p{Sm}\p{Sc}]/u.test(char)) return "Symbol";
    return "Punctuation";
  }
  if (/\p{M}/u.test(char)) return "Mark";
  return "Other";
}

export function isLetter(glyph: Glyph): boolean {
  return glyph.category === "Uppercase" || glyph.category === "Lowercase" || glyph.category === "Smallcaps";
}

export function isSpacingGlyph(glyph: Glyph): boolean {
  return glyph.category !== "Mark" && glyph.category !== "Space";
}
