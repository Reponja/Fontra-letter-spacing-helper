import { useState } from "react";
import type { FontProject } from "../core/types";
import {
  currentTrackingPerMille,
  generateTrackingFeatures,
  trackingAdvance,
  trackingCss,
  trackingRamp,
} from "../core/tracking";
import { NumberField, Section, SliderField, Toggle } from "./controls";

interface TrackingPanelProps {
  project: FontProject;
  onChange: (project: FontProject) => void;
  onExport: (kind: "features" | "css" | "tracking-json" | "tracking-csv") => void;
}

export default function TrackingPanel({ project, onChange, onExport }: TrackingPanelProps) {
  const [copied, setCopied] = useState(false);
  const perMille = currentTrackingPerMille(project);
  const features = generateTrackingFeatures(project);
  const css = trackingCss(project);
  const ramp = trackingRamp(project);

  const update = (mutator: (draft: FontProject) => void) => {
    const next = structuredClone(project);
    mutator(next);
    onChange(next);
  };

  return (
    <div className="panel-stack">
      <Section
        title="Tracking"
        hint="Tracking is uniform spacing. Unlike kerning, it is usually applied by the layout app, not baked into the font."
      >
        <div className="tracking-value">
          <div>
            <span className="tracking-number">{perMille > 0 ? "+" : ""}{perMille}</span>
            <span className="tracking-unit">units / 1000 em</span>
          </div>
          <span className="tracking-px">{trackingAdvance(project).toFixed(1)} units at {project.unitsPerEm} UPM</span>
        </div>
        <div className="preset-grid">
          {project.tracking.presets.map((preset) => (
            <button
              key={preset.id}
              className={`preset ${project.tracking.activePreset === preset.id ? "is-active" : ""}`}
              onClick={() =>
                update((draft) => {
                  draft.tracking.activePreset = preset.id;
                  if (preset.id === "custom") draft.tracking.customPerMille = perMille;
                })
              }
            >
              <span>{preset.label}</span>
              <strong>{preset.perMille > 0 ? "+" : ""}{preset.perMille}</strong>
              <small>{preset.note}</small>
            </button>
          ))}
        </div>
        <SliderField
          label="Custom tracking"
          value={project.tracking.activePreset === "custom" ? project.tracking.customPerMille : perMille}
          min={-80}
          max={160}
          step={1}
          onChange={(value) =>
            update((draft) => {
              draft.tracking.activePreset = "custom";
              draft.tracking.customPerMille = value;
            })
          }
          format={(value) => `${value > 0 ? "+" : ""}${value} / 1000 em`}
        />
        <div className="field-grid field-grid--two">
          <Toggle
            label="Capital spacing (cpsp)"
            checked={project.tracking.applyCapsSpacing}
            onChange={(checked) =>
              update((draft) => {
                draft.tracking.applyCapsSpacing = checked;
              })
            }
            hint="Generate a cpsp feature to add air between capitals."
          />
          <NumberField
            label="Caps tracking"
            value={project.tracking.capsPerMille}
            onChange={(value) =>
              update((draft) => {
                draft.tracking.capsPerMille = value;
              })
            }
            suffix="/ 1000 em"
          />
        </div>
      </Section>

      <Section title="Optical-size ramp" hint="A starting point for text vs display sizes. The font itself can expose this through an opsz axis or size-specific masters.">
        <div className="ramp">
          {ramp.map((step) => (
            <div className="ramp-step" key={step.size}>
              <span>{step.size}px</span>
              <span className="ramp-bar">
                <span style={{ width: `${Math.max(2, Math.abs(step.perMille) * 3)}px` }} />
              </span>
              <strong>{step.perMille > 0 ? "+" : ""}{step.perMille}</strong>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="OpenType preview"
        hint="This is the code Fit would generate. It is intentionally separate from your existing kern feature."
        collapsible
        defaultOpen={false}
        actions={
          <div className="inline-actions">
            <button className="button button--tiny" onClick={() => onExport("features")}>Download .fea</button>
            <button
              className="button button--tiny"
              onClick={async () => {
                await navigator.clipboard?.writeText(features);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        }
      >
        <pre className="code-block">{features}</pre>
      </Section>

      <Section
        title="CSS / layout equivalent"
        hint="Use this when you are testing tracking in a browser or design app."
        collapsible
        defaultOpen={false}
      >
        <pre className="code-block code-block--small">{css}</pre>
        <div className="inline-actions">
          <button className="button button--small" onClick={() => onExport("css")}>Download CSS</button>
          <button className="button button--small" onClick={() => onExport("tracking-json")}>JSON</button>
          <button className="button button--small" onClick={() => onExport("tracking-csv")}>CSV</button>
        </div>
      </Section>

      <div className="callout callout--info">
        <strong>Tracking ≠ kerning.</strong>
        <span>
          Kerning fixes specific pairs. Tracking changes every gap. If you find yourself adding tracking to fix
          a few bad pairs, go back to spacing and kerning.
        </span>
      </div>
    </div>
  );
}
