import { describe, expect, it } from "vitest";
import { createTestProject } from "./fixtures";
import { DEFAULT_QA_PARAMS, qaSummary, runQA } from "../src/core/qa";
import { assignGlyphToGroup, getGlyph, setKerning } from "../src/core/project";

describe("QA engine", () => {
  it("reports missing groups and low kerning coverage", () => {
    const project = createTestProject();
    const issues = runQA(project, DEFAULT_QA_PARAMS);
    expect(issues.some((issue) => issue.category === "Groups")).toBe(true);
    expect(issues.some((issue) => issue.id === "coverage:kerning")).toBe(true);
  });

  it("detects negative sidebearings", () => {
    const project = createTestProject();
    const glyph = getGlyph(project, "o")!;
    glyph.advanceWidth = 300;
    const issues = runQA(project, DEFAULT_QA_PARAMS);
    expect(issues.some((issue) => issue.id === "negative:o")).toBe(true);
  });

  it("detects collisions", () => {
    const project = createTestProject();
    setKerning(project, "n", "o", -160);
    const issues = runQA(project, { ...DEFAULT_QA_PARAMS, pairList: ["n\u0000o"] });
    expect(issues.some((issue) => issue.id === "collision:n:o")).toBe(true);
  });

  it("detects overkerned pairs", () => {
    const project = createTestProject();
    setKerning(project, "n", "o", -250);
    const issues = runQA(project, { ...DEFAULT_QA_PARAMS, pairList: ["n\u0000o"] });
    expect(issues.some((issue) => issue.id === "overkern:n:o")).toBe(true);
  });

  it("flags redundant exceptions", () => {
    const project = createTestProject();
    assignGlyphToGroup(project, "left", "n", "n_l");
    assignGlyphToGroup(project, "right", "o", "o_r");
    setKerning(project, "@n_l", "@o_r", -20);
    setKerning(project, "n", "o", -20);
    const issues = runQA(project, DEFAULT_QA_PARAMS);
    expect(issues.some((issue) => issue.id === "redundant:n:o")).toBe(true);
  });

  it("flags large tracking", () => {
    const project = createTestProject();
    project.tracking.activePreset = "custom";
    project.tracking.customPerMille = 120;
    const issues = runQA(project, DEFAULT_QA_PARAMS);
    expect(issues.some((issue) => issue.id === "tracking:large")).toBe(true);
  });

  it("scores issues by severity", () => {
    const summary = qaSummary([
      { id: "a", severity: "error", category: "x", title: "x", detail: "x" },
      { id: "b", severity: "warning", category: "x", title: "x", detail: "x" },
      { id: "c", severity: "info", category: "x", title: "x", detail: "x" },
    ]);
    expect(summary.errors).toBe(1);
    expect(summary.warnings).toBe(1);
    expect(summary.info).toBe(1);
    expect(summary.score).toBeLessThan(100);
  });
});
