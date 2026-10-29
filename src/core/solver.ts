import type { FontProject } from "./types";
import { clamp, roundTo, sidebearingsOf, applySidebearings } from "./geometry";
import { getGlyph, resolveKerning, setKerning, splitKerningKey, activeSource } from "./project";
import { targetPairGap } from "./kerning";

export interface SolverOptions {
  baseGap: number;
  opticalCompensation?: number;
  iterations?: number;
  /** How aggressively to move spacing instead of creating kerning. */
  spacingWeight?: number;
  /** Maximum sidebearing adjustment in font units. */
  maxSidebearingAdjust?: number;
  minKern?: number;
  maxKern?: number;
  roundTo?: number;
  /** Keep existing kerning for pairs not in the solve list. */
  preserveOtherKerning?: boolean;
}

export interface SolverResult {
  pairs: number;
  sidebearingsChanged: number;
  kerningPairs: number;
  averageKern: number;
  maxKern: number;
  iterations: number;
}

/**
 * Joint spacing + kerning solver.
 *
 * The target is an optical pair distance. Sidebearings are adjusted to absorb
 * as much of the residual as possible, then the remaining difference becomes
 * kerning. This is a lightweight iterative projection solver: it behaves like
 * a regularized least-squares fit without pulling in a heavyweight LP library.
 */
export function solveSpacingAndKerning(
  project: FontProject,
  pairKeys: string[],
  options: SolverOptions
): SolverResult {
  const {
    baseGap,
    opticalCompensation = 0.55,
    iterations = 48,
    spacingWeight = 0.68,
    maxSidebearingAdjust = 24,
    minKern = -250,
    maxKern = 180,
    roundTo: rounding = 1,
  } = options;

  const source = activeSource(project);
  const originalSides = new Map<string, { left: number; right: number }>();
  for (const glyph of source.glyphs) {
    const sb = sidebearingsOf(glyph);
    originalSides.set(glyph.name, { left: sb.left, right: sb.right });
  }

  const adjustLeft = new Map<string, number>();
  const adjustRight = new Map<string, number>();
  const targets = new Map<string, number>();
  const pairData: Array<{ left: string; right: string; key: string; target: number }> = [];

  for (const key of pairKeys) {
    const [left, right] = splitKerningKey(key);
    if (left.startsWith("@") || right.startsWith("@")) continue;
    const leftGlyph = getGlyph(project, left);
    const rightGlyph = getGlyph(project, right);
    if (!leftGlyph || !rightGlyph) continue;
    const target = targetPairGap(project, left, right, baseGap, opticalCompensation);
    pairData.push({ left, right, key, target });
    targets.set(key, target);
  }

  for (let iteration = 0; iteration < iterations; iteration++) {
    const deltaLeft = new Map<string, number>();
    const deltaRight = new Map<string, number>();
    for (const pair of pairData) {
      const leftGlyph = getGlyph(project, pair.left);
      const rightGlyph = getGlyph(project, pair.right);
      if (!leftGlyph || !rightGlyph) continue;
      const leftSB = sidebearingsOf(leftGlyph);
      const rightSB = sidebearingsOf(rightGlyph);
      const kern = resolveKerning(project, pair.left, pair.right);
      const currentGap = leftSB.right + rightSB.left + kern;
      const residual = pair.target - currentGap;
      const leftAdjust = (adjustRight.get(pair.left) ?? 0) + residual * spacingWeight * 0.5;
      const rightAdjust = (adjustLeft.get(pair.right) ?? 0) + residual * spacingWeight * 0.5;
      deltaRight.set(pair.left, (deltaRight.get(pair.left) ?? 0) + leftAdjust);
      deltaLeft.set(pair.right, (deltaLeft.get(pair.right) ?? 0) + rightAdjust);
    }
    for (const [glyphName, value] of deltaRight) {
      const current = adjustRight.get(glyphName) ?? 0;
      adjustRight.set(
        glyphName,
        clamp(current + value / pairData.length, -maxSidebearingAdjust, maxSidebearingAdjust)
      );
    }
    for (const [glyphName, value] of deltaLeft) {
      const current = adjustLeft.get(glyphName) ?? 0;
      adjustLeft.set(
        glyphName,
        clamp(current + value / pairData.length, -maxSidebearingAdjust, maxSidebearingAdjust)
      );
    }
  }

  let sidebearingsChanged = 0;
  for (const glyph of source.glyphs) {
    const leftAdjust = adjustLeft.get(glyph.name) ?? 0;
    const rightAdjust = adjustRight.get(glyph.name) ?? 0;
    if (Math.abs(leftAdjust) < 0.5 && Math.abs(rightAdjust) < 0.5) continue;
    const original = originalSides.get(glyph.name)!;
    const newLeft = roundTo(original.left + leftAdjust, rounding);
    const newRight = roundTo(original.right + rightAdjust, rounding);
    applySidebearings(glyph, newLeft, newRight);
    sidebearingsChanged += 1;
  }

  let kerningPairs = 0;
  let totalKern = 0;
  let maxKernValue = 0;
  for (const pair of pairData) {
    const leftGlyph = getGlyph(project, pair.left);
    const rightGlyph = getGlyph(project, pair.right);
    if (!leftGlyph || !rightGlyph) continue;
    const leftSB = sidebearingsOf(leftGlyph);
    const rightSB = sidebearingsOf(rightGlyph);
    const kern = clamp(
      roundTo(pair.target - (leftSB.right + rightSB.left), rounding),
      minKern,
      maxKern
    );
    if (Math.abs(kern) < 0.5) {
      // If the pair already had an explicit value, keep a clean zero only
      // when it is safe to remove it.
      if (resolveKerning(project, pair.left, pair.right) !== 0) {
        setKerning(project, pair.left, pair.right, 0);
      }
      continue;
    }
    setKerning(project, pair.left, pair.right, kern);
    kerningPairs += 1;
    totalKern += Math.abs(kern);
    maxKernValue = Math.max(maxKernValue, Math.abs(kern));
  }

  return {
    pairs: pairData.length,
    sidebearingsChanged,
    kerningPairs,
    averageKern: kerningPairs ? totalKern / kerningPairs : 0,
    maxKern: maxKernValue,
    iterations,
  };
}

export function solverPreview(
  project: FontProject,
  pairKeys: string[],
  options: SolverOptions
): SolverResult {
  const copy = structuredClone(project);
  return solveSpacingAndKerning(copy, pairKeys, options);
}
