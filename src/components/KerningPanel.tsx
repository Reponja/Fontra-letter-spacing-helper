import { useMemo, useState } from "react";
import type {
  AutoKernParams,
  FontProject,
  KerningSuggestion,
} from "../core/types";
import {
  activeSource,
  getGlyph,
  hasExplicitKerning,
  kerningKey,
  leftGroupOf,
  resolveKerning,
  rightGroupOf,
  splitKerningKey,
} from "../core/project";
import {
  defaultPairList,
  minimumPairGap,
  targetPairGap,
} from "../core/kerning";
import { sidebearingsOf } from "../core/geometry";
import { ConfidenceBar, EmptyState, NumberField, Section, SliderField } from "./controls";
import GlyphThumb from "./GlyphThumb";

interface KerningPanelProps {
  project: FontProject;
  selectedPair: [string, string];
  pairList: string[];
  params: AutoKernParams;
  suggestions: KerningSuggestion[];
  onSelectPair: (pair: [string, string]) => void;
  onParamsChange: (params: AutoKernParams) => void;
  onRun: () => void;
  onApply: (suggestions: KerningSuggestion[]) => void;
  onApplyOne: (suggestion: KerningSuggestion) => void;
  onAutoGroups: () => void;
  onPairListChange: (pairs: string[]) => void;
  onKerningChange: (left: string, right: string, value: number) => void;
  onGroupAssign: (glyphName: string, side: "left" | "right", group: string | undefined) => void;
  onGroupCreate: (side: "left" | "right", name: string) => void;
  onGroupDelete: (side: "left" | "right", name: string) => void;
  onTransform: (kind: "round" | "prune" | "small" | "scale") => void;
}

export default function KerningPanel(props: KerningPanelProps) {
  const {
    project,
    selectedPair,
    pairList,
    params,
    suggestions,
    onSelectPair,
    onParamsChange,
    onRun,
    onApply,
    onApplyOne,
    onAutoGroups,
    onPairListChange,
    onKerningChange,
    onGroupAssign,
    onGroupCreate,
    onGroupDelete,
    onTransform,
  } = props;
  const [pairSearch, setPairSearch] = useState("");
  const [groupSide, setGroupSide] = useState<"left" | "right">("left");
  const [newGroup, setNewGroup] = useState("");
  const [showGroups, setShowGroups] = useState(true);

  const left = getGlyph(project, selectedPair[0]);
  const right = getGlyph(project, selectedPair[1]);
  const value = resolveKerning(project, selectedPair[0], selectedPair[1]);
  const explicit = hasExplicitKerning(project, selectedPair[0], selectedPair[1]);
  const minGap = minimumPairGap(project, selectedPair[0], selectedPair[1]);
  const target = targetPairGap(project, selectedPair[0], selectedPair[1], 120, 0.55);
  const suggestion = suggestions.find(
    (item) => item.left === selectedPair[0] && item.right === selectedPair[1]
  );
  const leftGroup = leftGroupOf(project, selectedPair[0]);
  const rightGroup = rightGroupOf(project, selectedPair[1]);

  const rows = useMemo(() => {
    const list = pairList.length ? pairList : defaultPairList(project);
    const filtered = pairSearch
      ? list.filter((key) => {
          const [l, r] = splitKerningKey(key);
          return `${l}${r}`.toLowerCase().includes(pairSearch.toLowerCase());
        })
      : list;
    return filtered.slice(0, 260).map((key) => {
      const [l, r] = splitKerningKey(key);
      return {
        key,
        left: l,
        right: r,
        value: resolveKerning(project, l, r),
        explicit: hasExplicitKerning(project, l, r),
      };
    });
  }, [pairList, pairSearch, project]);

  const safe = suggestions.filter((item) => item.confidence >= 0.82 && !item.collision);

  return (
    <div className="panel-stack">
      <Section
        title="Current pair"
        hint="Kerning is a local correction. If a pair needs a lot of kerning, fix spacing first."
        actions={
          <button className="button button--tiny" onClick={() => onSelectPair([selectedPair[0], selectedPair[1]])}>
            Focus
          </button>
        }
      >
        <div className="pair-head">
          <div className="pair-glyph">
            <GlyphThumb glyph={left!} size={34} />
            <span>{selectedPair[0]}</span>
          </div>
          <div className={`pair-value ${value < 0 ? "negative" : value > 0 ? "positive" : ""}`}>
            {value > 0 ? "+" : ""}
            {Math.round(value)}
          </div>
          <div className="pair-glyph">
            <GlyphThumb glyph={right!} size={34} />
            <span>{selectedPair[1]}</span>
          </div>
        </div>
        <div className="field-grid field-grid--three">
          <NumberField
            label="Kern value"
            value={value}
            step={1}
            onChange={(next) => onKerningChange(selectedPair[0], selectedPair[1], next)}
          />
          <NumberField
            label="Min ink gap"
            value={minGap ?? 0}
            onChange={() => undefined}
            disabled
          />
          <NumberField
            label="Target gap"
            value={target}
            onChange={() => undefined}
            disabled
          />
        </div>
        <div className="metric-note">
          {left && right
            ? `RSB ${sidebearingsOf(left).right.toFixed(0)} + LSB ${sidebearingsOf(right).left.toFixed(0)} + kern ${value.toFixed(0)} = ${(sidebearingsOf(left).right + sidebearingsOf(right).left + value).toFixed(0)} units`
            : "Select a valid pair."}
        </div>
        <div className="badge-row">
          {explicit ? <span className="badge badge--accent">Exception</span> : <span className="badge">Inherited / zero</span>}
          {leftGroup && <span className="badge">left @{leftGroup}</span>}
          {rightGroup && <span className="badge">right @{rightGroup}</span>}
        </div>
      </Section>

      <Section
        title="Groups"
        actions={
          <button className="button button--small" onClick={() => setShowGroups((show) => !show)}>
            {showGroups ? "Hide" : "Show"}
          </button>
        }
        hint="Assign glyphs to left (side 1) and right (side 2) groups. Exceptions can override group values."
      >
        <div className="group-assign-grid">
          {Array.from(new Set(selectedPair)).map((glyphName) => {
            const glyph = getGlyph(project, glyphName);
            return (
              <div className="group-assign-card" key={glyphName}>
                <div className="group-assign-head">
                  {glyph && <GlyphThumb glyph={glyph} size={22} />}
                  <strong>{glyphName}</strong>
                </div>
                <div className="field-grid field-grid--two">
                  <label className="field">
                    <span>Side 1 group</span>
                    <select
                      className="select-input"
                      value={leftGroupOf(project, glyphName) ?? ""}
                      onChange={(event) =>
                        onGroupAssign(glyphName, "left", event.target.value || undefined)
                      }
                    >
                      <option value="">— none —</option>
                      {Object.keys(project.groups.left).map((name) => (
                        <option key={name} value={name}>@{name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Side 2 group</span>
                    <select
                      className="select-input"
                      value={rightGroupOf(project, glyphName) ?? ""}
                      onChange={(event) =>
                        onGroupAssign(glyphName, "right", event.target.value || undefined)
                      }
                    >
                      <option value="">— none —</option>
                      {Object.keys(project.groups.right).map((name) => (
                        <option key={name} value={name}>@{name}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <div className="inline-actions">
          <button className="button button--small" onClick={onAutoGroups}>Auto groups</button>
          <span className="muted small">Side 1 = left glyph in LTR; side 2 = right glyph.</span>
        </div>
        {showGroups && (
          <div className="group-columns">
            {(["left", "right"] as const).map((side) => (
              <div className="group-column" key={side}>
                <div className="group-column-head">
                  <strong>{side} groups</strong>
                  <span>{Object.keys(project.groups[side]).length}</span>
                </div>
                <div className="group-list">
                  {Object.entries(project.groups[side]).map(([name, glyphs]) => (
                    <div className="group-row" key={name}>
                      <span className="group-name">@{name}</span>
                      <span className="muted">{glyphs.length}</span>
                      <button
                        className="icon-button icon-button--tiny"
                        title="Delete group"
                        onClick={() => onGroupDelete(side, name)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {!Object.keys(project.groups[side]).length && <div className="muted small">No groups yet.</div>}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="inline-actions">
          <select className="select-input" value={groupSide} onChange={(event) => setGroupSide(event.target.value as "left" | "right")}>
            <option value="left">left</option>
            <option value="right">right</option>
          </select>
          <input
            className="text-input"
            placeholder="new group name"
            value={newGroup}
            onChange={(event) => setNewGroup(event.target.value)}
          />
          <button
            className="button button--small"
            onClick={() => {
              if (newGroup.trim()) {
                onGroupCreate(groupSide, newGroup.trim());
                setNewGroup("");
              }
            }}
          >
            Add group
          </button>
        </div>
      </Section>

      <Section
        title="Pair list"
        hint="A pair list keeps kerning focused. Build one for the combinations that actually need work."
        actions={
          <div className="inline-actions">
            <button className="button button--tiny" onClick={() => onPairListChange(defaultPairList(project))}>
              All pairs
            </button>
            <button className="button button--tiny" onClick={() => onPairListChange([])}>
              Clear
            </button>
          </div>
        }
      >
        <div className="pair-progress">
          <span>{pairList.length || defaultPairList(project).length} pairs</span>
          <span className="muted">Click a row to load it in the canvas</span>
        </div>
        <input
          className="text-input"
          placeholder="Filter pairs…"
          value={pairSearch}
          onChange={(event) => setPairSearch(event.target.value)}
        />
        <div className="pair-table-wrap">
          <table className="pair-table">
            <thead>
              <tr><th>Left</th><th>Right</th><th>Value</th><th>Type</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={row.left === selectedPair[0] && row.right === selectedPair[1] ? "is-selected" : ""}
                  onClick={() => onSelectPair([row.left, row.right])}
                >
                  <td>{row.left}</td>
                  <td>{row.right}</td>
                  <td className={row.value < 0 ? "negative" : row.value > 0 ? "positive" : ""}>
                    {row.value > 0 ? "+" : ""}{Math.round(row.value)}
                  </td>
                  <td>{row.explicit ? <span className="badge badge--accent">exception</span> : <span className="muted">group/zero</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <EmptyState>No pairs in this list.</EmptyState>}
        </div>
      </Section>

      <Section title="Auto-kerning" hint="The engine only proposes the obvious pairs. It will not invent a thousand meaningless kerns.">
        <div className="field-grid field-grid--two">
          <NumberField
            label="Threshold"
            value={params.threshold}
            onChange={(value) => onParamsChange({ ...params, threshold: value })}
            min={0}
          />
          <NumberField
            label="Collision gap"
            value={params.collisionGap}
            onChange={(value) => onParamsChange({ ...params, collisionGap: value })}
            min={0}
          />
          <NumberField
            label="Min kern"
            value={params.minKern}
            onChange={(value) => onParamsChange({ ...params, minKern: value })}
          />
          <NumberField
            label="Max kern"
            value={params.maxKern}
            onChange={(value) => onParamsChange({ ...params, maxKern: value })}
          />
        </div>
        <SliderField
          label="Only pairs with kern ≥"
          value={params.threshold}
          min={0}
          max={30}
          step={1}
          onChange={(value) => onParamsChange({ ...params, threshold: value })}
          format={(value) => `${value} units`}
        />
        <div className="inline-actions">
          <button className="button button--primary" onClick={onRun}>Suggest kerning</button>
          <button className="button" onClick={() => onApply(safe)} disabled={!safe.length}>
            Apply safe ({safe.length})
          </button>
          <button className="button" onClick={() => onApply(suggestions)} disabled={!suggestions.length}>
            Apply all ({suggestions.length})
          </button>
        </div>
        {suggestions.length ? (
          <div className="suggestion-list">
            {suggestions.slice(0, 60).map((item) => (
              <div className="suggestion-row suggestion-row--kern" key={item.id}>
                <div className="suggestion-pair">
                  <GlyphThumb glyph={getGlyph(project, item.left)!} size={24} />
                  <span>{item.left}{item.right}</span>
                  <GlyphThumb glyph={getGlyph(project, item.right)!} size={24} />
                </div>
                <div className="suggestion-values">
                  <span className="old-value">{item.currentValue}</span>
                  <span className="arrow">→</span>
                  <span className="new-value">{item.value}</span>
                </div>
                <ConfidenceBar value={item.confidence} />
                <div className="suggestion-reason">
                  {item.collision ? "Collision · " : ""}{item.reason}
                </div>
                <button className="button button--tiny" onClick={() => onApplyOne(item)}>Apply</button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>Run the auto-kerner after spacing is in good shape.</EmptyState>
        )}
      </Section>

      <Section title="Batch transforms" hint="Clean up the kerning table without changing the design intent.">
        <div className="inline-actions">
          <button className="button button--small" onClick={() => onTransform("round")}>Round to 5</button>
          <button className="button button--small" onClick={() => onTransform("prune")}>Prune redundant</button>
          <button className="button button--small" onClick={() => onTransform("small")}>Remove small</button>
          <button className="button button--small" onClick={() => onTransform("scale")}>Scale ×0.9</button>
        </div>
        {suggestion && (
          <div className="callout">
            <strong>Selected pair suggestion</strong>
            <span>{suggestion.reason}</span>
            <button className="button button--tiny" onClick={() => onApplyOne(suggestion)}>Apply {suggestion.value}</button>
          </div>
        )}
      </Section>
    </div>
  );
}
