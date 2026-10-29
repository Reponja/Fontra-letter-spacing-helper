import type {
  AutoKernParams,
  FontProject,
  KerningSuggestion,
  QAIssue,
  SpacingParams,
  SpacingSuggestion,
} from "../core/types";
import type { QAParams } from "../core/qa";
import SpacingPanel from "./SpacingPanel";
import KerningPanel from "./KerningPanel";
import TrackingPanel from "./TrackingPanel";
import QAPanel from "./QAPanel";
import AssistantPanel from "./AssistantPanel";

export type InspectorTab = "spacing" | "kerning" | "tracking" | "qa" | "assistant";

interface InspectorProps {
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  project: FontProject;
  selectedGlyph: string;
  selectedPair: [string, string];
  spacingParams: SpacingParams;
  spacingSuggestions: SpacingSuggestion[];
  autoKernParams: AutoKernParams;
  kerningSuggestions: KerningSuggestion[];
  pairList: string[];
  issues: QAIssue[];
  qaParams: QAParams;
  onSelectGlyph: (name: string) => void;
  onSelectPair: (pair: [string, string]) => void;
  onSpacingParamsChange: (params: SpacingParams) => void;
  onKeyGlyphsChange: (keyGlyphs: FontProject["keyGlyphs"]) => void;
  onRunSpacing: () => void;
  onApplySpacing: (suggestions: SpacingSuggestion[]) => void;
  onApplySpacingOne: (suggestion: SpacingSuggestion) => void;
  onAutoGroups: () => void;
  onSidebearingChange: (glyphName: string, side: "left" | "right", value: number) => void;
  onAdvanceChange: (glyphName: string, value: number) => void;
  onMetricsKeyChange: (glyphName: string, side: "left" | "right", key: string | undefined) => void;
  onApplyMetricsKeys: () => void;
  onFindOutliers: () => void;
  onAutoKernParamsChange: (params: AutoKernParams) => void;
  onRunKerning: () => void;
  onApplyKerning: (suggestions: KerningSuggestion[]) => void;
  onApplyKerningOne: (suggestion: KerningSuggestion) => void;
  onPairListChange: (pairs: string[]) => void;
  onKerningChange: (left: string, right: string, value: number) => void;
  onGroupAssign: (glyphName: string, side: "left" | "right", group: string | undefined) => void;
  onGroupCreate: (side: "left" | "right", name: string) => void;
  onGroupDelete: (side: "left" | "right", name: string) => void;
  onKerningTransform: (kind: "round" | "prune" | "small" | "scale") => void;
  onTrackingChange: (project: FontProject) => void;
  onExportTracking: (kind: "features" | "css" | "tracking-json" | "tracking-csv") => void;
  onRunQA: () => void;
  onQAParamsChange: (params: QAParams) => void;
  onExportQA: (kind: "qa-csv" | "qa-html") => void;
  onSetMode: (mode: "spacing" | "kerning" | "tracking" | "proof" | "qa") => void;
}

const TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: "spacing", label: "Spacing" },
  { id: "kerning", label: "Kerning" },
  { id: "tracking", label: "Tracking" },
  { id: "qa", label: "QA" },
  { id: "assistant", label: "Assistant" },
];

export default function Inspector(props: InspectorProps) {
  const tab = props.tab;
  return (
    <aside className="inspector">
      <nav className="inspector-tabs" aria-label="Inspector sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`inspector-tab ${tab === item.id ? "is-active" : ""}`}
            onClick={() => props.onTabChange(item.id)}
          >
            {item.label}
            {item.id === "qa" && props.issues.some((issue) => issue.severity === "error") && (
              <span className="tab-alert" />
            )}
            {item.id === "spacing" && props.spacingSuggestions.length > 0 && (
              <span className="tab-count">{props.spacingSuggestions.length}</span>
            )}
            {item.id === "kerning" && props.kerningSuggestions.length > 0 && (
              <span className="tab-count">{props.kerningSuggestions.length}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="inspector-scroll">
        {tab === "spacing" && (
          <SpacingPanel
            project={props.project}
            selectedGlyph={props.selectedGlyph}
            params={props.spacingParams}
            suggestions={props.spacingSuggestions}
            onSelectGlyph={props.onSelectGlyph}
            onParamsChange={props.onSpacingParamsChange}
            onKeyGlyphsChange={props.onKeyGlyphsChange}
            onRun={props.onRunSpacing}
            onApply={props.onApplySpacing}
            onApplyOne={props.onApplySpacingOne}
            onAutoGroups={props.onAutoGroups}
            onSidebearingChange={props.onSidebearingChange}
            onAdvanceChange={props.onAdvanceChange}
            onMetricsKeyChange={props.onMetricsKeyChange}
            onApplyMetricsKeys={props.onApplyMetricsKeys}
            onFindOutliers={props.onFindOutliers}
          />
        )}
        {tab === "kerning" && (
          <KerningPanel
            project={props.project}
            selectedPair={props.selectedPair}
            pairList={props.pairList}
            params={props.autoKernParams}
            suggestions={props.kerningSuggestions}
            onSelectPair={props.onSelectPair}
            onParamsChange={props.onAutoKernParamsChange}
            onRun={props.onRunKerning}
            onApply={props.onApplyKerning}
            onApplyOne={props.onApplyKerningOne}
            onAutoGroups={props.onAutoGroups}
            onPairListChange={props.onPairListChange}
            onKerningChange={props.onKerningChange}
            onGroupAssign={props.onGroupAssign}
            onGroupCreate={props.onGroupCreate}
            onGroupDelete={props.onGroupDelete}
            onTransform={props.onKerningTransform}
          />
        )}
        {tab === "tracking" && (
          <TrackingPanel
            project={props.project}
            onChange={props.onTrackingChange}
            onExport={props.onExportTracking}
          />
        )}
        {tab === "qa" && (
          <QAPanel
            project={props.project}
            issues={props.issues}
            params={props.qaParams}
            onRun={props.onRunQA}
            onParamsChange={props.onQAParamsChange}
            onSelectGlyph={props.onSelectGlyph}
            onSelectPair={props.onSelectPair}
            onExport={props.onExportQA}
          />
        )}
        {tab === "assistant" && (
          <AssistantPanel
            project={props.project}
            issues={props.issues}
            spacingSuggestions={props.spacingSuggestions}
            kerningSuggestionCount={props.kerningSuggestions.length}
            onRunSpacing={props.onRunSpacing}
            onRunKerning={props.onRunKerning}
            onAutoGroups={props.onAutoGroups}
            onRunQA={props.onRunQA}
            onSelectGlyph={props.onSelectGlyph}
            onSetMode={props.onSetMode}
          />
        )}
      </div>
    </aside>
  );
}
