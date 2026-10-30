import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppSettings,
  AutoKernParams,
  FontProject,
  KerningSuggestion,
  ProjectSnapshot,
  QAIssue,
  SpacingParams,
  SpacingSuggestion,
} from "./core/types";
import {
  cloneProject,
  createEmptyProject,
  deleteGroup,
  ensureGroups,
  getGlyph,
  activeSource,
  applyMetricsKeys,
  assignGlyphToGroup,
  resolveKerning,
  resolvedMetricsSide,
  setKerning,
  sortedGlyphs,
} from "./core/project";
import {
  setAdvanceWidth,
  setSidebearing,
  sidebearingsOf,
} from "./core/geometry";
import {
  DEFAULT_SPACING_PARAMS,
  applySpacingSuggestions,
  defaultTargetGap,
  spacingSuggestions as makeSpacingSuggestions,
  spacingHealth,
} from "./core/spacing";
import {
  autoKernSuggestions as makeKerningSuggestions,
  applyKerningSuggestions,
  defaultPairList,
  pruneRedundantExceptions,
  removeSmallPairs,
  roundKerning,
  scaleKerning,
  autoAssignGroups,
} from "./core/kerning";
import { solveSpacingAndKerning } from "./core/solver";
import { DEFAULT_QA_PARAMS, runQA, qaSummary, type QAParams } from "./core/qa";
import { loadBundledFontraDemo } from "./core/import/fontra";
import { loadDemoOpentype, importOpentypeFile } from "./core/import/opentype";
import { readFontraDirectory, readFontraZip } from "./core/import/fontra";
import { readUfoDirectory, readUfoZip } from "./core/import/ufo";
import { readDesignspaceDirectory } from "./core/import/designspace";
import {
  exportDesignspace,
  exportFeatures,
  exportFontra,
  exportOtfont,
  exportProjectJson,
  exportQACsv,
  exportQAHtml,
  exportTrackingCss,
  exportTrackingCsv,
  exportTrackingJson,
  exportUfo,
  parseProjectJson,
} from "./core/io";
import TopBar, { type ExportKind } from "./components/TopBar";
import GlyphList from "./components/GlyphList";
import CanvasView from "./components/CanvasView";
import ProofBar from "./components/ProofBar";
import Inspector, { type InspectorTab } from "./components/Inspector";
import { spacingOutliers } from "./core/spacing";
import { currentTrackingPerMille } from "./core/tracking";

const DEFAULT_SETTINGS: AppSettings = {
  mode: "spacing",
  showMetrics: true,
  showGuides: true,
  showSidebearings: true,
  showKerning: true,
  spacingOnly: false,
  blur: 0,
  flip: false,
  zoom: 1,
  fontSize: 100,
  text: "nnoo hamburgevons",
  theme: "light",
  compareGhost: true,
  referenceFontName: "",
  measurementLine: 0.5,
  showAdvance: true,
};

const DEFAULT_AUTO_KERN: AutoKernParams = {
  threshold: 3,
  minKern: -250,
  maxKern: 180,
  collisionGap: 8,
  onlyPairList: true,
};

export default function App() {
  const [project, setProject] = useState<FontProject>(createEmptyProject("Loading…"));
  const projectRef = useRef(project);
  const [history, setHistory] = useState<ProjectSnapshot[]>([]);
  const [future, setFuture] = useState<ProjectSnapshot[]>([]);
  const [ghostProject, setGhostProject] = useState<FontProject>();
  const [referenceProject, setReferenceProject] = useState<FontProject>();
  const [selectedGlyph, setSelectedGlyph] = useState("n");
  const [selectedPair, setSelectedPair] = useState<[string, string]>(["n", "o"]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("spacing");
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [spacingParams, setSpacingParams] = useState<SpacingParams>(DEFAULT_SPACING_PARAMS);
  const [spacingSuggestionList, setSpacingSuggestionList] = useState<SpacingSuggestion[]>([]);
  const [autoKernParams, setAutoKernParams] = useState<AutoKernParams>(DEFAULT_AUTO_KERN);
  const [kerningSuggestions, setKerningSuggestions] = useState<KerningSuggestion[]>([]);
  const [pairList, setPairList] = useState<string[]>([]);
  const [qaParams, setQaParams] = useState<QAParams>(DEFAULT_QA_PARAMS);
  const [issues, setIssues] = useState<QAIssue[]>([]);
  const [measurementLine, setMeasurementLine] = useState(0.5);
  const [toast, setToast] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    // The theme variables live on [data-theme], but body text/background are
    // outside .app. Set the attribute on <html> so inherited colors (buttons,
    // glyph rows, native controls) switch with the theme too.
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.colorScheme = settings.theme;
  }, [settings.theme]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(undefined), 2600);
  }, []);

  const loadProject = useCallback((next: FontProject, message?: string) => {
    const normalized = cloneProject(next);
    setProject(normalized);
    projectRef.current = normalized;
    setHistory([]);
    setFuture([]);
    setGhostProject(undefined);
    setSpacingSuggestionList([]);
    setKerningSuggestions([]);
    const glyphs = sortedGlyphs(normalized);
    const names = new Set(glyphs.map((glyph) => glyph.name));
    const preferredGlyph = names.has("n") ? "n" : names.has("o") ? "o" : glyphs[0]?.name ?? "";
    setSelectedGlyph(preferredGlyph);
    const preferredPair: [string, string] =
      names.has("n") && names.has("o")
        ? ["n", "o"]
        : glyphs.length > 1
          ? [glyphs[0].name, glyphs[1].name]
          : [preferredGlyph, preferredGlyph];
    setSelectedPair(preferredPair);
    setPairList(defaultPairList(normalized));
    const hasUppercase = names.has("H");
    setSettings((current) => ({
      ...current,
      text: hasUppercase ? "nnoo HHOO hamburgevons" : "nnoo hamburgevons",
    }));
    setIssues(runQA(normalized, DEFAULT_QA_PARAMS));
    if (message) showToast(message);
  }, [showToast]);

  // Load the bundled Fontra sample. If it is unavailable, fall back to the
  // bundled TTF so the app always has something to show.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await loadBundledFontraDemo("/demo-fontra");
        if (!cancelled && result.project.sources[0].glyphs.length) {
          loadProject(result.project, "Loaded Fontulja sample");
          setLoading(false);
          return;
        }
      } catch (error) {
        console.warn("Fontra demo failed", error);
      }
      try {
        const result = await loadDemoOpentype("/demo.ttf");
        if (!cancelled) {
          loadProject(result.project, "Loaded demo font");
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          loadProject(createEmptyProject("Untitled"), "Start with an empty project or import a font");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProject]);

  const commit = useCallback((label: string, mutator: (draft: FontProject) => void) => {
    const previous = projectRef.current;
    const next = cloneProject(previous);
    mutator(next);
    setHistory((items) => [...items.slice(-59), { project: previous, label, timestamp: Date.now() }]);
    setFuture([]);
    projectRef.current = next;
    setProject(next);
  }, []);

  const undo = useCallback(() => {
    setHistory((items) => {
      if (!items.length) return items;
      const snapshot = items[items.length - 1];
      const current = projectRef.current;
      setFuture((redoItems) => [...redoItems, { project: current, label: snapshot.label, timestamp: Date.now() }]);
      projectRef.current = snapshot.project;
      setProject(snapshot.project);
      showToast(`Undo: ${snapshot.label}`);
      return items.slice(0, -1);
    });
  }, [showToast]);

  const redo = useCallback(() => {
    setFuture((items) => {
      if (!items.length) return items;
      const snapshot = items[items.length - 1];
      const current = projectRef.current;
      setHistory((undoItems) => [...undoItems, { project: current, label: snapshot.label, timestamp: Date.now() }]);
      projectRef.current = snapshot.project;
      setProject(snapshot.project);
      showToast(`Redo: ${snapshot.label}`);
      return items.slice(0, -1);
    });
  }, [showToast]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const mode = { "1": "spacing", "2": "kerning", "3": "tracking", "4": "proof", "5": "qa" } as const;
      if (event.key in mode) {
        const nextMode = mode[event.key as keyof typeof mode];
        setSettings((current) => ({ ...current, mode: nextMode }));
        if (nextMode !== "proof") {
          setInspectorTab(nextMode);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // Keep QA fresh once the user has run it, and while they are in QA mode.
  useEffect(() => {
    if (loading) return;
    if (settings.mode !== "qa" && !issues.length) return;
    const timer = window.setTimeout(() => {
      setIssues(runQA(projectRef.current, qaParams));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [project, qaParams, settings.mode, loading, issues.length]);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  // Bridge for the Fontra panel plugin. The standalone app is embedded in an
  // iframe by fontra-plugin/start.js; these messages keep the two in sync.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as { type?: string; glyph?: string; text?: string } | undefined;
      if (!data || typeof data !== "object") return;
      if (data.type === "fit:select-glyph" && typeof data.glyph === "string") {
        if (getGlyph(projectRef.current, data.glyph)) {
          setSelectedGlyph(data.glyph);
          showToast(`Selected ${data.glyph} from Fontra`);
        }
      } else if (data.type === "fit:set-text" && typeof data.text === "string") {
        setSettings((current) => ({ ...current, text: data.text! }));
      }
    };
    window.addEventListener("message", handler);
    window.parent?.postMessage({ type: "fit:ready" }, "*");
    return () => window.removeEventListener("message", handler);
  }, [showToast]);

  const onSelectGlyph = useCallback((name: string) => {
    setSelectedGlyph(name);
  }, []);

  const onSelectPair = useCallback((pair: [string, string]) => {
    setSelectedPair(pair);
    setInspectorTab("kerning");
    if (settings.mode !== "kerning") {
      setSettings((current) => ({ ...current, mode: "kerning" }));
    }
  }, [settings.mode]);

  const onSidebearingChange = useCallback((glyphName: string, side: "left" | "right", value: number) => {
    commit(`Set ${side} sidebearing of ${glyphName}`, (draft) => {
      const glyph = getGlyph(draft, glyphName);
      if (glyph) setSidebearing(glyph, side, value);
    });
  }, [commit]);

  const onAdvanceChange = useCallback((glyphName: string, value: number) => {
    commit(`Set advance of ${glyphName}`, (draft) => {
      const glyph = getGlyph(draft, glyphName);
      if (glyph) setAdvanceWidth(glyph, value);
    });
  }, [commit]);

  const onMetricsKeyChange = useCallback((
    glyphName: string,
    side: "left" | "right",
    key: string | undefined
  ) => {
    commit(`Set ${side} metrics key for ${glyphName}`, (draft) => {
      const glyph = getGlyph(draft, glyphName);
      if (!glyph) return;
      const keys = { ...(glyph.metricsKeys ?? {}) };
      if (key) keys[side] = key;
      else delete keys[side];
      if (keys.left || keys.right) glyph.metricsKeys = keys;
      else delete glyph.metricsKeys;
      if (key) {
        const targetValue = resolvedMetricsSide(draft, key, side);
        if (targetValue !== undefined && key !== glyph.name) {
          setSidebearing(glyph, side, targetValue);
        }
      }
    });
  }, [commit]);

  const onApplyMetricsKeys = useCallback(() => {
    let changed = 0;
    commit("Apply metrics keys", (draft) => {
      changed = applyMetricsKeys(draft);
    });
    showToast(
      changed
        ? `Applied metrics keys to ${changed} sidebearing${changed === 1 ? "" : "s"}`
        : "No metrics-key changes needed"
    );
  }, [commit, showToast]);

  const onKerningChange = useCallback((left: string, right: string, value: number) => {
    commit(`Kern ${left}/${right}`, (draft) => setKerning(draft, left, right, value));
    setKerningSuggestions((items) => items.filter((item) => !(item.left === left && item.right === right)));
  }, [commit]);

  const onRunSpacing = useCallback(() => {
    const suggestions = makeSpacingSuggestions(projectRef.current, spacingParams);
    setSpacingSuggestionList(suggestions);
    showToast(suggestions.length ? `${suggestions.length} spacing suggestions` : "No spacing changes suggested");
  }, [spacingParams, showToast]);

  const applySpacing = useCallback((suggestions: SpacingSuggestion[]) => {
    if (!suggestions.length) return;
    setGhostProject(cloneProject(projectRef.current));
    commit(`Apply ${suggestions.length} spacing suggestions`, (draft) => {
      applySpacingSuggestions(draft, suggestions);
    });
    setSpacingSuggestionList((items) => items.filter((item) => !suggestions.some((applied) => applied.id === item.id)));
    showToast(`Applied spacing to ${suggestions.length} glyphs`);
  }, [commit, showToast]);

  const applySpacingOne = useCallback((suggestion: SpacingSuggestion) => {
    applySpacing([suggestion]);
  }, [applySpacing]);

  const onAutoGroups = useCallback(() => {
    commit("Auto groups", (draft) => {
      autoAssignGroups(draft, false);
    });
    showToast("Auto groups assigned");
  }, [commit, showToast]);

  const onRunKerning = useCallback(() => {
    const pairs = pairList.length ? pairList : defaultPairList(projectRef.current);
    if (!pairList.length) setPairList(pairs);
    const baseGap = defaultTargetGap(projectRef.current, spacingParams);
    const suggestions = makeKerningSuggestions(
      projectRef.current,
      pairs,
      autoKernParams,
      baseGap,
      spacingParams.opticalCompensation
    );
    setKerningSuggestions(suggestions);
    showToast(suggestions.length ? `${suggestions.length} kerning suggestions` : "No kerning changes suggested");
  }, [pairList, autoKernParams, spacingParams, showToast]);

  const applyKerning = useCallback((suggestions: KerningSuggestion[]) => {
    if (!suggestions.length) return;
    setGhostProject(cloneProject(projectRef.current));
    commit(`Apply ${suggestions.length} kerning suggestions`, (draft) => {
      applyKerningSuggestions(draft, suggestions);
    });
    setKerningSuggestions((items) => items.filter((item) => !suggestions.some((applied) => applied.id === item.id)));
    showToast(`Applied kerning to ${suggestions.length} pairs`);
  }, [commit, showToast]);

  const applyKerningOne = useCallback((suggestion: KerningSuggestion) => {
    applyKerning([suggestion]);
  }, [applyKerning]);

  const onRunQA = useCallback(() => {
    const result = runQA(projectRef.current, qaParams);
    setIssues(result);
    showToast(`${result.length} QA issues`);
  }, [qaParams, showToast]);

  const onSetMode = useCallback((mode: AppSettings["mode"]) => {
    setSettings((current) => ({ ...current, mode }));
    if (mode !== "proof") {
      setInspectorTab(mode);
    }
    if (mode === "qa") {
      window.setTimeout(() => onRunQA(), 0);
    }
  }, [onRunQA]);

  const onInspectorTabChange = useCallback((tab: InspectorTab) => {
    setInspectorTab(tab);
    if (tab !== "assistant") {
      setSettings((current) => ({ ...current, mode: tab }));
    }
    if (tab === "qa") {
      window.setTimeout(() => onRunQA(), 0);
    }
  }, [onRunQA]);

  const onKerningTransform = useCallback((kind: "round" | "prune" | "small" | "scale") => {
    commit(`Kerning transform: ${kind}`, (draft) => {
      if (kind === "round") roundKerning(draft, 5);
      else if (kind === "prune") pruneRedundantExceptions(draft);
      else if (kind === "small") removeSmallPairs(draft, 3);
      else scaleKerning(draft, 0.9);
    });
    showToast(`Kerning ${kind} complete`);
  }, [commit, showToast]);

  const onResetKerning = useCallback(() => {
    const source = activeSource(projectRef.current);
    const count = Object.keys(source.kerning).length;
    if (!count) {
      showToast("No kerning pairs to reset");
      return;
    }
    const confirmed = window.confirm(
      `Remove all ${count} kerning pairs from '${source.name}'? This can be undone with Ctrl+Z.`
    );
    if (!confirmed) return;
    setGhostProject(cloneProject(projectRef.current));
    commit(`Reset all kerning (${count} pairs)`, (draft) => {
      activeSource(draft).kerning = {};
    });
    setKerningSuggestions([]);
    showToast(`Reset ${count} kerning pairs`);
  }, [commit, showToast]);

  const onTrackingChange = useCallback((next: FontProject) => {
    const previous = projectRef.current;
    setHistory((items) => [...items.slice(-59), { project: previous, label: "Tracking change", timestamp: Date.now() }]);
    setFuture([]);
    projectRef.current = next;
    setProject(next);
  }, []);

  const onGroupAssign = useCallback((glyphName: string, side: "left" | "right", group: string | undefined) => {
    commit(`Assign ${glyphName} to ${side} group`, (draft) => {
      ensureGroups(draft);
      assignGlyphToGroup(draft, side, glyphName, group);
    });
  }, [commit]);

  const onGroupCreate = useCallback((side: "left" | "right", name: string) => {
    commit(`Create ${side} group @${name}`, (draft) => {
      ensureGroups(draft);
      if (!draft.groups[side][name]) draft.groups[side][name] = [];
    });
  }, [commit]);

  const onGroupDelete = useCallback((side: "left" | "right", name: string) => {
    commit(`Delete ${side} group @${name}`, (draft) => {
      deleteGroup(draft, side, name);
    });
  }, [commit]);

  const onImportProject = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      loadProject(parseProjectJson(text), `Imported ${file.name}`);
    } catch (error) {
      showToast(`Could not import: ${String(error)}`);
    }
  }, [loadProject, showToast]);

  const onImportFontra = useCallback(async (files: FileList) => {
    try {
      const result = await readFontraDirectory(files);
      loadProject(result.project, `Imported Fontra project (${result.project.sources[0].glyphs.length} glyphs)`);
      if (result.warnings.length) console.warn(result.warnings);
    } catch (error) {
      showToast(`Could not import Fontra project: ${String(error)}`);
    }
  }, [loadProject, showToast]);

  const onImportUfo = useCallback(async (files: FileList) => {
    try {
      const result = await readUfoDirectory(files);
      loadProject(result.project, `Imported UFO (${result.project.sources[0].glyphs.length} glyphs)`);
      if (result.warnings.length) console.warn(result.warnings);
    } catch (error) {
      showToast(`Could not import UFO: ${String(error)}`);
    }
  }, [loadProject, showToast]);

  const onImportDesignspace = useCallback(async (files: FileList) => {
    try {
      const result = await readDesignspaceDirectory(files);
      loadProject(
        result.project,
        `Imported designspace (${result.project.sources.length} sources)`
      );
      if (result.warnings.length) console.warn(result.warnings);
    } catch (error) {
      showToast(`Could not import designspace: ${String(error)}`);
    }
  }, [loadProject, showToast]);

  const onSourceChange = useCallback((index: number) => {
    const previous = projectRef.current;
    if (index === previous.activeSource || !previous.sources[index]) return;
    const next = cloneProject(previous);
    next.activeSource = index;
    projectRef.current = next;
    setProject(next);
    const glyphs = next.sources[index].glyphs;
    setSelectedGlyph((current) =>
      glyphs.some((glyph) => glyph.name === current) ? current : glyphs[0]?.name ?? ""
    );
    setSelectedPair((current) => {
      const names = new Set(glyphs.map((glyph) => glyph.name));
      return names.has(current[0]) && names.has(current[1])
        ? current
        : [glyphs[0]?.name ?? "", glyphs[1]?.name ?? glyphs[0]?.name ?? ""];
    });
    setSpacingSuggestionList([]);
    setKerningSuggestions([]);
    setPairList(defaultPairList(next));
    showToast(`Source: ${next.sources[index].name}`);
  }, [showToast]);

  const onImportFont = useCallback(async (file: File) => {
    try {
      const result = await importOpentypeFile(file);
      loadProject(result.project, `Imported ${file.name}`);
    } catch (error) {
      showToast(`Could not import font: ${String(error)}`);
    }
  }, [loadProject, showToast]);

  const onImportZip = useCallback(async (file: File) => {
    const buffer = await file.arrayBuffer();
    try {
      const result = await readFontraZip(buffer);
      if (result.project.sources[0].glyphs.length) {
        loadProject(result.project, `Imported ${file.name}`);
        return;
      }
    } catch {
      // not a Fontra zip
    }
    try {
      const result = await readUfoZip(buffer);
      loadProject(result.project, `Imported ${file.name}`);
    } catch (error) {
      showToast(`Could not import zip: ${String(error)}`);
    }
  }, [loadProject, showToast]);

  const onLoadReference = useCallback(async (file: File) => {
    try {
      const result = await importOpentypeFile(file);
      setReferenceProject(result.project);
      setSettings((current) => ({ ...current, referenceFontName: result.project.name, compareGhost: true }));
      showToast(`Reference: ${result.project.name}`);
    } catch (error) {
      showToast(`Could not load reference: ${String(error)}`);
    }
  }, [showToast]);

  const onLoadDemo = useCallback(async () => {
    try {
      const result = await loadBundledFontraDemo("/demo-fontra");
      loadProject(result.project, "Loaded Fontulja sample");
    } catch {
      try {
        const result = await loadDemoOpentype("/demo.ttf");
        loadProject(result.project, "Loaded demo font");
      } catch (error) {
        showToast(`Demo unavailable: ${String(error)}`);
      }
    }
  }, [loadProject, showToast]);

  const onExport = useCallback((kind: ExportKind) => {
    const current = projectRef.current;
    try {
      switch (kind) {
        case "json":
          exportProjectJson(current);
          break;
        case "ufo":
          exportUfo(current);
          break;
        case "designspace":
          exportDesignspace(current);
          break;
        case "otf":
          exportOtfont(current);
          break;
        case "fontra":
          exportFontra(current);
          break;
        case "features":
          exportFeatures(current);
          break;
        case "css":
          exportTrackingCss(current);
          break;
        case "tracking-json":
          exportTrackingJson(current);
          break;
        case "tracking-csv":
          exportTrackingCsv(current);
          break;
        case "qa-csv": {
          const result = issues.length ? issues : runQA(current, qaParams);
          setIssues(result);
          exportQACsv(result);
          break;
        }
        case "qa-html": {
          const result = issues.length ? issues : runQA(current, qaParams);
          setIssues(result);
          exportQAHtml(current, result);
          break;
        }
      }
      showToast(`Exported ${kind}`);
    } catch (error) {
      showToast(`Export failed: ${String(error)}`);
    }
  }, [issues, qaParams, showToast]);

  const onQAParamsChange = useCallback((params: QAParams) => {
    setQaParams(params);
    setIssues(runQA(projectRef.current, params));
  }, []);

  const onSolver = useCallback(() => {
    const pairs = pairList.length ? pairList : defaultPairList(projectRef.current);
    const baseGap = defaultTargetGap(projectRef.current, spacingParams);
    setGhostProject(cloneProject(projectRef.current));
    let result: import("./core/solver").SolverResult | undefined;
    commit("Solve spacing + kerning", (draft) => {
      result = solveSpacingAndKerning(draft, pairs, {
        baseGap,
        opticalCompensation: spacingParams.opticalCompensation,
        maxSidebearingAdjust: 20,
      });
    });
    showToast(result ? `Solver: ${result.kerningPairs} kerns, ${result.sidebearingsChanged} glyphs adjusted` : "Solver complete");
  }, [pairList, spacingParams, commit, showToast]);

  const health = useMemo(() => spacingHealth(project), [project]);
  const outliers = useMemo(() => spacingOutliers(project), [project]);
  const qa = useMemo(() => qaSummary(issues), [issues]);
  const selectedGlyphData = getGlyph(project, selectedGlyph);
  const selectedSidebearings = selectedGlyphData ? sidebearingsOf(selectedGlyphData) : undefined;
  const trackingValue = currentTrackingPerMille(project);
  const source = activeSource(project);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-mark">F</div>
        <div>
          <strong>Preparing the spacing lab…</strong>
          <span>Loading sample metrics and outlines</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app" data-theme={settings.theme}>
      <TopBar
        project={project}
        canUndo={history.length > 0}
        canRedo={future.length > 0}
        theme={settings.theme}
        onUndo={undo}
        onRedo={redo}
        onToggleTheme={() => updateSettings({ theme: settings.theme === "dark" ? "light" : "dark" })}
        onLoadDemo={onLoadDemo}
        onImportProject={onImportProject}
        onImportFontra={onImportFontra}
        onImportUfo={onImportUfo}
        onImportDesignspace={onImportDesignspace}
        onImportFont={onImportFont}
        onImportZip={onImportZip}
        onLoadReference={onLoadReference}
        onSourceChange={onSourceChange}
        onExport={onExport}
      />

      <div className="workspace">
        <aside className="sidebar sidebar--left">
          <GlyphList project={project} selectedGlyph={selectedGlyph} onSelectGlyph={onSelectGlyph} />
          <div className="sidebar-footer">
            <div className="mini-stat"><span>Glyphs</span><strong>{source.glyphs.length}</strong></div>
            <div className="mini-stat"><span>Pairs</span><strong>{Object.keys(source.kerning).length}</strong></div>
            <div className="mini-stat"><span>Groups</span><strong>{Object.keys(project.groups.left).length + Object.keys(project.groups.right).length}</strong></div>
            <div className="mini-stat"><span>Health</span><strong>{qa.score}</strong></div>
          </div>
        </aside>

        <main className="stage">
          <div className="stage-header">
            <div className="stage-title">
              <span className="eyebrow">{settings.mode === "proof" ? "Proofing" : settings.mode}</span>
              <strong>
                {settings.mode === "kerning"
                  ? `${selectedPair[0]}${selectedPair[1]} · ${resolvePairValue(project, selectedPair)}`
                  : selectedGlyphData
                    ? `${selectedGlyphData.name} · ${selectedSidebearings?.advance ?? 0} units`
                    : project.name}
              </strong>
            </div>
            <div className="stage-stats">
              <span className="stage-stat"><span>Tracking</span><strong>{trackingValue > 0 ? "+" : ""}{trackingValue}</strong></span>
              <span className="stage-stat"><span>Outliers</span><strong className={outliers.length ? "warning-text" : ""}>{outliers.length}</strong></span>
              <span className="stage-stat"><span>Health</span><strong>{health.score}</strong></span>
              {referenceProject && <span className="stage-stat stage-stat--ref"><span>Reference</span><strong>{referenceProject.name}</strong></span>}
            </div>
          </div>

          <CanvasView
            project={project}
            ghostProject={settings.compareGhost ? ghostProject : undefined}
            referenceProject={referenceProject}
            text={settings.text}
            mode={settings.mode}
            selectedGlyph={selectedGlyph}
            selectedPair={selectedPair}
            settings={settings}
            measurementLine={measurementLine}
            onSelectGlyph={onSelectGlyph}
            onSelectPair={onSelectPair}
            onSidebearingChange={onSidebearingChange}
            onKerningChange={onKerningChange}
          />

          <ProofBar
            settings={settings}
            text={settings.text}
            measurementLine={measurementLine}
            onSettingsChange={updateSettings}
            onTextChange={(text) => updateSettings({ text })}
            onMeasurementLineChange={setMeasurementLine}
            onSetMode={onSetMode}
          />
        </main>

        <Inspector
          tab={inspectorTab}
          onTabChange={onInspectorTabChange}
          project={project}
          selectedGlyph={selectedGlyph}
          selectedPair={selectedPair}
          spacingParams={spacingParams}
          spacingSuggestions={spacingSuggestionList}
          autoKernParams={autoKernParams}
          kerningSuggestions={kerningSuggestions}
          pairList={pairList}
          issues={issues}
          qaParams={qaParams}
          onSelectGlyph={onSelectGlyph}
          onSelectPair={onSelectPair}
          onSpacingParamsChange={setSpacingParams}
          onKeyGlyphsChange={(keyGlyphs) => commit("Update key glyphs", (draft) => { draft.keyGlyphs = keyGlyphs; })}
          onRunSpacing={onRunSpacing}
          onApplySpacing={applySpacing}
          onApplySpacingOne={applySpacingOne}
          onAutoGroups={onAutoGroups}
          onSidebearingChange={onSidebearingChange}
          onAdvanceChange={onAdvanceChange}
          onMetricsKeyChange={onMetricsKeyChange}
          onApplyMetricsKeys={onApplyMetricsKeys}
          onFindOutliers={() => onSetMode("qa")}
          onAutoKernParamsChange={setAutoKernParams}
          onRunKerning={onRunKerning}
          onApplyKerning={applyKerning}
          onApplyKerningOne={applyKerningOne}
          onPairListChange={setPairList}
          onKerningChange={onKerningChange}
          onGroupAssign={onGroupAssign}
          onGroupCreate={onGroupCreate}
          onGroupDelete={onGroupDelete}
          onKerningTransform={onKerningTransform}
          onResetKerning={onResetKerning}
          onTrackingChange={onTrackingChange}
          onExportTracking={(kind) => onExport(kind)}
          onRunQA={onRunQA}
          onQAParamsChange={onQAParamsChange}
          onExportQA={(kind) => onExport(kind)}
          onSetMode={onSetMode}
        />
      </div>

      <div className="statusbar">
        <span>{project.name} · {source.name}</span>
        <span>{source.glyphs.length} glyphs · {Object.keys(source.kerning).length} kern pairs · {project.unitsPerEm} UPM</span>
        <span className="statusbar-spacer" />
        <button className="inline-link" onClick={onSolver} title="Run the joint spacing + kerning solver">
          Solve spacing + kerning
        </button>
        <span>{history.length ? `${history.length} undo steps` : "Ready"}</span>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function resolvePairValue(project: FontProject, pair: [string, string]): number {
  return resolveKerning(project, pair[0], pair[1]);
}
