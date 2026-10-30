export type PathCommand =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Z" };

export interface Contour {
  commands: PathCommand[];
  closed: boolean;
}

export interface Glyph {
  name: string;
  unicode?: number;
  advanceWidth: number;
  contours: Contour[];
  category: GlyphCategory;
  /** Optional glyph-level notes, preserved on round-trip. */
  note?: string;
  /**
   * Metrics keys link one or both sidebearings to another glyph. This is a
   * design-assistant feature; the stored outline and advance remain the source
   * of truth until the key is applied.
   */
  metricsKeys?: { left?: string; right?: string };
}

export type GlyphCategory =
  | "Uppercase"
  | "Lowercase"
  | "Smallcaps"
  | "Number"
  | "Punctuation"
  | "Symbol"
  | "Mark"
  | "Space"
  | "Other";

export interface KerningGroups {
  /** Side 1: the glyph on the left in LTR. */
  left: Record<string, string[]>;
  /** Side 2: the glyph on the right in LTR. */
  right: Record<string, string[]>;
}

export interface KeyGlyphs {
  lowerStem: string;
  lowerRound: string;
  upperStem: string;
  upperRound: string;
}

export interface TrackingPreset {
  id: string;
  label: string;
  perMille: number;
  note: string;
}

export interface TrackingSettings {
  activePreset: string;
  customPerMille: number;
  presets: TrackingPreset[];
  applyCapsSpacing: boolean;
  capsPerMille: number;
}

export interface FontSource {
  name: string;
  location?: Record<string, number>;
  glyphs: Glyph[];
  /** Serialized with `kerningKey()`. */
  kerning: Record<string, number>;
}

export interface FontProject {
  format: "fit-font";
  version: 1;
  name: string;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  xHeight: number;
  capHeight: number;
  sources: FontSource[];
  activeSource: number;
  groups: KerningGroups;
  keyGlyphs: KeyGlyphs;
  tracking: TrackingSettings;
  metadata?: Record<string, string>;
}

export interface Sidebearings {
  left: number;
  right: number;
  advance: number;
  inkWidth: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SpacingSuggestion {
  id: string;
  glyphName: string;
  currentLeft: number;
  currentRight: number;
  proposedLeft: number;
  proposedRight: number;
  confidence: number;
  reason: string;
  method: string;
}

export interface KerningSuggestion {
  id: string;
  left: string;
  right: string;
  value: number;
  currentValue: number;
  currentGap: number;
  targetGap: number;
  confidence: number;
  reason: string;
  collision: boolean;
}

export interface QAIssue {
  id: string;
  severity: "info" | "warning" | "error";
  category: string;
  title: string;
  detail: string;
  glyphName?: string;
  pair?: [string, string];
  value?: number;
}

export interface SpacingParams {
  method: "stem" | "optical" | "hybrid";
  /** Explicit total gap. 0 means "derive it from the key glyphs". */
  targetGap: number;
  /** Multiplier applied to the derived/explicit gap. 1 = unchanged. */
  targetGapScale: number;
  /** How the automatic target gap is derived when targetGap is 0. */
  targetMode: "key" | "median";
  opticalCompensation: number;
  /** Hybrid balance: 0 = fully optical, 1 = fully stem. */
  stemWeight: number;
  /** How much of the proposed change is applied. 0 = keep, 1 = full. */
  strength: number;
  /** Extra units added to round sides (negative tucks them in). */
  roundAdjust: number;
  /** Extra units added to open/diagonal sides. */
  openAdjust: number;
  minSidebearing: number;
  maxSidebearing: number;
  keyLower: string;
  keyUpper: string;
  zone: "auto" | "xheight" | "capheight";
  roundTo: number;
  /** Per-category gap multipliers. 1 = use the global target gap. */
  lowercaseGapScale: number;
  uppercaseGapScale: number;
  punctuationGapScale: number;
  /** Never move a sidebearing that is controlled by a metrics key. */
  respectMetricsKeys: boolean;
}

export interface AutoKernParams {
  threshold: number;
  minKern: number;
  maxKern: number;
  collisionGap: number;
  /** If true, only use existing pair list rather than all glyph pairs. */
  onlyPairList: boolean;
}

export interface PairEntry {
  id: string;
  left: string;
  right: string;
  value: number;
  exception: boolean;
  groupPair: boolean;
}

export interface GroupAssignment {
  glyphName: string;
  leftGroup?: string;
  rightGroup?: string;
}

export interface ReferenceFont {
  name: string;
  unitsPerEm: number;
  glyphs: Map<string, Glyph>;
}

export interface AppSettings {
  mode: "spacing" | "kerning" | "tracking" | "proof" | "qa";
  showMetrics: boolean;
  showGuides: boolean;
  showSidebearings: boolean;
  showKerning: boolean;
  spacingOnly: boolean;
  blur: number;
  flip: boolean;
  zoom: number;
  fontSize: number;
  text: string;
  theme: "dark" | "light";
  compareGhost: boolean;
  referenceFontName: string;
  measurementLine: number;
  showAdvance: boolean;
}

export interface ProjectSnapshot {
  project: FontProject;
  label: string;
  timestamp: number;
}
