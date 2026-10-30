// Public surface used by the zero-server Fontra panel.
// Keep this entry free of React, DOM and file-format parsers so it can be
// bundled into a small ES module and loaded directly by Fontra.

export {
  activeSource,
  applyMetricsKeys,
  cloneProject,
  createEmptyProject,
  getGlyph,
  kerningKey,
  normalizeProject,
  resolveKerning,
  resolvedMetricsSide,
  setKerning,
  sortedGlyphs,
  splitKerningKey,
} from "./core/project";

export {
  applySidebearings,
  categoryFromGlyph,
  glyphBounds,
  sidebearingsOf,
  zoneForGlyph,
} from "./core/geometry";

export {
  DEFAULT_SPACING_PARAMS,
  applySpacingSuggestions,
  defaultTargetGap,
  spacingHealth,
  spacingOutliers,
  spacingSuggestions,
} from "./core/spacing";

export {
  applyKerningSuggestions,
  autoKernSuggestions,
  defaultPairList,
  minimumPairGap,
  targetPairGap,
} from "./core/kerning";

export {
  DEFAULT_QA_PARAMS,
  qaSummary,
  runQA,
} from "./core/qa";

export {
  currentTrackingPerMille,
  generateTrackingFeatures,
  trackingCss,
  trackingJson,
  trackingRamp,
} from "./core/tracking";
