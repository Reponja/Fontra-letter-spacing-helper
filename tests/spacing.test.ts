import { describe, expect, it } from "vitest";
import { createTestProject, flatSpacingParams } from "./fixtures";
import {
  applySpacingSuggestions,
  defaultTargetGap,
  spacingGroupsSummary,
  spacingHealth,
  spacingOutliers,
  spacingSuggestions,
  suggestSpacingForGlyph,
} from "../src/core/spacing";
import { getGlyph } from "../src/core/project";
import { sidebearingsOf } from "../src/core/geometry";

describe("spacing engine", () => {
  it("derives the default target gap from the key glyph", () => {
    const project = createTestProject();
    expect(defaultTargetGap(project, flatSpacingParams)).toBe(100);
  });

  it("proposes symmetric stems from the target gap", () => {
    const project = createTestProject();
    const n = getGlyph(project, "n")!;
    const suggestion = suggestSpacingForGlyph(project, n, flatSpacingParams)!;
    expect(suggestion).toBeDefined();
    expect(suggestion.proposedLeft).toBe(50);
    expect(suggestion.proposedRight).toBe(50);
    expect(suggestion.confidence).toBeGreaterThan(0.5);
  });

  it("does not propose spacing for space glyphs", () => {
    const project = createTestProject();
    const space = getGlyph(project, "space")!;
    expect(suggestSpacingForGlyph(project, space, flatSpacingParams)).toBeUndefined();
  });

  it("is non-destructive until suggestions are applied", () => {
    const project = createTestProject();
    const suggestions = spacingSuggestions(project, flatSpacingParams);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(sidebearingsOf(getGlyph(project, "n")!).left).toBe(40);
    applySpacingSuggestions(project, suggestions);
    // n already has 50/50 after one application.
    const again = spacingSuggestions(project, flatSpacingParams);
    expect(again.find((item) => item.glyphName === "n")).toBeUndefined();
  });

  it("applies spacing without changing ink width", () => {
    const project = createTestProject();
    const glyph = getGlyph(project, "b")!;
    const before = sidebearingsOf(glyph);
    const suggestions = spacingSuggestions(project, flatSpacingParams).filter(
      (item) => item.glyphName === "b"
    );
    applySpacingSuggestions(project, suggestions);
    const after = sidebearingsOf(glyph);
    expect(after.inkWidth).toBeCloseTo(before.inkWidth, 6);
    expect(after.left).toBeCloseTo(50, 6);
    expect(after.right).toBeCloseTo(50, 6);
  });

  it("summarizes groups and health", () => {
    const project = createTestProject();
    const summary = spacingGroupsSummary(project);
    expect(summary.leftGroups).toBe(0);
    expect(summary.ungrouped).toBeGreaterThan(0);
    const health = spacingHealth(project);
    expect(health.score).toBeGreaterThanOrEqual(0);
    expect(health.score).toBeLessThanOrEqual(100);
  });

  it("finds a deliberately bad glyph as an outlier", () => {
    const project = createTestProject();
    const outlier = getGlyph(project, "e")!;
    outlier.advanceWidth = 700;
    for (const contour of outlier.contours) {
      for (const command of contour.commands) {
        if (command.type !== "Z") command.x += 100;
      }
    }
    const outliers = spacingOutliers(project);
    expect(outliers.some((item) => item.glyphName === "e")).toBe(true);
  });
});
