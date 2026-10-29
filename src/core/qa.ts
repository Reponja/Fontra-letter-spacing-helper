import type { FontProject, QAIssue } from "./types";
import {
  activeSource,
  allKerningPairs,
  getGlyph,
  hasExplicitKerning,
  leftGroupOf,
  rightGroupOf,
  splitKerningKey,
} from "./project";
import {
  defaultPairList,
  kerningCoverage,
  minimumPairGap,
  overkernedPairs,
} from "./kerning";
import { glyphBounds, sidebearingsOf } from "./geometry";
import { spacingOutliers } from "./spacing";
import { currentTrackingPerMille } from "./tracking";

export interface QAParams {
  collisionGap: number;
  maxOverkernRatio: number;
  pairList?: string[];
  checkCollisions?: boolean;
}

export const DEFAULT_QA_PARAMS: QAParams = {
  collisionGap: 8,
  maxOverkernRatio: 0.4,
  checkCollisions: true,
};

export function runQA(project: FontProject, params: QAParams = DEFAULT_QA_PARAMS): QAIssue[] {
  const issues: QAIssue[] = [];
  const source = activeSource(project);
  const glyphs = source.glyphs;
  const pairList = params.pairList ?? defaultPairList(project);

  for (const glyph of glyphs) {
    if (glyph.category === "Mark" || glyph.category === "Space") continue;
    const bounds = glyphBounds(glyph);
    if (!bounds) {
      issues.push({
        id: `empty:${glyph.name}`,
        severity: "warning",
        category: "Spacing",
        title: `${glyph.name} has no outline`,
        detail: "Spacing checks skip glyphs without outlines. Check that this is intentional (space, control glyph, etc.).",
        glyphName: glyph.name,
      });
      continue;
    }
    const sb = sidebearingsOf(glyph);
    if (sb.left < 0 || sb.right < 0) {
      issues.push({
        id: `negative:${glyph.name}`,
        severity: "error",
        category: "Spacing",
        title: `${glyph.name} has a negative sidebearing`,
        detail: `LSB ${sb.left.toFixed(0)}, RSB ${sb.right.toFixed(0)}. Negative sidebearings can be intentional for italics or scripts, but should be reviewed.`,
        glyphName: glyph.name,
      });
    }
    if (sb.advance <= 0) {
      issues.push({
        id: `advance:${glyph.name}`,
        severity: "error",
        category: "Spacing",
        title: `${glyph.name} has a non-positive advance width`,
        detail: `Advance width is ${sb.advance}.`,
        glyphName: glyph.name,
      });
    }
    if (!leftGroupOf(project, glyph.name) || !rightGroupOf(project, glyph.name)) {
      issues.push({
        id: `group:${glyph.name}`,
        severity: "info",
        category: "Groups",
        title: `${glyph.name} is not fully grouped`,
        detail: "Assign both left and right kerning groups, or run Auto Groups.",
        glyphName: glyph.name,
      });
    }
    for (const side of ["left", "right"] as const) {
      const key = glyph.metricsKeys?.[side];
      if (!key) continue;
      if (key === glyph.name) {
        issues.push({
          id: `metricskey:self:${glyph.name}:${side}`,
          severity: "warning",
          category: "Metrics keys",
          title: `${glyph.name} ${side} metrics key points to itself`,
          detail: "A self-referencing metrics key is ignored. Point it at another glyph or remove it.",
          glyphName: glyph.name,
        });
      } else if (!getGlyph(project, key)) {
        issues.push({
          id: `metricskey:missing:${glyph.name}:${side}`,
          severity: "warning",
          category: "Metrics keys",
          title: `${glyph.name} ${side} metrics key is missing`,
          detail: `The key glyph "${key}" does not exist in this source.`,
          glyphName: glyph.name,
        });
      }
    }
  }

  for (const outlier of spacingOutliers(project)) {
    issues.push({
      id: `outlier:${outlier.glyphName}:${outlier.side}`,
      severity: "warning",
      category: "Spacing rhythm",
      title: `${outlier.glyphName} ${outlier.side} sidebearing is an outlier`,
      detail: `${outlier.value.toFixed(0)} vs. category median ${outlier.median.toFixed(0)} (deviation ${outlier.deviation.toFixed(0)}).`,
      glyphName: outlier.glyphName,
      value: outlier.value,
    });
  }

  if (params.checkCollisions) {
    // Collision scanning is deliberately capped: it is a review prompt, not an
    // exhaustive proof. This keeps QA responsive on large fonts.
    const sample = pairList.slice(0, 2000);
    for (const key of sample) {
      const [left, right] = splitKerningKey(key);
      if (left.startsWith("@") || right.startsWith("@")) continue;
      const gap = minimumPairGap(project, left, right);
      if (gap !== undefined && gap < params.collisionGap) {
        issues.push({
          id: `collision:${left}:${right}`,
          severity: "error",
          category: "Kerning",
          title: `${left}${right} is too tight`,
          detail: `Minimum ink gap ${gap.toFixed(1)} is below the ${params.collisionGap} unit threshold.`,
          pair: [left, right],
          value: gap,
        });
      }
    }
  }

  for (const pair of overkernedPairs(project, params.maxOverkernRatio)) {
    issues.push({
      id: `overkern:${pair.left}:${pair.right}`,
      severity: "warning",
      category: "Kerning",
      title: `${pair.left}${pair.right} is overkerned`,
      detail: `${pair.value} units is ${(pair.ratio * 100).toFixed(0)}% of the narrower glyph's ink width (limit ${(params.maxOverkernRatio * 100).toFixed(0)}%).`,
      pair: [pair.left, pair.right],
      value: pair.value,
    });
  }

  for (const pair of allKerningPairs(project)) {
    const [left, right] = splitKerningKey(pair.key);
    if (left.startsWith("@") || right.startsWith("@")) continue;
    if (!hasExplicitKerning(project, left, right)) continue;
    const groupValue = resolveKerningWithoutExact(project, left, right);
    if (groupValue === pair.value) {
      issues.push({
        id: `redundant:${left}:${right}`,
        severity: "info",
        category: "Kerning",
        title: `${left}${right} duplicates its group value`,
        detail: "This exception is redundant and can be removed.",
        pair: [left, right],
      });
    }
  }

  const figures = glyphs.filter((glyph) => glyph.category === "Number");
  if (figures.length > 1) {
    const widths = new Set(figures.map((glyph) => Math.round(glyph.advanceWidth)));
    if (widths.size > 1) {
      issues.push({
        id: "tabular:figures",
        severity: "info",
        category: "Tabular",
        title: "Figure widths are not uniform",
        detail: `Figure advances: ${[...widths].sort((a, b) => a - b).join(", ")}. This is fine for proportional figures; use this as a reminder to check tabular figures.`,
      });
    }
  }

  const tracking = Math.abs(currentTrackingPerMille(project));
  if (tracking > 80) {
    issues.push({
      id: "tracking:large",
      severity: "warning",
      category: "Tracking",
      title: "Large tracking value",
      detail: `${tracking} units/1000 em is quite open. Check at the intended reading size.`,
    });
  }

  const coverage = kerningCoverage(project, pairList);
  if (coverage < 35 && pairList.length > 50) {
    issues.push({
      id: "coverage:kerning",
      severity: "info",
      category: "Kerning",
      title: "Low explicit kerning coverage",
      detail: `${coverage.toFixed(0)}% of the default pair list has a nonzero or explicit kern. Good spacing should make most pairs unnecessary.`,
    });
  }

  return issues.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function resolveKerningWithoutExact(project: FontProject, left: string, right: string): number {
  const kerning = activeSource(project).kerning;
  const leftGroup = leftGroupOf(project, left);
  const rightGroup = rightGroupOf(project, right);
  if (leftGroup && rightGroup) {
    const value = kerning[`${"@" + leftGroup}\u0000${"@" + rightGroup}`];
    if (value !== undefined) return value;
  }
  if (leftGroup) {
    const value = kerning[`${"@" + leftGroup}\u0000${right}`];
    if (value !== undefined) return value;
  }
  if (rightGroup) {
    const value = kerning[`${left}\u0000${"@" + rightGroup}`];
    if (value !== undefined) return value;
  }
  return 0;
}

export function severityRank(severity: QAIssue["severity"]): number {
  return severity === "error" ? 3 : severity === "warning" ? 2 : 1;
}

export function qaSummary(issues: QAIssue[]): {
  errors: number;
  warnings: number;
  info: number;
  score: number;
} {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const info = issues.filter((issue) => issue.severity === "info").length;
  const score = Math.max(0, Math.round(100 - errors * 3 - warnings * 1 - info * 0.15));
  return { errors, warnings, info, score };
}

export function healthScore(project: FontProject, issues: QAIssue[]): number {
  return qaSummary(issues).score;
}
