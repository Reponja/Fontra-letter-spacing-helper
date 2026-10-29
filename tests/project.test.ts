import { describe, expect, it } from "vitest";
import {
  activeSource,
  assignGlyphToGroup,
  createEmptyProject,
  getGlyph,
  kerningKey,
  leftGroupOf,
  normalizeProject,
  resolveKerning,
  rightGroupOf,
  setKerning,
  splitKerningKey,
} from "../src/core/project";
import { applySidebearings, setAdvanceWidth, setSidebearing, sidebearingsOf } from "../src/core/geometry";
import { createTestProject } from "./fixtures";

describe("project model", () => {
  it("creates a normalized empty project", () => {
    const project = normalizeProject(createEmptyProject("Demo"));
    expect(project.format).toBe("fit-font");
    expect(project.version).toBe(1);
    expect(project.sources).toHaveLength(1);
    expect(project.groups.left).toEqual({});
    expect(project.tracking.presets.length).toBeGreaterThan(0);
  });

  it("round-trips kerning keys containing group markers", () => {
    const key = kerningKey("@left", "@right");
    expect(splitKerningKey(key)).toEqual(["@left", "@right"]);
  });

  it("resolves explicit kerning before group kerning", () => {
    const project = createTestProject();
    assignGlyphToGroup(project, "left", "n", "n_l");
    assignGlyphToGroup(project, "right", "o", "o_r");
    setKerning(project, "@n_l", "@o_r", -30);
    expect(resolveKerning(project, "n", "o")).toBe(-30);
    setKerning(project, "n", "o", -12);
    expect(resolveKerning(project, "n", "o")).toBe(-12);
    expect(leftGroupOf(project, "n")).toBe("n_l");
    expect(rightGroupOf(project, "o")).toBe("o_r");
  });

  it("moves a glyph when a sidebearing is set", () => {
    const project = createTestProject();
    const glyph = getGlyph(project, "n")!;
    const before = sidebearingsOf(glyph);
    expect(before.left).toBe(40);
    expect(before.right).toBe(60);
    setSidebearing(glyph, "left", 64);
    expect(sidebearingsOf(glyph).left).toBeCloseTo(64, 6);
    expect(sidebearingsOf(glyph).right).toBeCloseTo(60, 6);
    expect(glyph.advanceWidth).toBe(524);
  });

  it("sets both sidebearings and preserves the outline width", () => {
    const project = createTestProject();
    const glyph = getGlyph(project, "o")!;
    applySidebearings(glyph, 80, 120);
    const sb = sidebearingsOf(glyph);
    expect(sb.left).toBeCloseTo(80, 6);
    expect(sb.right).toBeCloseTo(120, 6);
    expect(sb.inkWidth).toBeCloseTo(380, 6);
    expect(glyph.advanceWidth).toBe(580);
  });

  it("changes only the advance when aligning left", () => {
    const project = createTestProject();
    const glyph = getGlyph(project, "n")!;
    setAdvanceWidth(glyph, 600);
    expect(glyph.advanceWidth).toBe(600);
    expect(sidebearingsOf(glyph).left).toBe(40);
  });

  it("exposes the active source", () => {
    const project = createTestProject();
    expect(activeSource(project).glyphs.length).toBe(project.sources[0].glyphs.length);
  });
});
