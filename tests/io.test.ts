import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTestProject } from "./fixtures";
import { parseProjectJson, serializeProject } from "../src/core/io";
import { importFontraFromFiles, exportFontraZip } from "../src/core/import/fontra";
import { importUfoFromFiles, exportUfoZip } from "../src/core/import/ufo";
import { importOpentypeBuffer } from "../src/core/import/opentype";
import { exportOpentypeBuffer } from "../src/core/export/opentype";
import {
  assignGlyphToGroup,
  getGlyph,
  kerningKey,
  resolveKerning,
  setKerning,
} from "../src/core/project";
import { sidebearingsOf } from "../src/core/geometry";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

describe("native JSON import/export", () => {
  it("round-trips a project", () => {
    const project = createTestProject();
    setKerning(project, "n", "o", -20);
    const parsed = parseProjectJson(serializeProject(project));
    expect(parsed.name).toBe("Test Sans");
    expect(parsed.sources[0].glyphs.length).toBe(project.sources[0].glyphs.length);
    expect(resolveKerning(parsed, "n", "o")).toBe(-20);
  });

  it("rejects files that are not a Fit project", () => {
    expect(() => parseProjectJson(JSON.stringify({ hello: "world" }))).toThrow(/fit-font/);
  });
});

describe("Fontra import/export", () => {
  it("parses a Fontra glyph JSON with multiple curves", () => {
    const files = new Map<string, string>([
      [
        "font-data.json",
        JSON.stringify({
          sources: {
            abc: {
              name: "Regular",
              lineMetricsHorizontalLayout: {
                ascender: { value: 800 },
                descender: { value: -200 },
                xHeight: { value: 520 },
                capHeight: { value: 720 },
              },
            },
          },
        }),
      ],
      ["glyph-info.csv", "glyph name;code points\nx;U+0078"],
      [
        "glyphs/x.json",
        JSON.stringify({
          name: "x",
          layers: {
            abc: {
              glyph: {
                xAdvance: 480,
                path: {
                  contours: [
                    {
                      isClosed: true,
                      points: [
                        { x: 20, y: 0 },
                        { x: 120, y: 0, type: "cubic" },
                        { x: 220, y: 100, type: "cubic" },
                        { x: 320, y: 100 },
                        { x: 320, y: 0, type: "cubic" },
                        { x: 420, y: 0, type: "cubic" },
                        { x: 440, y: 300 },
                      ],
                    },
                  ],
                },
              },
            },
          },
        }),
      ],
    ]);
    const { project } = importFontraFromFiles(files, "X");
    expect(project.ascender).toBe(800);
    const glyph = getGlyph(project, "x")!;
    expect(glyph.advanceWidth).toBe(480);
    expect(glyph.unicode).toBe(0x78);
    // Two cubic segments should be preserved, not collapsed into one.
    expect(glyph.contours[0].commands.filter((command) => command.type === "C").length).toBe(2);
  });

  it("round-trips through a .fontra zip", () => {
    const project = createTestProject();
    setKerning(project, "n", "o", -18);
    project.groups.left.n_l = ["n"];
    project.groups.right.o_r = ["o"];
    project.tracking.activePreset = "loose";
    project.keyGlyphs.lowerStem = "o";
    getGlyph(project, "o")!.metricsKeys = { left: "n", right: "n" };
    const zip = exportFontraZip(project);
    const files = new Map<string, Uint8Array>();
    // The importer works with an in-memory file map, so unzip here with the
    // same library the app uses.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { unzipSync } = require("fflate") as typeof import("fflate");
    for (const [path, data] of Object.entries(unzipSync(zip))) {
      files.set(path, data);
    }
    const { project: imported } = importFontraFromFiles(files, "Roundtrip");
    expect(imported.sources[0].glyphs.length).toBe(project.sources[0].glyphs.length);
    const n = getGlyph(imported, "n")!;
    expect(n.advanceWidth).toBe(500);
    expect(sidebearingsOf(n).left).toBeCloseTo(40, 6);
    expect(sidebearingsOf(n).right).toBeCloseTo(60, 6);
    expect(imported.groups.left.n_l).toEqual(["n"]);
    expect(resolveKerning(imported, "n", "o")).toBe(-18);
    expect(getGlyph(imported, "o")!.metricsKeys).toEqual({ left: "n", right: "n" });
    expect(imported.tracking.activePreset).toBe("loose");
    expect(imported.keyGlyphs.lowerStem).toBe("o");
  });
});

describe("UFO import/export", () => {
  it("parses groups, kerning and a GLIF contour", () => {
    const files = new Map<string, string>([
      [
        "fontinfo.plist",
        `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
          <key>unitsPerEm</key><integer>1000</integer>
          <key>ascender</key><integer>750</integer>
          <key>descender</key><integer>-250</integer>
          <key>xHeight</key><integer>500</integer>
          <key>capHeight</key><integer>700</integer>
          <key>styleName</key><string>Regular</string>
        </dict></plist>`,
      ],
      [
        "groups.plist",
        `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
          <key>public.kern1.n_l</key><array><string>n</string></array>
          <key>public.kern2.o_r</key><array><string>o</string></array>
        </dict></plist>`,
      ],
      [
        "kerning.plist",
        `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
          <key>public.kern1.n_l</key><dict><key>public.kern2.o_r</key><integer>-25</integer></dict>
        </dict></plist>`,
      ],
      [
        "glyphs/contents.plist",
        `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
          <key>n</key><string>n.glif</string>
          <key>o</key><string>o.glif</string>
        </dict></plist>`,
      ],
      [
        "glyphs/n.glif",
        `<?xml version="1.0" encoding="UTF-8"?><glyph name="n" format="2">
          <advance width="500"/><unicode hex="006E"/>
          <outline><contour>
            <point x="40" y="0" type="line"/><point x="440" y="0" type="line"/>
            <point x="440" y="500" type="line"/><point x="40" y="500" type="line"/>
          </contour></outline>
        </glyph>`,
      ],
      [
        "glyphs/o.glif",
        `<?xml version="1.0" encoding="UTF-8"?><glyph name="o" format="2">
          <advance width="500"/><unicode hex="006F"/>
          <outline><contour>
            <point x="60" y="0" type="line"/><point x="440" y="0" type="line"/>
            <point x="440" y="500" type="line"/><point x="60" y="500" type="line"/>
          </contour></outline>
        </glyph>`,
      ],
    ]);
    const { project } = importUfoFromFiles(files, "UFO Test");
    expect(project.unitsPerEm).toBe(1000);
    expect(project.sources[0].glyphs.length).toBe(2);
    expect(project.groups.left.n_l).toEqual(["n"]);
    expect(resolveKerning(project, "n", "o")).toBe(-25);
  });

  it("round-trips through a .ufo zip", () => {
    const project = createTestProject();
    setKerning(project, "n", "o", -20);
    project.tracking.activePreset = "loose";
    project.keyGlyphs.lowerStem = "o";
    getGlyph(project, "o")!.metricsKeys = { left: "n" };
    const zip = exportUfoZip(project);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { unzipSync } = require("fflate") as typeof import("fflate");
    const files = new Map<string, string>();
    for (const [path, data] of Object.entries(unzipSync(zip))) {
      files.set(path, new TextDecoder().decode(data));
    }
    const { project: imported } = importUfoFromFiles(files, "Roundtrip");
    expect(imported.sources[0].glyphs.length).toBe(project.sources[0].glyphs.length);
    expect(resolveKerning(imported, "n", "o")).toBe(-20);
    expect(sidebearingsOf(getGlyph(imported, "o")!).left).toBeCloseTo(60, 6);
    expect(getGlyph(imported, "o")!.metricsKeys).toEqual({ left: "n" });
    expect(imported.tracking.activePreset).toBe("loose");
    expect(imported.keyGlyphs.lowerStem).toBe("o");
  });
});

describe("binary font import", () => {
  it("imports the bundled TTF", () => {
    const path = resolve(process.cwd(), "public/demo.ttf");
    const buffer = readFileSync(path);
    const arrayBuffer = toArrayBuffer(buffer);
    const { project, warnings } = importOpentypeBuffer(arrayBuffer, "Demo");
    expect(project.unitsPerEm).toBe(1000);
    expect(project.sources[0].glyphs.length).toBeGreaterThan(100);
    const n = getGlyph(project, "n");
    expect(n).toBeDefined();
    expect(n!.advanceWidth).toBeGreaterThan(0);
    expect(n!.contours.length).toBeGreaterThan(0);
    expect(Array.isArray(warnings)).toBe(true);
  });

  it("exports an OTF and reads it back, including group kerning", () => {
    const project = createTestProject();
    assignGlyphToGroup(project, "left", "n", "n_l");
    assignGlyphToGroup(project, "right", "o", "o_r");
    assignGlyphToGroup(project, "left", "a", "a_l");
    assignGlyphToGroup(project, "right", "b", "b_r");
    setKerning(project, "@n_l", "@o_r", -15);
    setKerning(project, "n", "o", -20);
    setKerning(project, "@a_l", "@b_r", -12);
    const buffer = exportOpentypeBuffer(project);
    expect(buffer.byteLength).toBeGreaterThan(1000);
    const { project: imported } = importOpentypeBuffer(buffer, "Roundtrip");
    expect(imported.unitsPerEm).toBe(1000);
    expect(getGlyph(imported, "n")!.advanceWidth).toBe(500);
    expect(getGlyph(imported, "o")!.contours.length).toBe(1);
    // The explicit exception wins over the expanded group pair.
    expect(resolveKerning(imported, "n", "o")).toBe(-20);
    expect(resolveKerning(imported, "a", "b")).toBe(-12);
  });

  it("converts quadratic TTF outlines when exporting an OTF", () => {
    const path = resolve(process.cwd(), "public/demo.ttf");
    const source = importOpentypeBuffer(toArrayBuffer(readFileSync(path)), "Demo").project;
    const otf = exportOpentypeBuffer(source);
    const { project: imported } = importOpentypeBuffer(otf, "Demo OTF");
    expect(imported.sources[0].glyphs.length).toBe(source.sources[0].glyphs.length);
    const n = getGlyph(imported, "n")!;
    expect(n.contours.length).toBeGreaterThan(0);
    expect(n.advanceWidth).toBe(getGlyph(source, "n")!.advanceWidth);
    // Quadratic segments become cubic, but they must still exist.
    expect(
      n.contours.some((contour) =>
        contour.commands.some((command) => command.type === "C" || command.type === "Q")
      )
    ).toBe(true);
  });
});
