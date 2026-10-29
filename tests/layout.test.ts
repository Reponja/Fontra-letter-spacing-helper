import { describe, expect, it } from "vitest";
import { createTestProject } from "./fixtures";
import { layoutText } from "../src/render/layout";
import { setKerning } from "../src/core/project";
import { setCustomTracking, setTrackingPreset } from "../src/core/tracking";

describe("text layout", () => {
  it("lays out glyphs by advance width", () => {
    const project = createTestProject();
    const layout = layoutText(project, "no", { applyKerning: false, applyTracking: false });
    expect(layout.items.map((item) => item.glyph.name)).toEqual(["n", "o"]);
    expect(layout.items[0].x).toBe(0);
    expect(layout.items[1].x).toBe(500);
    expect(layout.totalWidth).toBe(1000);
  });

  it("applies kerning and tracking between glyphs", () => {
    const project = createTestProject();
    setKerning(project, "n", "o", -20);
    setCustomTracking(project, 100);
    const layout = layoutText(project, "no");
    expect(layout.items[1].kerning).toBe(-20);
    expect(layout.items[1].tracking).toBe(100);
    expect(layout.items[1].x).toBe(580);
  });

  it("uses the active tracking preset when tracking is enabled", () => {
    const project = createTestProject();
    setTrackingPreset(project, "loose");
    const layout = layoutText(project, "no", { applyKerning: false });
    expect(layout.items[1].tracking).toBe(20);
    expect(layout.items[1].x).toBe(520);
  });

  it("skips unknown characters without crashing", () => {
    const project = createTestProject();
    const layout = layoutText(project, "n☃o", { applyKerning: false, applyTracking: false });
    expect(layout.items.length).toBe(2);
    expect(layout.items[1].glyph.name).toBe("o");
    expect(layout.items[1].x).toBe(750);
  });

  it("resolves glyph names with a slash", () => {
    const project = createTestProject();
    const layout = layoutText(project, "/n/n", { applyKerning: false, applyTracking: false });
    expect(layout.items.map((item) => item.glyph.name)).toEqual(["n", "n"]);
  });
});
