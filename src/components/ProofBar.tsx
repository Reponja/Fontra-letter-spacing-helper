import type { AppSettings } from "../core/types";
import { SliderField } from "./controls";

interface ProofBarProps {
  settings: AppSettings;
  text: string;
  measurementLine: number;
  onSettingsChange: (patch: Partial<AppSettings>) => void;
  onTextChange: (text: string) => void;
  onMeasurementLineChange: (value: number) => void;
  onSetMode: (mode: AppSettings["mode"]) => void;
}

const STRINGS: Array<{ label: string; text: string }> = [
  { label: "Control", text: "nnoo HHOO nono HOHO" },
  { label: "Hamburgevons", text: "hamburgevons" },
  { label: "Kern King", text: "AVATAR To Ty Wa Yo LT P. F, r. v. Y. 7. 9." },
  { label: "Spacing test", text: "nanoao nbnobo ncnoco ndnodo" },
  { label: "Pangram", text: "The quick brown fox jumps over the lazy dog" },
  { label: "Multilingual", text: "Hamburgevons fjord æble Größe Ελληνικά Кириллица" },
];

const MODES: Array<{ id: AppSettings["mode"]; label: string; key: string }> = [
  { id: "spacing", label: "Spacing", key: "1" },
  { id: "kerning", label: "Kerning", key: "2" },
  { id: "tracking", label: "Tracking", key: "3" },
  { id: "proof", label: "Proof", key: "4" },
  { id: "qa", label: "QA", key: "5" },
];

export default function ProofBar({
  settings,
  text,
  measurementLine,
  onSettingsChange,
  onTextChange,
  onMeasurementLineChange,
  onSetMode,
}: ProofBarProps) {
  return (
    <footer className="proofbar">
      <div className="mode-tabs" role="tablist" aria-label="Editing mode">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            role="tab"
            aria-selected={settings.mode === mode.id}
            className={`mode-tab ${settings.mode === mode.id ? "is-active" : ""}`}
            onClick={() => onSetMode(mode.id)}
            title={`${mode.label} (${mode.key})`}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <div className="text-entry">
        <input
          className="text-input text-input--large"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="Type text to proof…"
          aria-label="Proof text"
        />
        <select
          className="select-input select-input--compact"
          value=""
          onChange={(event) => {
            const preset = STRINGS.find((item) => item.label === event.target.value);
            if (preset) onTextChange(preset.text);
          }}
        >
          <option value="">Strings…</option>
          {STRINGS.map((preset) => (
            <option key={preset.label} value={preset.label}>{preset.label}</option>
          ))}
        </select>
      </div>

      <div className="proof-toggles">
        <ToggleButton label="Guides" active={settings.showGuides} onClick={() => onSettingsChange({ showGuides: !settings.showGuides })} />
        <ToggleButton label="Metrics" active={settings.showMetrics} onClick={() => onSettingsChange({ showMetrics: !settings.showMetrics })} />
        <ToggleButton label="Kern" active={settings.showKerning} onClick={() => onSettingsChange({ showKerning: !settings.showKerning })} />
        <ToggleButton label="Boxes" active={settings.spacingOnly} onClick={() => onSettingsChange({ spacingOnly: !settings.spacingOnly })} />
        <ToggleButton label="Ghost" active={settings.compareGhost} onClick={() => onSettingsChange({ compareGhost: !settings.compareGhost })} />
        <ToggleButton label="Flip" active={settings.flip} onClick={() => onSettingsChange({ flip: !settings.flip })} />
        <ToggleButton label="Blur" active={settings.blur > 0} onClick={() => onSettingsChange({ blur: settings.blur > 0 ? 0 : 2 })} />
      </div>

      <div className="proof-sliders">
        <SliderField
          label="Measurement"
          value={measurementLine}
          min={0}
          max={1}
          step={0.05}
          onChange={onMeasurementLineChange}
          format={(value) => value === 0 ? "off" : `${Math.round(value * 100)}% x-height`}
        />
        <SliderField
          label="Zoom"
          value={settings.zoom}
          min={0.4}
          max={3}
          step={0.1}
          onChange={(value) => onSettingsChange({ zoom: value })}
          format={(value) => `${value.toFixed(1)}×`}
        />
      </div>
    </footer>
  );
}

function ToggleButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`toggle-button ${active ? "is-active" : ""}`} onClick={onClick} aria-pressed={active}>
      {label}
    </button>
  );
}
