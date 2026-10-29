import type {
  FontProject,
  FontSource,
  Glyph,
  KerningGroups,
  TrackingSettings,
} from "./types";
import { categoryFromGlyph, glyphBounds, setSidebearing, sidebearingsOf } from "./geometry";

export const KERNING_SEPARATOR = "\u0000";

export function kerningKey(left: string, right: string): string {
  return `${left}${KERNING_SEPARATOR}${right}`;
}

export function splitKerningKey(key: string): [string, string] {
  const [left, right] = key.split(KERNING_SEPARATOR);
  return [left ?? "", right ?? ""];
}

export function defaultTracking(): TrackingSettings {
  return {
    activePreset: "text",
    customPerMille: 0,
    applyCapsSpacing: true,
    capsPerMille: 30,
    presets: [
      { id: "tight", label: "Tight", perMille: -15, note: "Display / headlines" },
      { id: "text", label: "Text", perMille: 0, note: "Body copy" },
      { id: "loose", label: "Loose", perMille: 20, note: "Small sizes / captions" },
      { id: "airy", label: "Airy", perMille: 45, note: "All-caps / luxury" },
      { id: "custom", label: "Custom", perMille: 0, note: "Your own value" },
    ],
  };
}

export function createEmptyProject(name = "Untitled"): FontProject {
  return {
    format: "fit-font",
    version: 1,
    name,
    unitsPerEm: 1000,
    ascender: 750,
    descender: -250,
    xHeight: 500,
    capHeight: 700,
    sources: [
      {
        name: "Regular",
        location: { Weight: 400 },
        glyphs: [],
        kerning: {},
      },
    ],
    activeSource: 0,
    groups: { left: {}, right: {} },
    keyGlyphs: {
      lowerStem: "n",
      lowerRound: "o",
      upperStem: "H",
      upperRound: "O",
    },
    tracking: defaultTracking(),
    metadata: {
      createdBy: "Fit — Letter Spacing Lab",
    },
  };
}

export function cloneProject(project: FontProject): FontProject {
  return structuredClone(project);
}

export function activeSource(project: FontProject): FontSource {
  return project.sources[project.activeSource] ?? project.sources[0];
}

export function getGlyph(project: FontProject, name: string, sourceIndex = project.activeSource): Glyph | undefined {
  return project.sources[sourceIndex]?.glyphs.find((glyph) => glyph.name === name);
}

export function requireGlyph(project: FontProject, name: string): Glyph {
  const glyph = getGlyph(project, name);
  if (!glyph) {
    throw new Error(`Glyph not found: ${name}`);
  }
  return glyph;
}

export function glyphNames(project: FontProject): string[] {
  return activeSource(project).glyphs.map((glyph) => glyph.name);
}

export function sortedGlyphs(project: FontProject): Glyph[] {
  return [...activeSource(project).glyphs].sort((a, b) => {
    const au = a.unicode ?? Number.MAX_SAFE_INTEGER;
    const bu = b.unicode ?? Number.MAX_SAFE_INTEGER;
    if (au !== bu) return au - bu;
    return a.name.localeCompare(b.name);
  });
}

export function leftGroupOf(project: FontProject, glyphName: string): string | undefined {
  for (const [groupName, glyphs] of Object.entries(project.groups.left)) {
    if (glyphs.includes(glyphName)) return groupName;
  }
  return undefined;
}

export function rightGroupOf(project: FontProject, glyphName: string): string | undefined {
  for (const [groupName, glyphs] of Object.entries(project.groups.right)) {
    if (glyphs.includes(glyphName)) return groupName;
  }
  return undefined;
}

export function glyphsInLeftGroup(project: FontProject, groupName: string): string[] {
  return project.groups.left[groupName] ?? [];
}

export function glyphsInRightGroup(project: FontProject, groupName: string): string[] {
  return project.groups.right[groupName] ?? [];
}

export function resolveKerning(project: FontProject, left: string, right: string): number {
  const kerning = activeSource(project).kerning;
  const exact = kerning[kerningKey(left, right)];
  if (exact !== undefined) return exact;

  const leftGroup = leftGroupOf(project, left);
  const rightGroup = rightGroupOf(project, right);
  if (leftGroup && rightGroup) {
    const groupValue = kerning[kerningKey(`@${leftGroup}`, `@${rightGroup}`)];
    if (groupValue !== undefined) return groupValue;
  }
  if (leftGroup) {
    const value = kerning[kerningKey(`@${leftGroup}`, right)];
    if (value !== undefined) return value;
  }
  if (rightGroup) {
    const value = kerning[kerningKey(left, `@${rightGroup}`)];
    if (value !== undefined) return value;
  }
  return 0;
}

export function hasExplicitKerning(project: FontProject, left: string, right: string): boolean {
  return activeSource(project).kerning[kerningKey(left, right)] !== undefined;
}

export function setKerning(
  project: FontProject,
  left: string,
  right: string,
  value: number,
  sourceIndex = project.activeSource
): void {
  project.sources[sourceIndex].kerning[kerningKey(left, right)] = Math.round(value);
}

export function deleteKerning(
  project: FontProject,
  left: string,
  right: string,
  sourceIndex = project.activeSource
): void {
  delete project.sources[sourceIndex].kerning[kerningKey(left, right)];
}

export function pairGap(project: FontProject, leftName: string, rightName: string): number {
  const left = getGlyph(project, leftName);
  const right = getGlyph(project, rightName);
  if (!left || !right) return 0;
  return sidebearingsOf(left).right + sidebearingsOf(right).left + resolveKerning(project, leftName, rightName);
}

export function pairInkGap(project: FontProject, leftName: string, rightName: string, y: number): number | undefined {
  const left = getGlyph(project, leftName);
  const right = getGlyph(project, rightName);
  if (!left || !right) return undefined;
  const leftBounds = glyphBounds(left);
  const rightBounds = glyphBounds(right);
  if (!leftBounds || !rightBounds) return undefined;
  // This is a simple approximation at one y. The kerning engine samples
  // multiple heights and scans the pair together for collisions.
  const leftAdvance = left.advanceWidth;
  return leftAdvance + resolveKerning(project, leftName, rightName) + rightBounds.minX - leftBounds.maxX;
}

export function allKerningPairs(project: FontProject): Array<{ left: string; right: string; value: number; key: string }> {
  return Object.entries(activeSource(project).kerning).map(([key, value]) => {
    const [left, right] = splitKerningKey(key);
    return { left, right, value, key };
  });
}

export function ensureGroups(project: FontProject): void {
  if (!project.groups) {
    project.groups = { left: {}, right: {} };
  }
  if (!project.groups.left) project.groups.left = {};
  if (!project.groups.right) project.groups.right = {};
}

export function assignGlyphToGroup(
  project: FontProject,
  side: "left" | "right",
  glyphName: string,
  groupName: string | undefined
): void {
  ensureGroups(project);
  const groups = project.groups[side];
  for (const [name, glyphs] of Object.entries(groups)) {
    const index = glyphs.indexOf(glyphName);
    if (index !== -1 && name !== groupName) {
      glyphs.splice(index, 1);
      if (!glyphs.length) delete groups[name];
    }
  }
  if (groupName) {
    if (!groups[groupName]) groups[groupName] = [];
    if (!groups[groupName].includes(glyphName)) groups[groupName].push(glyphName);
  }
}

export function renameGroup(
  project: FontProject,
  side: "left" | "right",
  oldName: string,
  newName: string
): void {
  ensureGroups(project);
  if (!newName || oldName === newName) return;
  const groups = project.groups[side];
  if (!groups[oldName]) return;
  groups[newName] = groups[oldName];
  delete groups[oldName];
  const prefix = side === "left" ? "@" : "@";
  for (const [key, value] of Object.entries(activeSource(project).kerning)) {
    const [left, right] = splitKerningKey(key);
    const updatedLeft = left === `${prefix}${oldName}` ? `${prefix}${newName}` : left;
    const updatedRight = right === `${prefix}${oldName}` ? `${prefix}${newName}` : right;
    if (updatedLeft !== left || updatedRight !== right) {
      delete activeSource(project).kerning[key];
      activeSource(project).kerning[kerningKey(updatedLeft, updatedRight)] = value;
    }
  }
}

export function deleteGroup(project: FontProject, side: "left" | "right", groupName: string): void {
  ensureGroups(project);
  delete project.groups[side][groupName];
  for (const [key] of Object.entries(activeSource(project).kerning)) {
    const [left, right] = splitKerningKey(key);
    if (left === `@${groupName}` || right === `@${groupName}`) {
      delete activeSource(project).kerning[key];
    }
  }
}

export function metricsKeyFor(
  project: FontProject,
  glyphName: string,
  side: "left" | "right"
): string | undefined {
  return getGlyph(project, glyphName)?.metricsKeys?.[side];
}

function resolveMetricsValue(
  project: FontProject,
  glyphName: string,
  side: "left" | "right",
  stack: Set<string>
): number | undefined {
  const glyph = getGlyph(project, glyphName);
  if (!glyph) return undefined;
  const key = glyph.metricsKeys?.[side];
  if (!key || key === glyph.name) {
    return sidebearingsOf(glyph)[side];
  }
  if (stack.has(glyphName) || stack.has(key)) {
    return undefined;
  }
  stack.add(glyphName);
  const resolved = resolveMetricsValue(project, key, side, stack);
  stack.delete(glyphName);
  return resolved;
}

/**
 * Resolve a metrics key, following chains and stopping at cycles. Returns the
 * glyph's own sidebearing when no key is set or the chain is broken.
 */
export function resolvedMetricsSide(
  project: FontProject,
  glyphName: string,
  side: "left" | "right"
): number | undefined {
  const glyph = getGlyph(project, glyphName);
  if (!glyph) return undefined;
  return resolveMetricsValue(project, glyphName, side, new Set());
}

/**
 * Apply every resolvable metrics key in the active source. Returns the number
 * of sidebearings that changed. A missing target, self-reference or cycle is
 * skipped safely, so a malformed key never corrupts a glyph.
 */
export function applyMetricsKeys(project: FontProject): number {
  let changed = 0;
  for (const glyph of activeSource(project).glyphs) {
    for (const side of ["left", "right"] as const) {
      const key = glyph.metricsKeys?.[side];
      if (!key || key === glyph.name) continue;
      const targetValue = resolvedMetricsSide(project, glyph.name, side);
      if (targetValue === undefined) continue;
      const before = sidebearingsOf(glyph)[side];
      if (Math.abs(before - targetValue) < 0.5) continue;
      setSidebearing(glyph, side, targetValue);
      changed += 1;
    }
  }
  return changed;
}

export function groupAssignmentSummary(project: FontProject, glyphName: string): string {
  const left = leftGroupOf(project, glyphName);
  const right = rightGroupOf(project, glyphName);
  if (!left && !right) return "—";
  return `${left ? "@" + left : "—"} / ${right ? "@" + right : "—"}`;
}

export function projectStats(project: FontProject): {
  glyphs: number;
  groups: number;
  kerningPairs: number;
  emptyGlyphs: number;
} {
  const source = activeSource(project);
  return {
    glyphs: source.glyphs.length,
    groups: Object.keys(project.groups.left).length + Object.keys(project.groups.right).length,
    kerningPairs: Object.keys(source.kerning).length,
    emptyGlyphs: source.glyphs.filter((glyph) => !glyphBounds(glyph)).length,
  };
}

export function normalizeProject(project: FontProject): FontProject {
  const normalized = cloneProject(project);
  normalized.format = "fit-font";
  normalized.version = 1;
  normalized.sources = normalized.sources?.length
    ? normalized.sources
    : createEmptyProject(normalized.name).sources;
  normalized.activeSource = Math.min(
    Math.max(0, normalized.activeSource ?? 0),
    normalized.sources.length - 1
  );
  ensureGroups(normalized);
  normalized.tracking = normalized.tracking ?? defaultTracking();
  normalized.keyGlyphs = normalized.keyGlyphs ?? {
    lowerStem: "n",
    lowerRound: "o",
    upperStem: "H",
    upperRound: "O",
  };
  for (const source of normalized.sources) {
    source.kerning ??= {};
    source.glyphs ??= [];
    for (const glyph of source.glyphs) {
      glyph.category ??= categoryFromGlyph(glyph.name, glyph.unicode);
      glyph.contours ??= [];
      glyph.advanceWidth ??= 0;
    }
  }
  return normalized;
}

export function groupsAsKerningGroups(groups: KerningGroups): KerningGroups {
  return {
    left: Object.fromEntries(Object.entries(groups.left).map(([k, v]) => [k, [...v]])),
    right: Object.fromEntries(Object.entries(groups.right).map(([k, v]) => [k, [...v]])),
  };
}
