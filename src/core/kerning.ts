import type {
  AutoKernParams,
  FontProject,
  Glyph,
  KerningSuggestion,
} from "./types";
import {
  clamp,
  glyphBounds,
  glyphInkWidth,
  glyphPolygons,
  roundTo,
  sideProfile,
  sidebearingsOf,
  zoneForGlyph,
} from "./geometry";
import { inkExtentAtYFromPolygons } from "./path";
import {
  activeSource,
  assignGlyphToGroup,
  deleteKerning,
  getGlyph,
  hasExplicitKerning,
  kerningKey,
  leftGroupOf,
  resolveKerning,
  rightGroupOf,
  setKerning,
  splitKerningKey,
} from "./project";

export interface PairListOptions {
  leftGlyphs?: string[];
  rightGlyphs?: string[];
  includeLowerLower?: boolean;
  includeUpperUpper?: boolean;
  includeMixedCase?: boolean;
  includePunctuation?: boolean;
  includeFigures?: boolean;
  maxPairs?: number;
}

export function defaultPairList(project: FontProject): string[] {
  const glyphs = activeSource(project).glyphs;
  const letters = glyphs.filter(
    (g) => g.category === "Lowercase" || g.category === "Uppercase" || g.category === "Smallcaps"
  );
  const punctuation = glyphs.filter((g) => g.category === "Punctuation");
  const figures = glyphs.filter((g) => g.category === "Number");
  const pairs = new Set<string>();
  const add = (left: string, right: string) => pairs.add(kerningKey(left, right));
  const limit = 6000;

  for (const left of letters) {
    for (const right of letters) {
      if (pairs.size >= limit) break;
      add(left.name, right.name);
    }
  }
  for (const letter of letters) {
    for (const mark of punctuation) {
      add(letter.name, mark.name);
      add(mark.name, letter.name);
    }
  }
  for (const figure of figures) {
    for (const mark of punctuation) {
      add(figure.name, mark.name);
      add(mark.name, figure.name);
    }
  }
  return [...pairs];
}

export function buildPairList(project: FontProject, options: PairListOptions = {}): string[] {
  const glyphs = activeSource(project).glyphs;
  const byCategory = (category: string) => glyphs.filter((g) => g.category === category);
  const lefts = options.leftGlyphs?.length
    ? options.leftGlyphs.map((name) => glyphs.find((g) => g.name === name)).filter((g): g is Glyph => !!g)
    : glyphs.filter((g) => g.category !== "Mark" && g.category !== "Space");
  const rights = options.rightGlyphs?.length
    ? options.rightGlyphs.map((name) => glyphs.find((g) => g.name === name)).filter((g): g is Glyph => !!g)
    : glyphs.filter((g) => g.category !== "Mark" && g.category !== "Space");
  const result = new Set<string>();
  const max = options.maxPairs ?? 6000;
  for (const left of lefts) {
    for (const right of rights) {
      if (result.size >= max) break;
      if (left.name === right.name && left.category === "Number") continue;
      const lowerLower = left.category === "Lowercase" && right.category === "Lowercase";
      const upperUpper = left.category === "Uppercase" && right.category === "Uppercase";
      const mixed =
        (left.category === "Lowercase" && right.category === "Uppercase") ||
        (left.category === "Uppercase" && right.category === "Lowercase");
      const punctuation =
        left.category === "Punctuation" ||
        right.category === "Punctuation" ||
        left.category === "Symbol" ||
        right.category === "Symbol";
      const figures = left.category === "Number" || right.category === "Number";
      if (lowerLower && options.includeLowerLower === false) continue;
      if (upperUpper && options.includeUpperUpper === false) continue;
      if (mixed && options.includeMixedCase === false) continue;
      if (punctuation && options.includePunctuation === false) continue;
      if (figures && options.includeFigures === false) continue;
      result.add(kerningKey(left.name, right.name));
    }
  }
  return [...result];
}

export interface PairSample {
  y: number;
  gap: number;
  leftEdge: number;
  rightEdge: number;
  ink: boolean;
}

export function samplePair(
  project: FontProject,
  leftName: string,
  rightName: string,
  kern = resolveKerning(project, leftName, rightName),
  sampleCount = 24
): PairSample[] {
  const left = getGlyph(project, leftName);
  const right = getGlyph(project, rightName);
  if (!left || !right) return [];
  const leftBounds = glyphBounds(left);
  const rightBounds = glyphBounds(right);
  if (!leftBounds || !rightBounds) return [];
  const leftZone = zoneForGlyph(project, left);
  const rightZone = zoneForGlyph(project, right);
  const yStart = 0;
  const yEnd = Math.min(leftZone.yEnd, rightZone.yEnd);
  const samples: PairSample[] = [];
  const originRight = left.advanceWidth + kern;
  const leftPolygons = glyphPolygons(left);
  const rightPolygons = glyphPolygons(right);
  for (let i = 0; i < sampleCount; i++) {
    const t = (i + 0.5) / sampleCount;
    const y = yStart + (yEnd - yStart) * t;
    const leftExtent = inkExtentAtYFromPolygons(leftPolygons, y);
    const rightExtent = inkExtentAtYFromPolygons(rightPolygons, y);
    if (!leftExtent || !rightExtent) {
      samples.push({ y, gap: 0, leftEdge: 0, rightEdge: 0, ink: false });
      continue;
    }
    const leftEdge = leftExtent.maxX;
    const rightEdge = originRight + rightExtent.minX;
    samples.push({
      y,
      gap: rightEdge - leftEdge,
      leftEdge,
      rightEdge,
      ink: true,
    });
  }
  return samples;
}

export function minimumPairGap(
  project: FontProject,
  leftName: string,
  rightName: string,
  kern = resolveKerning(project, leftName, rightName)
): number | undefined {
  const samples = samplePair(project, leftName, rightName, kern).filter((sample) => sample.ink);
  if (!samples.length) return undefined;
  return Math.min(...samples.map((sample) => sample.gap));
}

export function averagePairGap(
  project: FontProject,
  leftName: string,
  rightName: string,
  kern = resolveKerning(project, leftName, rightName)
): number | undefined {
  const samples = samplePair(project, leftName, rightName, kern).filter((sample) => sample.ink);
  if (!samples.length) return undefined;
  return samples.reduce((sum, sample) => sum + sample.gap, 0) / samples.length;
}

/**
 * Optical target gap. Concave edges recede, so they need a smaller
 * sidebearing gap to look equal. The compensation factor controls this.
 */
export function targetPairGap(
  project: FontProject,
  leftName: string,
  rightName: string,
  baseGap: number,
  opticalCompensation = 0.55
): number {
  const left = getGlyph(project, leftName);
  const right = getGlyph(project, rightName);
  if (!left || !right) return baseGap;
  const leftZone = zoneForGlyph(project, left);
  const rightZone = zoneForGlyph(project, right);
  const leftProfile = sideProfile(left, "right", leftZone.yStart, leftZone.yEnd);
  const rightProfile = sideProfile(right, "left", rightZone.yStart, rightZone.yEnd);
  const retreat = leftProfile.averageExtra + rightProfile.averageExtra;
  return Math.max(0, baseGap - retreat * opticalCompensation);
}

export function suggestKerning(
  project: FontProject,
  leftName: string,
  rightName: string,
  params: AutoKernParams,
  baseGap: number,
  opticalCompensation = 0.55
): KerningSuggestion | undefined {
  const left = getGlyph(project, leftName);
  const right = getGlyph(project, rightName);
  if (!left || !right) return undefined;
  if (left.category === "Mark" || right.category === "Mark") return undefined;
  const leftSB = sidebearingsOf(left);
  const rightSB = sidebearingsOf(right);
  const currentKern = resolveKerning(project, leftName, rightName);
  const target = targetPairGap(project, leftName, rightName, baseGap, opticalCompensation);
  const targetKern = target - (leftSB.right + rightSB.left);
  let value = clamp(targetKern, params.minKern, params.maxKern);

  const samples = samplePair(project, leftName, rightName, currentKern).filter((sample) => sample.ink);
  const minGap = samples.length ? Math.min(...samples.map((sample) => sample.gap)) : undefined;
  const collision = minGap !== undefined && minGap < params.collisionGap;
  if (collision) {
    value = Math.max(value, currentKern + (params.collisionGap - minGap!));
    value = clamp(value, params.minKern, params.maxKern);
  }

  const delta = value - currentKern;
  if (Math.abs(delta) < params.threshold) return undefined;
  // Do not create pointless tiny pairs.
  if (Math.abs(value) < params.threshold && !collision) return undefined;

  const average = samples.length ? samples.reduce((s, x) => s + x.gap, 0) / samples.length : target;
  const variance = samples.length
    ? samples.reduce((s, x) => s + (x.gap - average) ** 2, 0) / samples.length
    : 0;
  const coverage = samples.length ? samples.length / 24 : 0;
  const confidence = clamp(
    0.55 + coverage * 0.3 - Math.min(0.25, Math.sqrt(variance) / 500),
    0.2,
    0.98
  );

  return {
    id: `kern:${leftName}:${rightName}`,
    left: leftName,
    right: rightName,
    value: Math.round(value),
    currentValue: currentKern,
    currentGap: leftSB.right + rightSB.left + currentKern,
    targetGap: target,
    confidence,
    collision,
    reason: collision
      ? `Collision at ${minGap?.toFixed(0)} units; minimum is ${params.collisionGap}.`
      : `Optical gap ${(leftSB.right + rightSB.left + currentKern).toFixed(0)} → ${target.toFixed(0)}; sidebearings account for the rest.`,
  };
}

export function autoKernSuggestions(
  project: FontProject,
  pairs: string[],
  params: AutoKernParams,
  baseGap: number,
  opticalCompensation = 0.55
): KerningSuggestion[] {
  const suggestions: KerningSuggestion[] = [];
  for (const key of pairs) {
    const [left, right] = splitKerningKey(key);
    if (left.startsWith("@") || right.startsWith("@")) continue;
    const suggestion = suggestKerning(project, left, right, params, baseGap, opticalCompensation);
    if (suggestion) suggestions.push(suggestion);
  }
  suggestions.sort((a, b) => Math.abs(b.value - b.currentValue) - Math.abs(a.value - a.currentValue));
  return suggestions;
}

export function applyKerningSuggestions(project: FontProject, suggestions: KerningSuggestion[]): void {
  for (const suggestion of suggestions) {
    setKerning(project, suggestion.left, suggestion.right, suggestion.value);
  }
}

export function removeSmallPairs(project: FontProject, threshold: number): number {
  let removed = 0;
  for (const [key, value] of Object.entries(activeSource(project).kerning)) {
    if (Math.abs(value) < threshold) {
      delete activeSource(project).kerning[key];
      removed += 1;
    }
  }
  return removed;
}

export function pruneRedundantExceptions(project: FontProject): number {
  let removed = 0;
  const kerning = activeSource(project).kerning;
  for (const [key, value] of Object.entries({ ...kerning })) {
    const [left, right] = splitKerningKey(key);
    if (left.startsWith("@") || right.startsWith("@")) continue;
    const groupValue = resolveKerningWithoutExact(project, left, right);
    if (groupValue === value) {
      delete kerning[key];
      removed += 1;
    }
  }
  return removed;
}

function resolveKerningWithoutExact(project: FontProject, left: string, right: string): number {
  const kerning = activeSource(project).kerning;
  const leftGroup = leftGroupOf(project, left);
  const rightGroup = rightGroupOf(project, right);
  if (leftGroup && rightGroup) {
    const value = kerning[kerningKey(`@${leftGroup}`, `@${rightGroup}`)];
    if (value !== undefined) return value;
  }
  if (leftGroup) {
    const value = kerning[kerningKey(`@${leftGroup}`, right)];
    if (value !== undefined) return value;
  }
  if (rightGroup) {
    const value = kerning[kerningKey(left, `@${rightGroup}`)];
    if (value !== undefined) return value;
  }
  return 0;
}

export function roundKerning(project: FontProject, step: number): number {
  let count = 0;
  for (const [key, value] of Object.entries(activeSource(project).kerning)) {
    const rounded = roundTo(value, step);
    if (rounded !== value) {
      activeSource(project).kerning[key] = rounded;
      count += 1;
    }
  }
  return count;
}

export function scaleKerning(project: FontProject, factor: number): void {
  for (const [key, value] of Object.entries(activeSource(project).kerning)) {
    activeSource(project).kerning[key] = Math.round(value * factor);
  }
}

export function shiftKerning(project: FontProject, amount: number): void {
  for (const [key, value] of Object.entries(activeSource(project).kerning)) {
    activeSource(project).kerning[key] = value + amount;
  }
}

export function autoAssignGroups(project: FontProject, overwrite = false): number {
  const source = activeSource(project);
  if (overwrite) {
    project.groups = { left: {}, right: {} };
  }
  let assigned = 0;
  for (const glyph of source.glyphs) {
    if (glyph.category === "Mark" || glyph.category === "Space") continue;
    const zone = zoneForGlyph(project, glyph);
    const leftClass = sideClass(glyph, "left", zone.yStart, zone.yEnd, project.unitsPerEm);
    const rightClass = sideClass(glyph, "right", zone.yStart, zone.yEnd, project.unitsPerEm);
    const categoryTag =
      glyph.category === "Uppercase" || glyph.category === "Smallcaps"
        ? "uc"
        : glyph.category === "Lowercase"
          ? "lc"
          : glyph.category === "Number"
            ? "num"
            : "punct";
    if (leftClass && (overwrite || !leftGroupOf(project, glyph.name))) {
      assignGlyphToGroup(project, "left", glyph.name, `${categoryTag}_${leftClass}_l`);
      assigned += 1;
    }
    if (rightClass && (overwrite || !rightGroupOf(project, glyph.name))) {
      assignGlyphToGroup(project, "right", glyph.name, `${categoryTag}_${rightClass}_r`);
      assigned += 1;
    }
  }
  return assigned;
}

function sideClass(
  glyph: Glyph,
  side: "left" | "right",
  yStart: number,
  yEnd: number,
  unitsPerEm: number
): "flat" | "round" | "open" | undefined {
  const profile = sideProfile(glyph, side, yStart, yEnd);
  if (profile.coverage < 0.1) return undefined;
  const normalized = profile.averageExtra / unitsPerEm;
  if (normalized < 0.04) return "flat";
  if (normalized < 0.1) return "round";
  return "open";
}

export function kerningDebt(project: FontProject, pairs: string[], threshold = 4): number {
  let count = 0;
  let total = 0;
  for (const key of pairs) {
    const [left, right] = splitKerningKey(key);
    const value = resolveKerning(project, left, right);
    if (Math.abs(value) >= threshold) {
      count += 1;
      total += Math.abs(value);
    }
  }
  return count ? total / count : 0;
}

export function kerningCoverage(project: FontProject, pairs: string[]): number {
  if (!pairs.length) return 100;
  let covered = 0;
  for (const key of pairs) {
    const [left, right] = splitKerningKey(key);
    if (hasExplicitKerning(project, left, right) || resolveKerning(project, left, right) !== 0) {
      covered += 1;
    }
  }
  return (covered / pairs.length) * 100;
}

export function overkernedPairs(
  project: FontProject,
  maxRatio = 0.4
): Array<{ left: string; right: string; value: number; ratio: number }> {
  const result: Array<{ left: string; right: string; value: number; ratio: number }> = [];
  for (const [key, value] of Object.entries(activeSource(project).kerning)) {
    if (value >= 0) continue;
    const [leftName, rightName] = splitKerningKey(key);
    if (leftName.startsWith("@") || rightName.startsWith("@")) continue;
    const left = getGlyph(project, leftName);
    const right = getGlyph(project, rightName);
    if (!left || !right) continue;
    const width = Math.min(glyphInkWidth(left), glyphInkWidth(right)) || 1;
    const ratio = Math.abs(value) / width;
    if (ratio > maxRatio) {
      result.push({ left: leftName, right: rightName, value, ratio });
    }
  }
  return result;
}

export function clearKerning(project: FontProject): void {
  activeSource(project).kerning = {};
}

export function deletePair(project: FontProject, left: string, right: string): void {
  deleteKerning(project, left, right);
}
