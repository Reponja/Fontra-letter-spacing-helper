import { useMemo, useState } from "react";
import type { FontProject, QAIssue } from "../core/types";
import type { QAParams } from "../core/qa";
import { qaSummary } from "../core/qa";
import { NumberField, Section, Toggle } from "./controls";
import { EmptyState } from "./controls";

interface QAPanelProps {
  project: FontProject;
  issues: QAIssue[];
  params: QAParams;
  onRun: () => void;
  onParamsChange: (params: QAParams) => void;
  onSelectGlyph: (name: string) => void;
  onSelectPair: (pair: [string, string]) => void;
  onExport: (kind: "qa-csv" | "qa-html") => void;
}

type Filter = "all" | "error" | "warning" | "info";

export default function QAPanel(props: QAPanelProps) {
  const { project, issues, params, onRun, onParamsChange, onSelectGlyph, onSelectPair, onExport } = props;
  const [filter, setFilter] = useState<Filter>("all");
  const summary = useMemo(() => qaSummary(issues), [issues]);
  const filtered = issues.filter((issue) => filter === "all" || issue.severity === filter);

  return (
    <div className="panel-stack">
      <Section
        title="Health check"
        hint="QA is a review prompt, not a verdict. Some warnings are legitimate design decisions."
        actions={
          <button className="button button--primary" onClick={onRun}>Run QA</button>
        }
      >
        <div className="health-hero">
          <div className={`health-score ${summary.score >= 85 ? "is-good" : summary.score >= 60 ? "is-mid" : "is-low"}`}>
            <span>{summary.score}</span>
            <small>health</small>
          </div>
          <div className="health-breakdown">
            <div><span className="severity-dot severity-dot--error" /> {summary.errors} errors</div>
            <div><span className="severity-dot severity-dot--warning" /> {summary.warnings} warnings</div>
            <div><span className="severity-dot severity-dot--info" /> {summary.info} notes</div>
          </div>
        </div>
        <div className="field-grid field-grid--two">
          <NumberField
            label="Collision gap"
            value={params.collisionGap}
            onChange={(value) => onParamsChange({ ...params, collisionGap: value })}
            min={0}
          />
          <NumberField
            label="Max overkern"
            value={Math.round(params.maxOverkernRatio * 100)}
            onChange={(value) => onParamsChange({ ...params, maxOverkernRatio: value / 100 })}
            suffix="%"
            min={0}
            max={100}
          />
        </div>
        <Toggle
          label="Run collision scan"
          checked={params.checkCollisions !== false}
          onChange={(checked) => onParamsChange({ ...params, checkCollisions: checked })}
          hint="Scans the default pair list for ink collisions."
        />
      </Section>

      <Section
        title={`Issues (${filtered.length})`}
        actions={
          <div className="inline-actions">
            <button className="button button--tiny" onClick={() => onExport("qa-csv")}>CSV</button>
            <button className="button button--tiny" onClick={() => onExport("qa-html")}>HTML</button>
          </div>
        }
      >
        <div className="filter-row">
          {(["all", "error", "warning", "info"] as Filter[]).map((value) => (
            <button
              key={value}
              className={`chip ${filter === value ? "is-active" : ""}`}
              onClick={() => setFilter(value)}
            >
              {value}
            </button>
          ))}
        </div>
        {filtered.length ? (
          <div className="issue-list">
            {filtered.slice(0, 160).map((issue) => (
              <button
                key={issue.id}
                className={`issue issue--${issue.severity}`}
                onClick={() => {
                  if (issue.pair) onSelectPair(issue.pair);
                  else if (issue.glyphName) onSelectGlyph(issue.glyphName);
                }}
              >
                <span className={`severity-dot severity-dot--${issue.severity}`} />
                <span className="issue-body">
                  <span className="issue-title">{issue.title}</span>
                  <span className="issue-detail">{issue.detail}</span>
                  <span className="issue-meta">{issue.category}{issue.glyphName ? ` · ${issue.glyphName}` : ""}{issue.pair ? ` · ${issue.pair[0]}/${issue.pair[1]}` : ""}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState>No issues in this filter. Run QA to refresh.</EmptyState>
        )}
      </Section>

      <Section
        title="What gets checked"
        hint="A professional spacing pass needs both geometric checks and human proofing."
        collapsible
        defaultOpen={false}
      >
        <ul className="check-list">
          <li>Negative sidebearings and non-positive advances</li>
          <li>Spacing-rhythm outliers by glyph class</li>
          <li>Ink collisions and too-tight pairs</li>
          <li>Overkerned pairs (percentage of glyph width)</li>
          <li>Redundant exceptions and incomplete groups</li>
          <li>Figure width consistency (proportional vs tabular)</li>
          <li>Tracking intensity warnings</li>
          <li>Kerning coverage and “kerning debt”</li>
        </ul>
      </Section>

      <div className="callout callout--info">
        <strong>Proof at reading size.</strong>
        <span>Switch to Proof to see the waterfall, then blur and flip the canvas to reset your eye.</span>
        <button className="button button--small" onClick={() => onSelectGlyph(project.keyGlyphs.lowerStem)}>
          Show control glyph
        </button>
      </div>
    </div>
  );
}
