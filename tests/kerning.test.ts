import { describe, expect, it } from "vitest";
import { createTestProject, testAutoKernParams } from "./fixtures";
import {
  applyKerningSuggestions,
  autoAssignGroups,
  autoKernSuggestions,
  defaultPairList,
  kerningCoverage,
  kerningDebt,
  minimumPairGap,
  overkernedPairs,
  pruneRedundantExceptions,
  removeSmallPairs,
  roundKerning,
  samplePair,
  scaleKerning,
  suggestKerning,
  targetPairGap,
} from "../src/core/kerning";
import { assignGlyphToGroup, kerningKey, resolveKerning, setKerning } from "../src/core/project";

describe("kerning engine", () => {
  it("builds a default pair list", () => {
    const project = createTestProject();
    const pairs = defaultPairList(project);
    expect(pairs.length).toBeGreaterThan(50);
    expect(pairs).toContain(kerningKey("n", "o"));
  });

  it("samples the optical gap of a pair", () => {
    const project = createTestProject();
    const samples = samplePair(project, "n", "o", 0);
    expect(samples.length).toBe(24);
    expect(samples.every((sample) => sample.ink)).toBe(true);
    // n RSB 60 + o LSB 60 = 120.
    expect(samples[0].gap).toBeCloseTo(120, 6);
  });

  it("proposes negative kerning for a pair that is too open", () => {
    const project = createTestProject();
    const suggestion = suggestKerning(project, "n", "o", testAutoKernParams, 100, 0)!;
    expect(suggestion).toBeDefined();
    expect(suggestion.value).toBe(-20);
    expect(suggestion.currentValue).toBe(0);
    expect(suggestion.collision).toBe(false);
  });

  it("respects explicit kerning when computing the target", () => {
    const project = createTestProject();
    setKerning(project, "n", "o", -20);
    const target = targetPairGap(project, "n", "o", 100, 0);
    expect(target).toBe(100);
    expect(resolveKerning(project, "n", "o")).toBe(-20);
    const suggestion = suggestKerning(project, "n", "o", testAutoKernParams, 100, 0);
    expect(suggestion).toBeUndefined();
  });

  it("detects collisions and refuses to make them worse", () => {
    const project = createTestProject();
    setKerning(project, "n", "o", -150);
    expect(minimumPairGap(project, "n", "o")).toBeLessThan(0);
    const suggestion = suggestKerning(project, "n", "o", testAutoKernParams, 100, 0)!;
    expect(suggestion.collision).toBe(true);
    expect(suggestion.value).toBeGreaterThan(-150);
  });

  it("applies suggestions and reports improved pair distances", () => {
    const project = createTestProject();
    const suggestion = suggestKerning(project, "n", "o", testAutoKernParams, 100, 0)!;
    applyKerningSuggestions(project, [suggestion]);
    expect(resolveKerning(project, "n", "o")).toBe(-20);
    expect(minimumPairGap(project, "n", "o")).toBeCloseTo(100, 6);
  });

  it("auto-assigns left and right groups", () => {
    const project = createTestProject();
    const assigned = autoAssignGroups(project, true);
    expect(assigned).toBeGreaterThan(0);
    expect(Object.keys(project.groups.left).length).toBeGreaterThan(0);
    expect(Object.keys(project.groups.right).length).toBeGreaterThan(0);
  });

  it("rounds, scales and prunes kerning", () => {
    const project = createTestProject();
    setKerning(project, "n", "o", -12);
    setKerning(project, "o", "n", -2);
    expect(roundKerning(project, 5)).toBe(2);
    expect(resolveKerning(project, "n", "o")).toBe(-10);
    scaleKerning(project, 0.5);
    expect(resolveKerning(project, "n", "o")).toBe(-5);
    expect(removeSmallPairs(project, 2)).toBe(1);
  });

  it("removes exceptions that merely duplicate a group value", () => {
    const project = createTestProject();
    assignGlyphToGroup(project, "left", "n", "n_l");
    assignGlyphToGroup(project, "right", "o", "o_r");
    setKerning(project, "@n_l", "@o_r", -30);
    setKerning(project, "n", "o", -30);
    expect(pruneRedundantExceptions(project)).toBe(1);
    expect(resolveKerning(project, "n", "o")).toBe(-30);
  });

  it("reports coverage, debt and overkerned pairs", () => {
    const project = createTestProject();
    setKerning(project, "n", "o", -250);
    const pairs = [kerningKey("n", "o"), kerningKey("o", "n")];
    expect(kerningCoverage(project, pairs)).toBe(50);
    expect(kerningDebt(project, pairs)).toBe(250);
    expect(overkernedPairs(project, 0.2).length).toBe(1);
  });

  it("uses the pair list when generating suggestions", () => {
    const project = createTestProject();
    const pairs = [kerningKey("n", "o"), kerningKey("a", "b")];
    const suggestions = autoKernSuggestions(project, pairs, testAutoKernParams, 100, 0);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((item) => item.left && item.right)).toBe(true);
  });
});
