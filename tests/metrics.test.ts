import { describe, expect, it } from "vitest";
import { createTestProject } from "./fixtures";
import { applyMetricsKeys, getGlyph, metricsKeyFor } from "../src/core/project";
import { sidebearingsOf } from "../src/core/geometry";
import { runQA } from "../src/core/qa";

describe("metrics keys", () => {
  it("applies left and right keys from another glyph", () => {
    const project = createTestProject();
    const o = getGlyph(project, "o")!;
    const b = getGlyph(project, "b")!;
    o.metricsKeys = { left: "b", right: "b" };
    expect(metricsKeyFor(project, "o", "left")).toBe("b");
    const changed = applyMetricsKeys(project);
    expect(changed).toBe(2);
    const sb = sidebearingsOf(o);
    expect(sb.left).toBeCloseTo(sidebearingsOf(b).left, 6);
    expect(sb.right).toBeCloseTo(sidebearingsOf(b).right, 6);
  });

  it("ignores missing and self-referencing keys", () => {
    const project = createTestProject();
    const n = getGlyph(project, "n")!;
    n.metricsKeys = { left: "n", right: "does-not-exist" };
    expect(applyMetricsKeys(project)).toBe(0);
    expect(sidebearingsOf(n).left).toBe(40);
  });

  it("follows metrics-key chains", () => {
    const project = createTestProject();
    const n = getGlyph(project, "n")!;
    const b = getGlyph(project, "b")!;
    const o = getGlyph(project, "o")!;
    b.metricsKeys = { left: "n" };
    o.metricsKeys = { left: "b" };
    expect(applyMetricsKeys(project)).toBe(2);
    expect(sidebearingsOf(o).left).toBeCloseTo(sidebearingsOf(n).left, 6);
  });

  it("stops at cycles without corrupting glyphs", () => {
    const project = createTestProject();
    const a = getGlyph(project, "a")!;
    const b = getGlyph(project, "b")!;
    a.metricsKeys = { left: "b" };
    b.metricsKeys = { left: "a" };
    const beforeA = sidebearingsOf(a).left;
    const beforeB = sidebearingsOf(b).left;
    applyMetricsKeys(project);
    expect(sidebearingsOf(a).left).toBeCloseTo(beforeA, 6);
    expect(sidebearingsOf(b).left).toBeCloseTo(beforeB, 6);
  });

  it("is idempotent once applied", () => {
    const project = createTestProject();
    const o = getGlyph(project, "o")!;
    o.metricsKeys = { left: "b", right: "b" };
    expect(applyMetricsKeys(project)).toBe(2);
    expect(applyMetricsKeys(project)).toBe(0);
  });

  it("reports broken keys in QA", () => {
    const project = createTestProject();
    const n = getGlyph(project, "n")!;
    n.metricsKeys = { left: "n", right: "missing" };
    const issues = runQA(project, { collisionGap: 8, maxOverkernRatio: 0.4, checkCollisions: false });
    expect(issues.some((issue) => issue.id === "metricskey:self:n:left")).toBe(true);
    expect(issues.some((issue) => issue.id === "metricskey:missing:n:right")).toBe(true);
  });
});
