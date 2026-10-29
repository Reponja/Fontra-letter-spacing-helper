import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { exportDesignspaceZip, importDesignspaceFromFiles } from "../src/core/import/designspace";
import { getGlyph } from "../src/core/project";
import { createTestProject } from "./fixtures";

function ufoFiles(dir: string, advance: number, style: string): Array<[string, string]> {
  return [
    [
      `${dir}/fontinfo.plist`,
      `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
        <key>unitsPerEm</key><integer>1000</integer>
        <key>ascender</key><integer>750</integer>
        <key>descender</key><integer>-250</integer>
        <key>xHeight</key><integer>500</integer>
        <key>capHeight</key><integer>700</integer>
        <key>styleName</key><string>${style}</string>
      </dict></plist>`,
    ],
    [
      `${dir}/glyphs/contents.plist`,
      `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
        <key>n</key><string>n.glif</string>
      </dict></plist>`,
    ],
    [
      `${dir}/glyphs/n.glif`,
      `<?xml version="1.0" encoding="UTF-8"?><glyph name="n" format="2">
        <advance width="${advance}"/><unicode hex="006E"/>
        <outline><contour>
          <point x="40" y="0" type="line"/><point x="140" y="0" type="line"/>
          <point x="140" y="500" type="line"/><point x="40" y="500" type="line"/>
        </contour></outline>
      </glyph>`,
    ],
  ];
}

describe("designspace import", () => {
  it("loads multiple UFO sources and picks the default axis location", () => {
    const designspace = `<?xml version="1.0" encoding="UTF-8"?>
      <designspace format="5.0">
        <axes>
          <axis tag="wght" name="Weight" minimum="100" maximum="900" default="400"/>
        </axes>
        <sources>
          <source filename="Test-Regular.ufo" name="Regular" stylename="Regular">
            <location><dimension name="Weight" xvalue="400"/></location>
          </source>
          <source filename="Test-Bold.ufo" name="Bold" stylename="Bold">
            <location><dimension name="Weight" xvalue="700"/></location>
          </source>
        </sources>
      </designspace>`;
    const files = new Map<string, string>([
      ["Test.designspace", designspace],
      ...ufoFiles("Test-Regular.ufo", 500, "Regular"),
      ...ufoFiles("Test-Bold.ufo", 600, "Bold"),
    ]);
    const { project, warnings } = importDesignspaceFromFiles(files, "Test Family");
    expect(warnings).toEqual([]);
    expect(project.sources).toHaveLength(2);
    expect(project.activeSource).toBe(0);
    expect(project.sources[0].name).toBe("Regular");
    expect(project.sources[1].name).toBe("Bold");
    expect(project.sources[0].location).toEqual({ Weight: 400 });
    expect(project.sources[1].location).toEqual({ Weight: 700 });
    expect(getGlyph(project, "n", 0)!.advanceWidth).toBe(500);
    expect(getGlyph(project, "n", 1)!.advanceWidth).toBe(600);
    expect(project.metadata?.sourceFormat).toBe("designspace");
  });

  it("throws when the designspace has no readable sources", () => {
    const files = new Map<string, string>([
      [
        "Empty.designspace",
        `<designspace><sources><source filename="Missing.ufo"/></sources></designspace>`,
      ],
    ]);
    expect(() => importDesignspaceFromFiles(files)).toThrow(/readable UFO sources/);
  });

  it("exports a designspace zip with all masters and reads it back", () => {
    const project = createTestProject();
    project.sources[0].name = "Light";
    project.sources[0].location = { Weight: 300 };
    const bold = structuredClone(project.sources[0]);
    bold.name = "Bold";
    bold.location = { Weight: 700 };
    bold.glyphs = bold.glyphs.map((glyph) =>
      glyph.name === "n" ? { ...glyph, advanceWidth: 640 } : glyph
    );
    project.sources.push(bold);
    project.tracking.activePreset = "loose";

    const zip = exportDesignspaceZip(project);
    const unzipped = unzipSync(zip);
    const names = Object.keys(unzipped);
    expect(names.some((name) => name.endsWith(".designspace"))).toBe(true);
    expect(names.filter((name) => name.endsWith("/fontinfo.plist")).length).toBe(2);

    const files = new Map<string, string>();
    for (const [path, data] of Object.entries(unzipped)) {
      files.set(path, new TextDecoder().decode(data));
    }
    const { project: imported } = importDesignspaceFromFiles(files, "Roundtrip");
    expect(imported.sources).toHaveLength(2);
    expect(imported.sources.map((source) => source.name)).toEqual(["Light", "Bold"]);
    expect(imported.sources[0].location).toEqual({ Weight: 300 });
    expect(imported.sources[1].location).toEqual({ Weight: 700 });
    expect(getGlyph(imported, "n", 1)!.advanceWidth).toBe(640);
    expect(imported.tracking.activePreset).toBe("loose");
  });
});
