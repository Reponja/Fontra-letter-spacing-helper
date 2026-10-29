import { describe, expect, it } from "vitest";
import { createTestProject } from "./fixtures";
import { solveSpacingAndKerning, solverPreview } from "../src/core/solver";
import { defaultPairList, minimumPairGap } from "../src/core/kerning";
import { getGlyph, resolveKerning } from "../src/core/project";
import { sidebearingsOf } from "../src/core/geometry";

describe("spacing + kerning solver", () => {
  it("returns a useful result summary", () => {
    const project = createTestProject();
    const pairs = defaultPairList(project);
    const before = structuredClone(project);
    const result = solveSpacingAndKerning(project, pairs, { baseGap: 100, maxSidebearingAdjust: 20 });
    expect(result.pairs).toBeGreaterThan(0);
    expect(result.sidebearingsChanged).toBeGreaterThan(0);
    expect(result.kerningPairs).toBeGreaterThan(0);
    expect(result.iterations).toBe(48);
    // At least one glyph actually moved.
    const moved = project.sources[0].glyphs.some((glyph) => {
      const original = before.sources[0].glyphs.find((item) => item.name === glyph.name)!;
      const a = sidebearingsOf(glyph);
      const b = sidebearingsOf(original);
      return Math.abs(a.left - b.left) > 0.4 || Math.abs(a.right - b.right) > 0.4;
    });
    expect(moved).toBe(true);
  });

  it("keeps line gaps close to the base target", () => {
    const project = createTestProject();
    const pairs = defaultPairList(project);
    solveSpacingAndKerning(project, pairs, {
      baseGap: 100,
      opticalCompensation: 0,
      maxSidebearingAdjust: 24,
    });
    const gap = minimumPairGap(project, "n", "o")!;
    expect(Math.abs(gap - 100)).toBeLessThan(2.5);
  });

  it("does not modify the input when previewing", () => {
    const project = createTestProject();
    const before = structuredClone(project);
    const pairs = defaultPairList(project);
    solverPreview(project, pairs, { baseGap: 100 });
    expect(JSON.stringify(project)).toBe(JSON.stringify(before));
  });

  it("clamps kerning to the configured range", () => {
    const project = createTestProject();
    solveSpacingAndKerning(project, ["n\u0000o"], {
      baseGap: 100,
      maxSidebearingAdjust: 0,
      minKern: -5,
      maxKern: 5,
    });
    const value = resolveKerning(project, "n", "o");
    expect(value).toBeGreaterThanOrEqual(-5);
    expect(value).toBeLessThanOrEqual(5);
    expect(sidebearingsOf(getGlyph(project, "n")!).left).toBe(40);
  });
});
