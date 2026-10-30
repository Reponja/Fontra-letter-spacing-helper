import type { FontProject, SpacingParams, SpacingSuggestion } from "../core/types";
import { sidebearingsOf } from "../core/geometry";
import { leftGroupOf, rightGroupOf, sortedGlyphs } from "../core/project";
import {
  DEFAULT_SPACING_PARAMS,
  defaultTargetGap,
  spacingGroupsSummary,
} from "../core/spacing";
import {
  ConfidenceBar,
  EmptyState,
  NumberField,
  Section,
  SliderField,
  Toggle,
} from "./controls";
import GlyphThumb from "./GlyphThumb";

interface SpacingPanelProps {
  project: FontProject;
  selectedGlyph: string;
  params: SpacingParams;
  suggestions: SpacingSuggestion[];
  onSelectGlyph: (name: string) => void;
  onParamsChange: (params: SpacingParams) => void;
  onKeyGlyphsChange: (keyGlyphs: FontProject["keyGlyphs"]) => void;
  onRun: () => void;
  onApply: (suggestions: SpacingSuggestion[]) => void;
  onApplyOne: (suggestion: SpacingSuggestion) => void;
  onAutoGroups: () => void;
  onSidebearingChange: (glyphName: string, side: "left" | "right", value: number) => void;
  onAdvanceChange: (glyphName: string, value: number) => void;
  onMetricsKeyChange: (glyphName: string, side: "left" | "right", key: string | undefined) => void;
  onApplyMetricsKeys: () => void;
  onFindOutliers: () => void;
}

export default function SpacingPanel(props: SpacingPanelProps) {
  const {
    project,
    selectedGlyph,
    params,
    suggestions,
    onSelectGlyph,
    onParamsChange,
    onKeyGlyphsChange,
    onRun,
    onApply,
    onApplyOne,
    onAutoGroups,
    onSidebearingChange,
    onAdvanceChange,
    onMetricsKeyChange,
    onApplyMetricsKeys,
    onFindOutliers,
  } = props;
  const glyph = project.sources[project.activeSource].glyphs.find((candidate) => candidate.name === selectedGlyph);
  const sb = glyph ? sidebearingsOf(glyph) : undefined;
  const names = sortedGlyphs(project).map((item) => item.name);
  const groupSummary = spacingGroupsSummary(project);
  const targetGap = defaultTargetGap(project, params);
  const safe = suggestions.filter((suggestion) => suggestion.confidence >= 0.82);

  return (
    <div className="panel-stack">
      <Section title="Selected glyph" hint="Numeric edits are undoable. Drag the blue lines in the canvas for a more direct feel.">
        {glyph && sb ? (
          <>
            <div className="selected-glyph-head">
              <GlyphThumb glyph={glyph} size={38} />
              <div>
                <div className="selected-glyph-name">{glyph.name}</div>
                <div className="muted small">
                  {glyph.unicode ? `U+${glyph.unicode.toString(16).toUpperCase().padStart(4, "0")} · ` : ""}
                  {glyph.category}
                  {leftGroupOf(project, glyph.name) && ` · @${leftGroupOf(project, glyph.name)}`}
                  {rightGroupOf(project, glyph.name) && ` / @${rightGroupOf(project, glyph.name)}`}
                </div>
              </div>
            </div>
            <div className="field-grid field-grid--three">
              <NumberField
                label="LSB"
                value={sb.left}
                onChange={(value) => onSidebearingChange(glyph.name, "left", value)}
              />
              <NumberField
                label="RSB"
                value={sb.right}
                onChange={(value) => onSidebearingChange(glyph.name, "right", value)}
              />
              <NumberField
                label="Advance"
                value={sb.advance}
                onChange={(value) => onAdvanceChange(glyph.name, value)}
              />
            </div>
            <div className="metric-note">
              Ink width {sb.inkWidth.toFixed(0)} · total gap between two{" "}
              <button
                className="inline-link"
                onClick={() => onSelectGlyph(project.keyGlyphs.lowerStem)}
              >
                {project.keyGlyphs.lowerStem}
              </button>
              s: {targetGap.toFixed(0)} units
            </div>
            <div className="field-grid field-grid--two metrics-key-grid">
              <label className="field">
                <span>Left metrics key</span>
                <select
                  className="select-input"
                  value={glyph.metricsKeys?.left ?? ""}
                  onChange={(event) =>
                    onMetricsKeyChange(glyph.name, "left", event.target.value || undefined)
                  }
                >
                  <option value="">— none —</option>
                  {names.map((name) => (
                    <option key={name} value={name}>
                      ={name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Right metrics key</span>
                <select
                  className="select-input"
                  value={glyph.metricsKeys?.right ?? ""}
                  onChange={(event) =>
                    onMetricsKeyChange(glyph.name, "right", event.target.value || undefined)
                  }
                >
                  <option value="">— none —</option>
                  {names.map((name) => (
                    <option key={name} value={name}>
                      ={name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="inline-actions">
              <button className="button button--small" onClick={onApplyMetricsKeys}>
                Apply metrics keys
              </button>
              {(glyph.metricsKeys?.left || glyph.metricsKeys?.right) && (
                <span className="badge">
                  linked to {[glyph.metricsKeys?.left, glyph.metricsKeys?.right].filter(Boolean).join(" / ")}
                </span>
              )}
            </div>
          </>
        ) : (
          <EmptyState>Select a glyph in the list to edit its metrics.</EmptyState>
        )}
      </Section>

      <Section
        title="Rhythm keys"
        hint="The key glyphs define the spacing system. Everything else is derived from them."
        collapsible
        defaultOpen={false}
      >
        <div className="field-grid field-grid--two">
          <KeyGlyphSelect
            label="Lowercase stem"
            value={project.keyGlyphs.lowerStem}
            names={names}
            onChange={(value) => onKeyGlyphsChange({ ...project.keyGlyphs, lowerStem: value })}
          />
          <KeyGlyphSelect
            label="Lowercase round"
            value={project.keyGlyphs.lowerRound}
            names={names}
            onChange={(value) => onKeyGlyphsChange({ ...project.keyGlyphs, lowerRound: value })}
          />
          <KeyGlyphSelect
            label="Uppercase stem"
            value={project.keyGlyphs.upperStem}
            names={names}
            onChange={(value) => onKeyGlyphsChange({ ...project.keyGlyphs, upperStem: value })}
          />
          <KeyGlyphSelect
            label="Uppercase round"
            value={project.keyGlyphs.upperRound}
            names={names}
            onChange={(value) => onKeyGlyphsChange({ ...project.keyGlyphs, upperRound: value })}
          />
        </div>
        <div className="inline-actions">
          <button className="button button--small" onClick={() => onSelectGlyph(project.keyGlyphs.lowerStem)}>
            Show {project.keyGlyphs.lowerStem}
          </button>
          <button className="button button--small" onClick={() => onSelectGlyph(project.keyGlyphs.lowerRound)}>
            Show {project.keyGlyphs.lowerRound}
          </button>
        </div>
      </Section>

      <Section
        title="Auto-spacing engine"
        hint="Use one method as a starting point, then review the suggestions. Nothing is applied until you say so."
      >
        <div className="segmented">
          {(
            [
              ["stem", "Stem / cadence", "Stem interval and cadence units"],
              ["optical", "Optical", "Key-glyph optical compensation"],
              ["hybrid", "Hybrid", "Average of stem and optical"],
            ] as const
          ).map(([value, label, hint]) => (
            <button
              key={value}
              className={`segment ${params.method === value ? "is-active" : ""}`}
              onClick={() => onParamsChange({ ...params, method: value })}
              title={hint}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="field-grid field-grid--two">
          <NumberField
            label="Target gap"
            value={params.targetGap}
            onChange={(value) => onParamsChange({ ...params, targetGap: value })}
            suffix="0 = auto"
            min={0}
          />
          <label className="field">
            <span>Auto target</span>
            <select
              className="select-input"
              value={params.targetMode}
              onChange={(event) =>
                onParamsChange({ ...params, targetMode: event.target.value as SpacingParams["targetMode"] })
              }
            >
              <option value="key">Key glyph rhythm</option>
              <option value="median">Median of rhythm keys</option>
            </select>
          </label>
          <NumberField
            label="Min sidebearing"
            value={params.minSidebearing}
            onChange={(value) => onParamsChange({ ...params, minSidebearing: value })}
            min={-500}
          />
          <NumberField
            label="Max sidebearing"
            value={params.maxSidebearing}
            onChange={(value) => onParamsChange({ ...params, maxSidebearing: value })}
            min={1}
          />
          <label className="field">
            <span>Spacing zone</span>
            <select
              className="select-input"
              value={params.zone}
              onChange={(event) => onParamsChange({ ...params, zone: event.target.value as SpacingParams["zone"] })}
            >
              <option value="auto">Auto by category</option>
              <option value="xheight">x-height</option>
              <option value="capheight">cap-height</option>
            </select>
          </label>
          <label className="field">
            <span>Rounding</span>
            <select
              className="select-input"
              value={params.roundTo}
              onChange={(event) => onParamsChange({ ...params, roundTo: Number(event.target.value) })}
            >
              <option value={1}>1 unit</option>
              <option value={2}>2 units</option>
              <option value={5}>5 units</option>
              <option value={10}>10 units</option>
            </select>
          </label>
        </div>
        <div className="target-note">
          Current target gap: <strong>{targetGap.toFixed(0)} units</strong>
          {params.targetGap === 0
            ? params.targetMode === "median"
              ? " (median of the rhythm keys)"
              : " (from the key glyph)"
            : " (explicit)"}
          {(params.targetGapScale ?? 1) !== 1 &&
            ` · scaled ×${(params.targetGapScale ?? 1).toFixed(2)}`}
        </div>
        <div className="inline-actions">
          <button className="button button--primary" onClick={onRun}>
            Suggest spacing
          </button>
          <button className="button" onClick={onAutoGroups}>
            Auto groups
          </button>
          <button className="button button--ghost" onClick={onFindOutliers}>
            Find outliers
          </button>
        </div>
      </Section>

      <Section
        title="Fine tuning"
        hint="These values shape the proposal. Change them, then run Suggest spacing again. Nothing is applied until you do."
        collapsible
        defaultOpen={false}
      >
        <SliderField
          label="Stem / optical balance"
          value={params.stemWeight}
          min={0}
          max={1}
          step={0.05}
          onChange={(value) => onParamsChange({ ...params, stemWeight: value })}
          format={(value) => `${Math.round(value * 100)}% stem`}
        />
        <SliderField
          label="Optical compensation"
          value={params.opticalCompensation}
          min={0}
          max={1.4}
          step={0.05}
          onChange={(value) => onParamsChange({ ...params, opticalCompensation: value })}
          format={(value) => value.toFixed(2)}
        />
        <SliderField
          label="Suggestion strength"
          value={params.strength}
          min={0}
          max={1}
          step={0.05}
          onChange={(value) => onParamsChange({ ...params, strength: value })}
          format={(value) => `${Math.round(value * 100)}%`}
        />
        <SliderField
          label="Global gap scale"
          value={params.targetGapScale}
          min={0.7}
          max={1.3}
          step={0.01}
          onChange={(value) => onParamsChange({ ...params, targetGapScale: value })}
          format={(value) => `${Math.round(value * 100)}%`}
        />
        <div className="field-grid field-grid--three">
          <NumberField
            label="Lowercase gap"
            value={params.lowercaseGapScale}
            onChange={(value) => onParamsChange({ ...params, lowercaseGapScale: value })}
            step={0.01}
            min={0.5}
            max={1.5}
            suffix="×"
          />
          <NumberField
            label="Uppercase gap"
            value={params.uppercaseGapScale}
            onChange={(value) => onParamsChange({ ...params, uppercaseGapScale: value })}
            step={0.01}
            min={0.5}
            max={1.5}
            suffix="×"
          />
          <NumberField
            label="Punctuation gap"
            value={params.punctuationGapScale}
            onChange={(value) => onParamsChange({ ...params, punctuationGapScale: value })}
            step={0.01}
            min={0.5}
            max={1.5}
            suffix="×"
          />
        </div>
        <div className="field-grid field-grid--two">
          <NumberField
            label="Round side trim"
            value={params.roundAdjust}
            onChange={(value) => onParamsChange({ ...params, roundAdjust: value })}
            min={-100}
            max={100}
            suffix="units"
          />
          <NumberField
            label="Open/diagonal trim"
            value={params.openAdjust}
            onChange={(value) => onParamsChange({ ...params, openAdjust: value })}
            min={-100}
            max={100}
            suffix="units"
          />
        </div>
        <p className="section-hint">
          Round trim is added to round sides (negative tucks them in). Open trim
          applies to diagonal/open sides such as v, w, y and V.
        </p>
        <Toggle
          label="Respect metrics keys"
          checked={params.respectMetricsKeys}
          onChange={(checked) => onParamsChange({ ...params, respectMetricsKeys: checked })}
          hint="Leave sidebearings that are linked to another glyph untouched."
        />
        <div className="inline-actions">
          <button
            className="button button--small"
            onClick={() =>
              onParamsChange({
                ...params,
                targetGapScale: 1,
                stemWeight: DEFAULT_SPACING_PARAMS.stemWeight,
                strength: 1,
                roundAdjust: 0,
                openAdjust: 0,
                lowercaseGapScale: 1,
                uppercaseGapScale: 1,
                punctuationGapScale: 1,
                respectMetricsKeys: true,
                opticalCompensation: DEFAULT_SPACING_PARAMS.opticalCompensation,
                roundTo: 1,
              })
            }
          >
            Reset tuning
          </button>
        </div>
      </Section>

      <Section
        title="Suggestions"
        actions={
          suggestions.length ? (
            <div className="inline-actions">
              <button className="button button--small" onClick={() => onApply(safe)} disabled={!safe.length}>
                Apply safe ({safe.length})
              </button>
              <button className="button button--small button--primary" onClick={() => onApply(suggestions)}>
                Apply all ({suggestions.length})
              </button>
            </div>
          ) : undefined
        }
        hint={
          suggestions.length
            ? `${suggestions.length} glyphs would change. Review the reasons, then apply.`
            : "Run the engine to get a proposal. Suggestions are non-destructive until applied."
        }
      >
        {suggestions.length ? (
          <div className="suggestion-list">
            {suggestions.slice(0, 80).map((suggestion) => {
              const suggestionGlyph = project.sources[project.activeSource].glyphs.find(
                (item) => item.name === suggestion.glyphName
              );
              return (
                <div className="suggestion-row" key={suggestion.id}>
                  <div className="suggestion-glyph">
                    {suggestionGlyph ? <GlyphThumb glyph={suggestionGlyph} size={26} /> : null}
                    <button className="inline-link" onClick={() => onSelectGlyph(suggestion.glyphName)}>
                      {suggestion.glyphName}
                    </button>
                  </div>
                  <div className="suggestion-values">
                    <span className="old-value">{suggestion.currentLeft.toFixed(0)}</span>
                    <span className="arrow">→</span>
                    <span className="new-value">{suggestion.proposedLeft.toFixed(0)}</span>
                    <span className="muted">/</span>
                    <span className="old-value">{suggestion.currentRight.toFixed(0)}</span>
                    <span className="arrow">→</span>
                    <span className="new-value">{suggestion.proposedRight.toFixed(0)}</span>
                  </div>
                  <ConfidenceBar value={suggestion.confidence} />
                  <div className="suggestion-reason">{suggestion.reason}</div>
                  <button className="button button--tiny" onClick={() => onApplyOne(suggestion)}>
                    Apply
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState>No active suggestions. Adjust the engine and run it again.</EmptyState>
        )}
      </Section>

      <Section
        title="Groups"
        hint="Spacing groups are different from kerning groups: they describe related side shapes."
        collapsible
        defaultOpen={false}
      >
        <div className="stat-grid">
          <Stat label="Left groups" value={groupSummary.leftGroups} />
          <Stat label="Right groups" value={groupSummary.rightGroups} />
          <Stat label="Ungrouped" value={groupSummary.ungrouped} tone={groupSummary.ungrouped ? "warning" : "ok"} />
        </div>
        <p className="section-hint">
          Auto groups uses the measured side profile (flat, round, open) and category. Review the result before relying on it.
        </p>
      </Section>
    </div>
  );
}

function KeyGlyphSelect({
  label,
  value,
  names,
  onChange,
}: {
  label: string;
  value: string;
  names: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select className="select-input" value={value} onChange={(event) => onChange(event.target.value)}>
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warning" }) {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
