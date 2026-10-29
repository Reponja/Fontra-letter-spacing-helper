import * as opentype from "opentype.js";
import type { FontProject, PathCommand } from "../types";
import { activeSource, splitKerningKey } from "../project";

function toOpentypePath(commands: PathCommand[]): opentype.Path {
  const path = new opentype.Path();
  let current = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  for (const command of commands) {
    switch (command.type) {
      case "M":
        path.moveTo(command.x, command.y);
        current = { x: command.x, y: command.y };
        start = current;
        break;
      case "L":
        path.lineTo(command.x, command.y);
        current = { x: command.x, y: command.y };
        break;
      case "Q": {
        // CFF outlines are cubic-only. Convert the quadratic exactly.
        const c1 = {
          x: current.x + (2 / 3) * (command.x1 - current.x),
          y: current.y + (2 / 3) * (command.y1 - current.y),
        };
        const c2 = {
          x: command.x + (2 / 3) * (command.x1 - command.x),
          y: command.y + (2 / 3) * (command.y1 - command.y),
        };
        path.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, command.x, command.y);
        current = { x: command.x, y: command.y };
        break;
      }
      case "C":
        path.bezierCurveTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y);
        current = { x: command.x, y: command.y };
        break;
      case "Z":
        path.close();
        current = start;
        break;
    }
  }
  return path;
}

/**
 * Expand group kerning into plain pairs for the legacy `kern` table that
 * opentype.js writes. Explicit pairs are applied last so exceptions win.
 */
function buildKerningPairs(project: FontProject): Record<string, Record<string, number>> {
  const source = activeSource(project);
  const pairs: Record<string, Record<string, number>> = {};
  const set = (left: string, right: string, value: number) => {
    if (!pairs[left]) pairs[left] = {};
    pairs[left][right] = Math.round(value);
  };
  const entries = Object.entries(source.kerning);
  const leftsFor = (name: string) =>
    name.startsWith("@") ? project.groups.left[name.slice(1)] ?? [] : [name];
  const rightsFor = (name: string) =>
    name.startsWith("@") ? project.groups.right[name.slice(1)] ?? [] : [name];

  for (const [key, value] of entries) {
    const [left, right] = splitKerningKey(key);
    if (!left.startsWith("@") && !right.startsWith("@")) continue;
    const lefts = leftsFor(left);
    const rights = rightsFor(right);
    for (const leftGlyph of lefts) {
      for (const rightGlyph of rights) {
        set(leftGlyph, rightGlyph, value);
      }
    }
  }
  for (const [key, value] of entries) {
    const [left, right] = splitKerningKey(key);
    if (left.startsWith("@") || right.startsWith("@")) continue;
    set(left, right, value);
  }
  return pairs;
}

/**
 * Build an OTF through opentype.js. This is a practical export for proofing and
 * downstream tools, not a full production compiler: it writes CFF outlines and
 * a legacy `kern` table, but no layout features, hinting or variable axes.
 */
function align4(value: number): number {
  return (value + 3) & ~3;
}

function tableTag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function checksum(bytes: Uint8Array): number {
  let sum = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    sum = (sum + view.getUint32(i)) >>> 0;
  }
  return sum;
}

function addKernTable(buffer: ArrayBuffer, pairs: Record<string, Record<string, number>>, indexOf: Map<string, number>): ArrayBuffer {
  const pairList: Array<{ left: number; right: number; value: number }> = [];
  for (const [leftName, rights] of Object.entries(pairs)) {
    const left = indexOf.get(leftName);
    if (left === undefined) continue;
    for (const [rightName, value] of Object.entries(rights)) {
      const right = indexOf.get(rightName);
      if (right === undefined) continue;
      const rounded = Math.max(-32768, Math.min(32767, Math.round(value)));
      if (!rounded) continue;
      pairList.push({ left, right, value: rounded });
    }
  }
  if (!pairList.length) return buffer;
  pairList.sort((a, b) => a.left - b.left || a.right - b.right);
  const limited = pairList.slice(0, 65535);
  const nPairs = limited.length;
  // Windows kern table: table version (0), nTables (1), then one format-0
  // subtable. See the OpenType `kern` table specification.
  const kern = new Uint8Array(18 + nPairs * 6);
  const view = new DataView(kern.buffer);
  view.setUint16(0, 0); // table version
  view.setUint16(2, 1); // nTables
  view.setUint16(4, 0); // subtable version
  view.setUint16(6, 14 + nPairs * 6); // subtable length
  view.setUint16(8, 0x0001); // coverage: horizontal, format 0
  view.setUint16(10, nPairs);
  const power = Math.max(1, 2 ** Math.floor(Math.log2(Math.max(1, nPairs))));
  view.setUint16(12, power * 6); // searchRange
  view.setUint16(14, Math.floor(Math.log2(power))); // entrySelector
  view.setUint16(16, nPairs * 6 - power * 6); // rangeShift
  limited.forEach((pair, index) => {
    const offset = 18 + index * 6;
    view.setUint16(offset, pair.left);
    view.setUint16(offset + 2, pair.right);
    view.setInt16(offset + 4, pair.value);
  });

  const original = new Uint8Array(buffer);
  const originalView = new DataView(buffer);
  const numTables = originalView.getUint16(4);
  const tables: Array<{ tag: string; data: Uint8Array }> = [];
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    const tag = tableTag(original, record);
    const offset = originalView.getUint32(record + 8);
    const length = originalView.getUint32(record + 12);
    tables.push({ tag, data: original.slice(offset, offset + length) });
  }
  tables.push({ tag: "kern", data: kern });
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const headerSize = 12 + tables.length * 16;
  let total = align4(headerSize);
  for (const table of tables) total += align4(table.data.length);
  const out = new Uint8Array(total);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, originalView.getUint32(0)); // sfnt version (OTTO)
  outView.setUint16(4, tables.length);
  const highestPower = 2 ** Math.floor(Math.log2(tables.length));
  outView.setUint16(6, highestPower * 16);
  outView.setUint16(8, Math.floor(Math.log2(highestPower)));
  outView.setUint16(10, tables.length * 16 - highestPower * 16);
  let dataOffset = align4(headerSize);
  const headRecord = tables.find((table) => table.tag === "head");
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    const record = 12 + i * 16;
    for (let c = 0; c < 4; c++) out[record + c] = table.tag.charCodeAt(c);
    let tableForChecksum = table.data;
    if (table.tag === "head" && table.data.length >= 12) {
      tableForChecksum = table.data.slice();
      tableForChecksum[8] = 0;
      tableForChecksum[9] = 0;
      tableForChecksum[10] = 0;
      tableForChecksum[11] = 0;
    }
    outView.setUint32(record + 4, checksum(tableForChecksum));
    outView.setUint32(record + 8, dataOffset);
    outView.setUint32(record + 12, table.data.length);
    out.set(table.data, dataOffset);
    dataOffset = align4(dataOffset + table.data.length);
  }
  if (headRecord) {
    let headOffset = 0;
    for (let i = 0; i < tables.length; i++) {
      if (tables[i].tag === "head") headOffset = outView.getUint32(12 + i * 16 + 8);
    }
    outView.setUint32(headOffset + 8, 0);
    const adjustment = (0xb1b0afba - checksum(out)) >>> 0;
    outView.setUint32(headOffset + 8, adjustment);
  }
  return out.buffer;
}

export function exportOpentypeBuffer(project: FontProject): ArrayBuffer {
  const source = activeSource(project);
  const usedNames = new Set<string>();
  const glyphs: opentype.Glyph[] = [
    new opentype.Glyph({
      name: ".notdef",
      unicode: undefined,
      advanceWidth: Math.round(project.unitsPerEm * 0.5),
      path: new opentype.Path(),
    }),
  ];
  for (const glyph of source.glyphs) {
    let name = glyph.name || "glyph";
    while (usedNames.has(name)) name = `${name}.1`;
    usedNames.add(name);
    glyphs.push(
      new opentype.Glyph({
        name,
        unicode: glyph.unicode,
        advanceWidth: Math.max(0, Math.round(glyph.advanceWidth)),
        path: toOpentypePath(glyph.contours.flatMap((contour) => contour.commands)),
      })
    );
  }
  const font = new opentype.Font({
    familyName: project.name || "Fit Export",
    styleName: source.name || "Regular",
    unitsPerEm: project.unitsPerEm,
    ascender: project.ascender,
    descender: project.descender,
    glyphs,
  });
  const kerningPairs = buildKerningPairs(project);
  (font as unknown as { kerningPairs: Record<string, Record<string, number>> }).kerningPairs =
    kerningPairs;
  const indexOf = new Map<string, number>();
  glyphs.forEach((glyph, index) => indexOf.set(glyph.name ?? "", index));
  return addKernTable(font.toArrayBuffer(), kerningPairs, indexOf);
}

export function kerningPairCountForExport(project: FontProject): number {
  const pairs = buildKerningPairs(project);
  let count = 0;
  for (const rights of Object.values(pairs)) count += Object.keys(rights).length;
  return count;
}
