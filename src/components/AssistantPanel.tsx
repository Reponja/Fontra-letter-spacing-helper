import { useMemo } from "react";
import type { FontProject, QAIssue, SpacingSuggestion } from "../core/types";
import { defaultPairList, kerningDebt, kerningCoverage } from "../core/kerning";
import { spacingHealth, spacingOutliers } from "../core/spacing";
import { currentTrackingPerMille } from "../core/tracking";
import { qaSummary } from "../core/qa";
import { Section } from "./controls";

interface AssistantPanelProps {
  project: FontProject;
  issues: QAIssue[];
  spacingSuggestions: SpacingSuggestion[];
  kerningSuggestionCount: number;
  onRunSpacing: () => void;
  onRunKerning: () => void;
  onAutoGroups: () => void;
  onRunQA: () => void;
  onSelectGlyph: (name: string) => void;
  onSetMode: (mode: "spacing" | "kerning" | "tracking" | "proof" | "qa") => void;
}

export default function AssistantPanel({
  project,
  issues,
  spacingSuggestions,
  kerningSuggestionCount,
  onRunSpacing,
  onRunKerning,
  onAutoGroups,
  onRunQA,
  onSelectGlyph,
  onSetMode,
}: AssistantPanelProps) {
  const outliers = useMemo(() => spacingOutliers(project), [project]);
  const health = useMemo(() => spacingHealth(project), [project]);
  const qa = useMemo(() => qaSummary(issues), [issues]);
  const pairs = useMemo(() => defaultPairList(project), [project]);
  const debt = useMemo(() => kerningDebt(project, pairs, 4), [project, pairs]);
  const coverage = useMemo(() => kerningCoverage(project, pairs), [project, pairs]);
  const groupsReady =
    Object.keys(project.groups.left).length > 0 && Object.keys(project.groups.right).length > 0;
  const kerningExists = Object.values(project.sources[project.activeSource].kerning).some((value) => value !== 0);

  const steps = [
    {
      title: "Set the rhythm keys",
      body: `Currently ${project.keyGlyphs.lowerStem}/${project.keyGlyphs.lowerRound} for lowercase and ${project.keyGlyphs.upperStem}/${project.keyGlyphs.upperRound} for uppercase.`,
      done: !!project.keyGlyphs.lowerStem,
      action: "Show key glyph",
      onClick: () => onSelectGlyph(project.keyGlyphs.lowerStem),
    },
    {
      title: "Auto-space from the keys",
      body: spacingSuggestions.length
        ? `${spacingSuggestions.length} suggestions are ready for review.`
        : "Run the engine to get a first pass. Nothing is applied automatically.",
      done: spacingSuggestions.length > 0,
      action: "Suggest spacing",
      onClick: onRunSpacing,
    },
    {
      title: "Review the rhythm",
      body: outliers.length
        ? `${outliers.length} sidebearing outliers want a human look.`
        : "No obvious outliers. That is a good sign, not a guarantee.",
      done: outliers.length === 0,
      action: "Find outliers",
      onClick: () => onSetMode("qa"),
    },
    {
      title: "Build groups",
      body: groupsReady
        ? `${Object.keys(project.groups.left).length} left and ${Object.keys(project.groups.right).length} right groups.`
        : "Groups make kerning manageable. Auto-group, then review.",
      done: groupsReady,
      action: "Auto groups",
      onClick: onAutoGroups,
    },
    {
      title: "Kern only the exceptions",
      body: kerningSuggestionCount
        ? `${kerningSuggestionCount} kerning suggestions are waiting.`
        : "Spacing should do most of the work. Kern the pairs that still fail.",
      done: kerningSuggestionCount > 0 || coverage > 0,
      action: "Suggest kerning",
      onClick: onRunKerning,
    },
    {
      title: "Proof and ship",
      body: `Tracking is ${currentTrackingPerMille(project) > 0 ? "+" : ""}${currentTrackingPerMille(project)} units/1000 em. Run QA before export.`,
      done: qa.errors === 0 && qa.warnings === 0,
      action: "Run QA",
      onClick: onRunQA,
    },
  ];

  const next = steps.find((step) => !step.done) ?? steps[steps.length - 1];

  return (
    <div className="panel-stack">
      <Section title="Assistant" hint="A guided path from rough outlines to a proofed spacing system. You stay in control.">
        <div className="assistant-hero">
          <div className="assistant-score">
            <span>{qa.score}</span>
            <small>overall</small>
          </div>
          <div className="assistant-next">
            <span className="eyebrow">Next best action</span>
            <strong>{next.title}</strong>
            <p>{next.body}</p>
            <button className="button button--primary" onClick={next.onClick}>{next.action}</button>
          </div>
        </div>
      </Section>

      <Section title="Workflow" hint="The order matters: spacing first, kerning second, tracking last.">
        <div className="workflow">
          {steps.map((step, index) => (
            <div className={`workflow-step ${step.done ? "is-done" : ""}`} key={step.title}>
              <span className="step-index">{step.done ? "✓" : index + 1}</span>
              <div className="step-body">
                <strong>{step.title}</strong>
                <p>{step.body}</p>
                <button className="inline-link" onClick={step.onClick}>{step.action} →</button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Health" hint="Geometric checks and a little judgement.">
        <div className="stat-grid stat-grid--four">
          <Stat label="Spacing" value={health.score} suffix="/100" />
          <Stat label="Outliers" value={health.outliers} tone={health.outliers ? "warning" : "ok"} />
          <Stat label="Kerning debt" value={Math.round(debt)} suffix="u" tone={debt > 30 ? "warning" : "ok"} />
          <Stat label="Coverage" value={Math.round(coverage)} suffix="%" />
        </div>
        {(kerningExists && outliers.length > 0) && (
          <div className="callout callout--warning">
            <strong>Space first.</strong>
            <span>
              You have kerning and {outliers.length} spacing outliers. Every kerning value you add now may
              need to be redone after spacing changes.
            </span>
          </div>
        )}
      </Section>

      <Section title="Methods in this build" hint="Fit ships with several engines and a solver, not a single black box.">
        <div className="method-list">
          <div><strong>Stem / cadence</strong><span>Measures the n/m stem interval and derives sidebearings from glyph classes.</span></div>
          <div><strong>Optical</strong><span>Compares the side profile of each glyph to the key glyph and compensates for round/open shapes.</span></div>
          <div><strong>Hybrid</strong><span>Blends both methods for a robust first pass on Latin text faces.</span></div>
          <div><strong>Constraint solver</strong><span>Distributes pair residuals into sidebearings and minimal kerning instead of a giant kern table.</span></div>
        </div>
      </Section>

      <div className="callout callout--info">
        <strong>This is an assistant, not an autopilot.</strong>
        <span>
          Suggestions carry confidence and a reason. Apply safe suggestions in bulk, or review one by one.
          Everything is undoable.
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, suffix, tone }: { label: string; value: number; suffix?: string; tone?: "ok" | "warning" }) {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}{suffix && <small>{suffix}</small>}</strong>
    </div>
  );
}
