import { describe, expect, it } from "vitest";
import { createTestProject } from "./fixtures";
import {
  currentTrackingPerMille,
  generateTrackingFeatures,
  setCustomTracking,
  setTrackingPreset,
  trackingAdvance,
  trackingCss,
  trackingCsv,
  trackingJson,
  trackingRamp,
  trackingUnits,
} from "../src/core/tracking";

describe("tracking and export", () => {
  it("resolves preset tracking values", () => {
    const project = createTestProject();
    setTrackingPreset(project, "loose");
    expect(currentTrackingPerMille(project)).toBe(20);
    expect(trackingUnits(project)).toBe(20);
    expect(trackingAdvance(project, 2000)).toBe(40);
  });

  it("supports custom tracking", () => {
    const project = createTestProject();
    setCustomTracking(project, 75);
    expect(project.tracking.activePreset).toBe("custom");
    expect(currentTrackingPerMille(project)).toBe(75);
    expect(trackingUnits(project)).toBe(75);
  });

  it("generates OpenType feature code", () => {
    const project = createTestProject();
    setCustomTracking(project, 25);
    const features = generateTrackingFeatures(project);
    expect(features).toContain("feature kern");
    expect(features).toContain("pos @FIT_All <0 0 25 0>");
    expect(features).toContain("feature cpsp");
    expect(features).toContain("@FIT_Uppercase = [H O A V]");
  });

  it("generates CSS, JSON and CSV", () => {
    const project = createTestProject();
    setCustomTracking(project, 50);
    expect(trackingCss(project)).toContain("letter-spacing: 0.0500em");
    const json = JSON.parse(trackingJson(project));
    expect(json.font).toBe("Test Sans");
    expect(json.trackingPerMille).toBe(50);
    expect(json.css).toBe("0.0500em");
    const csv = trackingCsv(project);
    expect(csv.split("\n")[0]).toBe("preset,perMille,em,note");
    expect(csv).toContain('"Text",0,0.0000,"Body copy"');
  });

  it("produces an optical-size ramp", () => {
    const project = createTestProject();
    const ramp = trackingRamp(project);
    expect(ramp.length).toBeGreaterThan(8);
    const small = ramp.find((step) => step.size === 6)!;
    const display = ramp.find((step) => step.size === 144)!;
    expect(small.perMille).toBeGreaterThan(display.perMille);
  });
});
