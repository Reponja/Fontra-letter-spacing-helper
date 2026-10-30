import type {
  FontProject,
  Glyph,
  Sidebearings,
  SpacingParams,
  SpacingSuggestion,
} from "./types";
import {
  applySidebearings,
  classifySide,
  clamp,
  glyphBounds,
  isSpacingGlyph,
  measureKeyStem,
  roundTo,
  sideProfile,
  sidebearingsOf,
  zoneForGlyph,
} from "./geometry";
import {
  activeSource,
  getGlyph,
  leftGroupOf,
  resolvedMetricsSide,
  rightGroupOf,
} from "./project";
import { median } from "./path";

export const DEFAULT_SPACING_PARAMS: SpacingParams = {
  method: "hybrid",
  targetGap: 0,
  targetGapScale: 1,
  targetMode: "key",
  opticalCompensation: 0.65,
  stemWeight: 0.5,
  strength: 1,
  roundAdjust: 0,
  openAdjust: 0,
  minSidebearing: 4,
  maxSidebearing: 500,
  keyLower: "n",
  keyUpper: "H",
  zone: "auto",
  roundTo: 1,
  lowercaseGapScale: 1,
  uppercaseGapScale: 1,
  punctuationGapScale: 1,
  respectMetricsKeys: true,
};

function keyCandidates(project: FontProject, params: SpacingParams): string[] {
  const keys = project.keyGlyphs;
  return [
    keys?.lowerStem || params.keyLower,
    keys?.lowerRound || "o",
    keys?.upperStem || params.keyUpper,
    keys?.upperRound || "O",
  ].filter(Boolean);
}

function medianKeyGap(project: FontProject, params: SpacingParams): number | undefined {
  const totals: number[] = [];
  for (const name of keyCandidates(project, params)) {
    const glyph = getGlyph(project, name);
    if (!glyph) continue;
    const sb = sidebearingsOf(glyph);
    if (sb.left + sb.right > 0) totals.push(sb.left + sb.right);
  }
  if (!totals.length) return undefined;
  return median(totals);
}

export function defaultTargetGap(project: FontProject, params: SpacingParams): number {
  const scale = params.targetGapScale ?? 1;
  if (params.targetGap > 0) {
    return params.targetGap * scale;
  }
  const lowerKey = project.keyGlyphs?.lowerStem || params.keyLower;
  const upperKey = project.keyGlyphs?.upperStem || params.keyUpper;
  if (params.targetMode === "median") {
    const medianGap = medianKeyGap(project, params);
    if (medianGap !== undefined && medianGap > 0) {
      return medianGap * scale;
    }
  }
  const lower = getGlyph(project, lowerKey);
  if (lower) {
    const sb = sidebearingsOf(lower);
    if (sb.left + sb.right > 0) {
      return (sb.left + sb.right) * scale;
    }
  }
  const upper = getGlyph(project, upperKey);
  if (upper) {
    const sb = sidebearingsOf(upper);
    if (sb.left + sb.right > 0) {
      return (sb.left + sb.right) * scale;
    }
  }
  const stem = measureKeyStem(project, lowerKey, params.zone);
  if (stem.interval > 0) {
    return stem.interval * 0.55 * scale;
  }
  return project.unitsPerEm * 0.18 * scale;
}

/**
 * Category-specific multiplier applied to the global target gap. Designers
 * often want punctuation tighter than letters, or uppercase looser than
 * lowercase even when both are derived from the same rhythm.
 */
export function categoryGapScale(
  params: SpacingParams,
  category: Glyph["category"]
): number {
  switch (category) {
    case "Uppercase":
    case "Smallcaps":
    case "Number":
      return params.uppercaseGapScale ?? 1;
    case "Punctuation":
    case "Symbol":
      return params.punctuationGapScale ?? 1;
    case "Lowercase":
      return params.lowercaseGapScale ?? 1;
    default:
      return 1;
  }
}

function shapeAdjustment(
  sideClass: string,
  params: SpacingParams
): number {
  if (sideClass === "round") return params.roundAdjust ?? 0;
  if (sideClass === "soft") return (params.roundAdjust ?? 0) * 0.4;
  if (sideClass === "open") return params.openAdjust ?? 0;
  return 0;
}

function keyForSide(
  project: FontProject,
  glyph: Glyph,
  side: "left" | "right",
  params: SpacingParams
): { keyName: string; keyGlyph: Glyph | undefined; sideClass: string } {
  const { yStart, yEnd } = zoneForGlyph(project, glyph, params.zone);
  const sideClass = classifySide(glyph, side, yStart, yEnd, project.unitsPerEm);
  const isUpper =
    glyph.category === "Uppercase" ||
    glyph.category === "Smallcaps" ||
    glyph.category === "Number";
  const stemKey = isUpper
    ? project.keyGlyphs?.upperStem || params.keyUpper
    : project.keyGlyphs?.lowerStem || params.keyLower;
  const roundKey = isUpper
    ? project.keyGlyphs?.upperRound || "O"
    : project.keyGlyphs?.lowerRound || "o";
  const keyName =
    sideClass === "round" || sideClass === "open" ? roundKey : stemKey;
  return { keyName, keyGlyph: getGlyph(project, keyName), sideClass };
}

function keySidebearing(
  keyGlyph: Glyph | undefined,
  side: "left" | "right"
): number {
  if (!keyGlyph) return 0;
  return sidebearingsOf(keyGlyph)[side];
}

function keyConcavity(
  project: FontProject,
  keyGlyph: Glyph | undefined,
  side: "left" | "right",
  params: SpacingParams
): number {
  if (!keyGlyph) return 0;
  const { yStart, yEnd } = zoneForGlyph(project, keyGlyph, params.zone);
  return sideProfile(keyGlyph, side, yStart, yEnd).averageExtra;
}

export function suggestSpacingForGlyph(
  project: FontProject,
  glyph: Glyph,
  params: SpacingParams,
  targetGap = defaultTargetGap(project, params)
): SpacingSuggestion | undefined {
  if (!isSpacingGlyph(glyph)) return undefined;
  const bounds = glyphBounds(glyph);
  if (!bounds) return undefined;
  const current = sidebearingsOf(glyph);
  const { yStart, yEnd } = zoneForGlyph(project, glyph, params.zone);
  const glyphGap = targetGap * categoryGapScale(params, glyph.category);
  const halfGap = glyphGap / 2;
  const stemWeight = clamp(params.stemWeight ?? 0.5, 0, 1);
  const strength = clamp(params.strength ?? 1, 0, 1);
  const opticalCompensation = params.opticalCompensation ?? 0.65;
  let proposedLeft = current.left;
  let proposedRight = current.right;
  let confidence = 0.55;
  const reasons: string[] = [];

  for (const side of ["left", "right"] as const) {
    const { keyName, keyGlyph, sideClass } = keyForSide(project, glyph, side, params);
    const profile = sideProfile(glyph, side, yStart, yEnd);
    const keyProfileExtra = keyConcavity(project, keyGlyph, side, params);
    const extraDelta = profile.averageExtra - keyProfileExtra;
    const keyBase = keyGlyph
      ? keySidebearing(keyGlyph, side)
      : halfGap;
    const stemBase = halfGap;
    const stemValue = stemBase - profile.averageExtra * opticalCompensation;
    const opticalValue = keyBase - extraDelta * opticalCompensation;
    const hybridValue = stemValue * stemWeight + opticalValue * (1 - stemWeight);
    let value: number;
    if (params.method === "stem") {
      value = stemValue;
    } else if (params.method === "optical") {
      value = opticalValue;
    } else {
      value = hybridValue;
    }
    const currentSide = side === "left" ? current.left : current.right;
    const lockedKey = params.respectMetricsKeys
      ? glyph.metricsKeys?.[side]
      : undefined;
    if (lockedKey) {
      // A metrics key owns this side; auto-spacing must not fight it.
      value = resolvedMetricsSide(project, glyph.name, side) ?? currentSide;
      reasons.push(`${side} locked by =${lockedKey}`);
    } else {
      value += shapeAdjustment(sideClass, params);
      value = currentSide + (value - currentSide) * strength;
      value = clamp(value, params.minSidebearing, params.maxSidebearing);
    }
    value = roundTo(value, params.roundTo || 1);
    if (side === "left") {
      proposedLeft = value;
    } else {
      proposedRight = value;
    }
    if (keyGlyph) {
      confidence += 0.15;
      reasons.push(
        `${side} follows ${keyName} (${sideClass}${profile.coverage > 0.5 ? "" : ", sparse"})`
      );
    } else {
      confidence -= 0.15;
      reasons.push(`${side} uses parametric stem rhythm (${sideClass})`);
    }
    if (profile.coverage < 0.35) confidence -= 0.05;
  }

  confidence = clamp(confidence, 0.25, 0.97);
  if (Math.abs(proposedLeft - current.left) < 0.5 && Math.abs(proposedRight - current.right) < 0.5) {
    return undefined;
  }
  return {
    id: `space:${glyph.name}`,
    glyphName: glyph.name,
    currentLeft: current.left,
    currentRight: current.right,
    proposedLeft,
    proposedRight,
    confidence,
    reason: reasons.join("; "),
    method: params.method,
  };
}

export function spacingSuggestions(
  project: FontProject,
  params: SpacingParams
): SpacingSuggestion[] {
  const targetGap = defaultTargetGap(project, params);
  const suggestions: SpacingSuggestion[] = [];
  for (const glyph of activeSource(project).glyphs) {
    const suggestion = suggestSpacingForGlyph(project, glyph, params, targetGap);
    if (suggestion) suggestions.push(suggestion);
  }
  suggestions.sort(
    (a, b) =>
      Math.abs(b.proposedLeft - b.currentLeft) +
      Math.abs(b.proposedRight - b.currentRight) -
      (Math.abs(a.proposedLeft - a.currentLeft) + Math.abs(a.proposedRight - a.currentRight))
  );
  return suggestions;
}

export function applySpacingSuggestions(
  project: FontProject,
  suggestions: SpacingSuggestion[]
): void {
  for (const suggestion of suggestions) {
    const glyph = getGlyph(project, suggestion.glyphName);
    if (!glyph) continue;
    applySidebearings(glyph, suggestion.proposedLeft, suggestion.proposedRight);
  }
}

export function autoSpaceAll(project: FontProject, params: SpacingParams): SpacingSuggestion[] {
  const suggestions = spacingSuggestions(project, params);
  applySpacingSuggestions(project, suggestions);
  return suggestions;
}

export interface SpacingOutlier {
  glyphName: string;
  side: "left" | "right";
  value: number;
  median: number;
  deviation: number;
  category: string;
}

/**
 * Finds sidebearings that are far from the median of their shape category.
 * This is deliberately conservative: it is a review prompt, not a verdict.
 */
export function spacingOutliers(project: FontProject): SpacingOutlier[] {
  const groups = new Map<string, Array<{ glyph: Glyph; sb: Sidebearings }>>();
  for (const glyph of activeSource(project).glyphs) {
    if (!isSpacingGlyph(glyph)) continue;
    const bounds = glyphBounds(glyph);
    if (!bounds) continue;
    const zone = zoneForGlyph(project, glyph);
    const left = classifySide(glyph, "left", zone.yStart, zone.yEnd, project.unitsPerEm);
    const right = classifySide(glyph, "right", zone.yStart, zone.yEnd, project.unitsPerEm);
    const key = `${glyph.category}:${left}:${right}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ glyph, sb: sidebearingsOf(glyph) });
  }
  const outliers: SpacingOutlier[] = [];
  for (const [category, items] of groups) {
    if (items.length < 4) continue;
    for (const side of ["left", "right"] as const) {
      const values = items.map((item) => item.sb[side]);
      const med = median(values);
      const deviations = values.map((value) => Math.abs(value - med));
      const mad = median(deviations) || 1;
      for (const item of items) {
        const deviation = Math.abs(item.sb[side] - med);
        if (deviation > Math.max(3 * mad, project.unitsPerEm * 0.025)) {
          outliers.push({
            glyphName: item.glyph.name,
            side,
            value: item.sb[side],
            median: med,
            deviation,
            category,
          });
        }
      }
    }
  }
  return outliers.sort((a, b) => b.deviation - a.deviation);
}

export interface SpacingHealth {
  score: number;
  outliers: number;
  negative: number;
  collisions: number;
  kerningDebt: number;
}

export function spacingHealth(project: FontProject): SpacingHealth {
  const outliers = spacingOutliers(project);
  let negative = 0;
  let collisions = 0;
  const glyphs = activeSource(project).glyphs;
  for (const glyph of glyphs) {
    if (!isSpacingGlyph(glyph)) continue;
    const bounds = glyphBounds(glyph);
    if (!bounds) continue;
    const sb = sidebearingsOf(glyph);
    if (sb.left < 0 || sb.right < 0) negative += 1;
  }
  // A cheap collision proxy: any two glyphs whose sidebearings are both
  // very small are likely to collide. The kerning QA has the real scan.
  for (const glyph of glyphs) {
    const sb = sidebearingsOf(glyph);
    if (sb.left <= 1 || sb.right <= 1) collisions += 1;
  }
  const score = Math.max(
    0,
    Math.round(100 - outliers.length * 1.4 - negative * 3 - collisions * 0.5)
  );
  return {
    score,
    outliers: outliers.length,
    negative,
    collisions,
    kerningDebt: 0,
  };
}

export function spacingGroupsSummary(project: FontProject): {
  leftGroups: number;
  rightGroups: number;
  ungrouped: number;
} {
  const glyphs = activeSource(project).glyphs.filter(isSpacingGlyph);
  const ungrouped = glyphs.filter(
    (glyph) => !leftGroupOf(project, glyph.name) || !rightGroupOf(project, glyph.name)
  ).length;
  return {
    leftGroups: Object.keys(project.groups.left).length,
    rightGroups: Object.keys(project.groups.right).length,
    ungrouped,
  };
}
