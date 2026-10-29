import type { Contour, FontProject, Glyph, PathCommand } from "../src/core/types";
import { createEmptyProject } from "../src/core/project";

export type Box = [minX: number, minY: number, maxX: number, maxY: number];

export function rectContour([minX, minY, maxX, maxY]: Box): Contour {
  const commands: PathCommand[] = [
    { type: "M", x: minX, y: minY },
    { type: "L", x: maxX, y: minY },
    { type: "L", x: maxX, y: maxY },
    { type: "L", x: minX, y: maxY },
    { type: "Z" },
  ];
  return { commands, closed: true };
}

export function makeGlyph(
  name: string,
  unicode: number | undefined,
  advanceWidth: number,
  boxes: Box[],
  category: Glyph["category"] = "Lowercase"
): Glyph {
  return {
    name,
    unicode,
    advanceWidth,
    category,
    contours: boxes.map(rectContour),
  };
}

/**
 * A small synthetic Latin-ish project with predictable rectangular outlines.
 * Rectangles make sidebearings and pair gaps easy to assert.
 */
export function createTestProject(): FontProject {
  const project = createEmptyProject("Test Sans");
  project.unitsPerEm = 1000;
  project.ascender = 750;
  project.descender = -250;
  project.xHeight = 500;
  project.capHeight = 700;

  const glyphs: Glyph[] = [
    makeGlyph("n", 0x006e, 500, [
      [40, 0, 140, 500],
      [340, 0, 440, 500],
    ]),
    makeGlyph("o", 0x006f, 500, [[60, 0, 440, 500]]),
    makeGlyph("a", 0x0061, 500, [[55, 0, 445, 500]]),
    makeGlyph("b", 0x0062, 500, [[45, 0, 455, 500]]),
    makeGlyph("c", 0x0063, 500, [[65, 0, 435, 500]]),
    makeGlyph("d", 0x0064, 500, [[50, 0, 450, 500]]),
    makeGlyph("e", 0x0065, 500, [[60, 0, 440, 500]]),
    makeGlyph("h", 0x0068, 500, [
      [40, 0, 140, 700],
      [340, 0, 440, 700],
    ]),
    makeGlyph("H", 0x0048, 550, [
      [50, 0, 150, 700],
      [400, 0, 500, 700],
    ], "Uppercase"),
    makeGlyph("O", 0x004f, 550, [[70, 0, 480, 700]], "Uppercase"),
    makeGlyph("A", 0x0041, 550, [[40, 0, 510, 700]], "Uppercase"),
    makeGlyph("V", 0x0056, 550, [[60, 0, 490, 700]], "Uppercase"),
    makeGlyph("space", 0x0020, 250, [], "Space"),
  ];
  project.sources[0].glyphs = glyphs;
  project.keyGlyphs = {
    lowerStem: "n",
    lowerRound: "o",
    upperStem: "H",
    upperRound: "O",
  };
  project.sources[0].kerning = {};
  project.groups = { left: {}, right: {} };
  return project;
}

export const flatSpacingParams = {
  method: "stem" as const,
  targetGap: 100,
  opticalCompensation: 0.6,
  minSidebearing: 0,
  maxSidebearing: 500,
  keyLower: "n",
  keyUpper: "H",
  zone: "auto" as const,
  roundTo: 1,
};

export const testAutoKernParams = {
  threshold: 2,
  minKern: -250,
  maxKern: 180,
  collisionGap: 8,
  onlyPairList: true,
};
