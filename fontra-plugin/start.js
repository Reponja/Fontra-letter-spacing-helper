import { recordChanges } from "./change-recorder.js";
import * as fit from "./fit-core.js";

// The Fontra panel is a live, zero-server integration: it reads the current
// Fontra font through the editor APIs, runs the same Fit engines as the
// standalone lab, and writes spacing/kerning changes back to Fontra's backend.

function el(tag, attrs = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === "class") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key === "html") element.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      element.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined) continue;
    element.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return element;
}

function button(label, onClick, className = "") {
  return el("button", { class: `fit-btn ${className}`.trim(), onclick: onClick }, [label]);
}

function numberInput(value, onChange, step = 1) {
  const input = el("input", {
    class: "fit-input",
    type: "number",
    step: String(step),
    value: String(Number.isFinite(value) ? Math.round(value * 100) / 100 : 0),
  });
  input.addEventListener("change", () => onChange(Number(input.value)));
  return input;
}

function contourToCommands(contour) {
  const points = contour.points ?? [];
  if (points.length < 2) return [];
  const isOff = (point) => point.type === "cubic" || point.type === "quadratic";
  const firstOn = points.findIndex((point) => !isOff(point));
  if (firstOn === -1) return [];
  const start = points[firstOn];
  const commands = [{ type: "M", x: start.x, y: start.y }];
  let currentX = start.x;
  let currentY = start.y;
  let index = firstOn;
  let guard = 0;
  while (guard++ < points.length + 2) {
    const nextIndex = (index + 1) % points.length;
    if (nextIndex === firstOn) break;
    const next = points[nextIndex];
    if (!isOff(next)) {
      if (next.x !== currentX || next.y !== currentY) {
        commands.push({ type: "L", x: next.x, y: next.y });
        currentX = next.x;
        currentY = next.y;
      }
      index = nextIndex;
      continue;
    }
    const offCurves = [];
    let scan = nextIndex;
    while (isOff(points[scan])) {
      offCurves.push(points[scan]);
      scan = (scan + 1) % points.length;
      if (scan === firstOn) break;
    }
    const onCurve = points[scan];
    if (!onCurve || isOff(onCurve)) break;
    if (offCurves.length >= 2) {
      commands.push({
        type: "C",
        x1: offCurves[0].x,
        y1: offCurves[0].y,
        x2: offCurves[1].x,
        y2: offCurves[1].y,
        x: onCurve.x,
        y: onCurve.y,
      });
    } else if (offCurves.length === 1) {
      commands.push({
        type: "Q",
        x1: offCurves[0].x,
        y1: offCurves[0].y,
        x: onCurve.x,
        y: onCurve.y,
      });
    } else if (onCurve.x !== currentX || onCurve.y !== currentY) {
      commands.push({ type: "L", x: onCurve.x, y: onCurve.y });
    }
    currentX = onCurve.x;
    currentY = onCurve.y;
    index = scan;
    if (index === firstOn) break;
  }
  if (contour.isClosed) commands.push({ type: "Z" });
  return commands;
}

export default class FitPanel extends HTMLElement {
  identifier = "fit-letter-spacing-panel";

  static styles = `
    .fit-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--ui-element-background-color, #f7f4ee);
      color: var(--ui-element-foreground-color, #24211d);
      font-family: var(--fontra-ui-regular, ui-sans-serif, system-ui, sans-serif);
      font-size: 13px;
    }
    .fit-header {
      padding: 12px 14px 8px;
      border-bottom: 1px solid var(--ui-list-border-color, #d8d1c5);
    }
    .fit-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .fit-title { font-weight: 700; font-size: 15px; letter-spacing: -0.02em; }
    .fit-live {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 6px; border-radius: 99px; font-size: 9px; font-weight: 700;
      letter-spacing: .08em; text-transform: uppercase;
      background: #d9f3e7; color: #0f6b4d;
    }
    .fit-live::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: #0f8a5f; }
    .fit-sub { margin-top: 3px; color: var(--ui-element-secondary-foreground-color, #80786b); font-size: 10px; line-height: 1.4; }
    .fit-toolbar { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
    .fit-tabs {
      display: flex; gap: 2px; padding: 6px 8px 0;
      border-bottom: 1px solid var(--ui-list-border-color, #d8d1c5);
    }
    .fit-tab {
      border: 0; background: transparent; color: var(--ui-element-secondary-foreground-color, #80786b);
      padding: 6px 9px 7px; border-radius: 6px 6px 0 0; cursor: pointer;
      font: inherit; font-size: 11px; font-weight: 650;
    }
    .fit-tab:hover { color: var(--ui-element-foreground-color, #24211d); }
    .fit-tab.is-active {
      color: var(--ui-element-foreground-color, #24211d);
      background: var(--ui-element-background-color, #f7f4ee);
      box-shadow: inset 0 -2px 0 #0b6bcb;
    }
    .fit-body { flex: 1; overflow: auto; padding: 10px 10px 20px; min-height: 0; }
    .fit-card {
      border: 1px solid var(--ui-list-border-color, #d8d1c5);
      border-radius: 9px; padding: 9px; margin-bottom: 8px;
      background: var(--ui-list-background-color, #fffdf9);
    }
    .fit-card-title { font-size: 10px; font-weight: 750; text-transform: uppercase; letter-spacing: .08em; color: var(--ui-element-secondary-foreground-color, #80786b); margin-bottom: 6px; }
    .fit-row { display: flex; align-items: center; gap: 6px; }
    .fit-between { justify-content: space-between; }
    .fit-grid { display: grid; gap: 6px; }
    .fit-grid-2 { grid-template-columns: 1fr 1fr; }
    .fit-grid-3 { grid-template-columns: 1fr 1fr 1fr; }
    .fit-field { display: flex; flex-direction: column; gap: 3px; font-size: 9px; color: var(--ui-element-secondary-foreground-color, #80786b); font-weight: 600; }
    .fit-input, .fit-select {
      width: 100%; min-width: 0; border: 1px solid var(--ui-list-border-color, #d8d1c5);
      border-radius: 5px; padding: 5px 6px; font: inherit; font-size: 11px;
      background: var(--text-input-background-color, #fff);
      color: var(--text-input-foreground-color, #24211d);
      box-sizing: border-box;
    }
    .fit-input:disabled, .fit-select:disabled { opacity: .55; }
    .fit-btn {
      border: 1px solid var(--ui-list-border-color, #d8d1c5);
      background: transparent; color: inherit; border-radius: 5px;
      padding: 5px 8px; font: inherit; font-size: 10px; font-weight: 650; cursor: pointer;
      white-space: nowrap;
    }
    .fit-btn:hover { background: var(--ui-list-header-background-color, #8882); }
    .fit-btn:disabled { opacity: .4; cursor: default; }
    .fit-btn--primary { background: #1f1d1a; border-color: #1f1d1a; color: #fbfaf7; }
    .fit-btn--primary:hover { background: #3a3630; }
    .fit-btn--small { padding: 3px 6px; font-size: 9px; }
    .fit-btn--ghost { border-color: transparent; }
    .fit-seg { display: flex; background: var(--ui-list-header-background-color, #8882); border-radius: 6px; padding: 2px; gap: 2px; }
    .fit-seg button { flex: 1; border: 0; background: transparent; color: inherit; border-radius: 4px; padding: 4px 3px; font: inherit; font-size: 9px; font-weight: 650; cursor: pointer; }
    .fit-seg button.is-active { background: var(--ui-element-background-color, #fff); box-shadow: 0 1px 2px #0002; }
    .fit-metrics { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; }
    .fit-metric-value { font-family: var(--fontra-ui-monospace, ui-monospace, monospace); font-size: 11px; }
    .fit-muted { color: var(--ui-element-secondary-foreground-color, #80786b); font-size: 10px; line-height: 1.4; }
    .fit-empty { padding: 16px 8px; text-align: center; color: var(--ui-element-secondary-foreground-color, #80786b); font-size: 10px; border: 1px dashed var(--ui-list-border-color, #d8d1c5); border-radius: 7px; }
    .fit-suggestion {
      display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 5px; align-items: center;
      padding: 5px 6px; border: 1px solid var(--ui-list-border-color, #d8d1c5);
      border-radius: 6px; margin-bottom: 3px; background: var(--ui-element-background-color, #fff);
      font-size: 10px;
    }
    .fit-suggestion-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fit-suggestion-values { font-family: var(--fontra-ui-monospace, ui-monospace, monospace); font-size: 9px; color: var(--ui-element-secondary-foreground-color, #80786b); white-space: nowrap; }
    .fit-suggestion-values strong { color: #0f8a5f; font-weight: 700; }
    .fit-confidence { font-family: var(--fontra-ui-monospace, monospace); font-size: 8px; color: var(--ui-element-secondary-foreground-color, #80786b); }
    .fit-score { font-family: var(--fontra-ui-monospace, monospace); font-size: 28px; font-weight: 750; line-height: 1; }
    .fit-score--good { color: #0f8a5f; }
    .fit-score--mid { color: #b36b00; }
    .fit-score--low { color: #b42318; }
    .fit-issue { display: flex; gap: 6px; padding: 5px 4px; border-bottom: 1px solid var(--ui-list-border-color, #d8d1c5); cursor: pointer; }
    .fit-issue:last-child { border-bottom: 0; }
    .fit-issue:hover { background: var(--ui-list-header-background-color, #8882); }
    .fit-dot { width: 6px; height: 6px; border-radius: 50%; margin-top: 4px; flex: none; }
    .fit-dot--error { background: #b42318; }
    .fit-dot--warning { background: #c25a00; }
    .fit-dot--info { background: #0b6bcb; }
    .fit-issue-title { font-size: 10px; font-weight: 650; }
    .fit-issue-detail { font-size: 9px; color: var(--ui-element-secondary-foreground-color, #80786b); line-height: 1.35; }
    .fit-code { margin: 0; padding: 7px; border-radius: 6px; background: var(--ui-list-header-background-color, #8882); font-family: var(--fontra-ui-monospace, monospace); font-size: 9px; line-height: 1.5; white-space: pre-wrap; overflow: auto; max-height: 160px; }
    .fit-footer { border-top: 1px solid var(--ui-list-border-color, #d8d1c5); padding: 8px 10px; display: flex; justify-content: space-between; gap: 6px; align-items: center; }
    .fit-status { min-height: 15px; color: var(--ui-element-secondary-foreground-color, #80786b); font-size: 9px; }
    .fit-status.is-error { color: #b42318; }
    .fit-badge { font-size: 8px; padding: 2px 5px; border-radius: 99px; background: var(--ui-list-header-background-color, #8882); color: var(--ui-element-secondary-foreground-color, #80786b); }
    .fit-spin { display: inline-block; width: 10px; height: 10px; border: 2px solid #8884; border-top-color: #0b6bcb; border-radius: 50%; animation: fit-spin .7s linear infinite; }
    @keyframes fit-spin { to { transform: rotate(360deg); } }
    .fit-hint { padding: 7px 8px; border-radius: 6px; background: #e8f0fb; color: #25507d; font-size: 9px; line-height: 1.4; }
  `;

  constructor(editorController) {
    super();
    this.editorController = editorController;
    this.sceneController = editorController.sceneController;
    this.fontController = editorController.fontController;
    this.selectedGlyphName = null;
    this.snapshot = null;
    this.lastEdit = null;
    this.refreshTimer = null;
    this.loading = true;
    this.spacingSuggestions = [];
    this.kerningSuggestions = [];
    this.qaIssues = [];
    this.trackingPerMille = 0;
    this.pairLeft = "n";
    this.pairRight = "o";
    this.method = "hybrid";
    this.targetGap = 0;
    this.keyLower = "n";
    this.keyUpper = "H";

    this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = FitPanel.styles;
    this.shadowRoot.appendChild(style);
    this.contentElement = this.getContentElement();
    this.shadowRoot.appendChild(this.contentElement);

    this.sceneController.sceneSettingsController.addKeyListener(
      ["selectedGlyphName", "fontLocationSourceMapped", "editLayerName"],
      () => {
        this.selectedGlyphName = this.sceneController.sceneSettings.selectedGlyphName;
        this.scheduleRefresh();
      }
    );

    this.fontController.addChangeListener({}, () => this.scheduleRefresh(), true);

    this.loadSnapshot();
  }

  toggle(on, focus) {
    if (on) {
      this.updateSelectedGlyph().then(() => this.render());
    }
  }

  getContentElement() {
    this.tab = "spacing";
    this.statusElement = el("div", { class: "fit-status", text: "Starting…" });
    this.sourceElement = el("div", { class: "fit-sub", text: "Reading the live Fontra font" });
    this.bodyElement = el("div", { class: "fit-body" });
    this.undoButton = button("Undo", () => this.undoLast(), "fit-btn--small");
    this.undoButton.disabled = true;

    this.tabButtons = new Map();
    const tabs = el("div", { class: "fit-tabs" });
    for (const [id, label] of [
      ["spacing", "Spacing"],
      ["kerning", "Kerning"],
      ["tracking", "Tracking"],
      ["qa", "QA"],
    ]) {
      const tab = el("button", { class: "fit-tab", text: label, onclick: () => this.setTab(id) });
      this.tabButtons.set(id, tab);
      tabs.appendChild(tab);
    }

    const header = el("div", { class: "fit-header" }, [
      el("div", { class: "fit-title-row" }, [
        el("div", { class: "fit-title", text: "Fit" }),
        el("span", { class: "fit-live", text: "Live Fontra" }),
      ]),
      this.sourceElement,
      el("div", { class: "fit-toolbar" }, [
        button("Refresh", () => this.loadSnapshot(), "fit-btn--small"),
        this.undoButton,
      ]),
    ]);

    return el("div", { class: "fit-panel" }, [
      header,
      tabs,
      this.bodyElement,
      el("div", { class: "fit-footer" }, [
        this.statusElement,
        el("span", { class: "fit-badge", text: "no server" }),
      ]),
    ]);
  }

  setTab(tab) {
    this.tab = tab;
    for (const [id, element] of this.tabButtons) {
      element.classList.toggle("is-active", id === tab);
    }
    this.render();
  }

  setStatus(text, isError = false) {
    if (!this.statusElement) return;
    this.statusElement.textContent = text;
    this.statusElement.classList.toggle("is-error", isError);
  }

  scheduleRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.loadSnapshot(), 380);
  }

  async loadSnapshot() {
    if (this.loading && this.snapshot) return;
    this.loading = true;
    this.setStatus("Reading Fontra…");
    try {
      await this.fontController.ensureInitialized;
      const fontController = this.fontController;
      const settings = this.sceneController.sceneSettings;
      const location = { ...(settings.fontLocationSourceMapped || {}) };
      const editLayerName = settings.editLayerName || undefined;
      const sourceIdentifier = fontController.fontSourcesInstancer.getSourceIdentifierForLocation(
        location,
        false
      );
      const source = sourceIdentifier ? fontController.sources[sourceIdentifier] : undefined;
      const names = Object.keys(fontController.glyphMap || {});
      const project = fit.createEmptyProject("Fontra project");
      project.unitsPerEm = fontController.unitsPerEm || 1000;
      project.sources[0].name = source?.name || "instance";
      project.sources[0].glyphs = [];
      const glyphMap = {};

      let done = 0;
      for (const name of names) {
        const instance = await fontController.getGlyphInstance(name, location, editLayerName);
        if (!instance) continue;
        const contours = [];
        for (const contour of instance.flattenedPath.unpackedContours()) {
          const commands = contourToCommands(contour);
          if (commands.length > 1) contours.push({ commands, closed: !!contour.isClosed });
        }
        const unicode = fontController.glyphMap[name]?.[0];
        const glyph = {
          name,
          unicode,
          advanceWidth: instance.xAdvance || 0,
          contours,
          category: fit.categoryFromGlyph(name, unicode),
        };
        project.sources[0].glyphs.push(glyph);
        glyphMap[name] = glyph;
        done += 1;
        if (done % 48 === 0) this.setStatus(`Reading Fontra… ${done}/${names.length}`);
      }

      let fontInfo = {};
      try {
        fontInfo = await fontController.getFontInfo();
      } catch {
        fontInfo = {};
      }
      const layout = fontInfo?.lineMetricsHorizontalLayout || {};
      project.ascender =
        layout.ascender?.value ||
        fontInfo.openTypeHheaAscender ||
        Math.round(project.unitsPerEm * 0.8);
      project.descender =
        layout.descender?.value ||
        fontInfo.openTypeHheaDescender ||
        -Math.round(project.unitsPerEm * 0.2);
      const oGlyph = glyphMap["o"];
      const hGlyph = glyphMap["H"] || glyphMap["O"];
      project.xHeight =
        (oGlyph && fit.glyphBounds(oGlyph)?.maxY) ||
        fontInfo.openTypeOS2XHeight ||
        Math.round(project.unitsPerEm * 0.5);
      project.capHeight =
        (hGlyph && fit.glyphBounds(hGlyph)?.maxY) ||
        fontInfo.openTypeOS2CapHeight ||
        Math.round(project.unitsPerEm * 0.7);

      const kerning = (await fontController.getKerning())?.kern;
      if (kerning) {
        project.groups.left = Object.fromEntries(
          Object.entries(kerning.groupsSide1 || {}).map(([name, glyphs]) => [name, [...glyphs]])
        );
        project.groups.right = Object.fromEntries(
          Object.entries(kerning.groupsSide2 || {}).map(([name, glyphs]) => [name, [...glyphs]])
        );
        const sourceIndex = sourceIdentifier
          ? kerning.sourceIdentifiers?.indexOf(sourceIdentifier)
          : -1;
        for (const [left, rights] of Object.entries(kerning.values || {})) {
          for (const [right, values] of Object.entries(rights)) {
            const value = Array.isArray(values) ? values[sourceIndex] : values;
            if (typeof value === "number" && value) {
              project.sources[0].kerning[fit.kerningKey(left, right)] = value;
            }
          }
        }
      }

      const known = new Set(names);
      project.keyGlyphs = {
        lowerStem: known.has("n") ? "n" : known.has("o") ? "o" : names[0] || "n",
        lowerRound: known.has("o") ? "o" : known.has("n") ? "n" : names[0] || "o",
        upperStem: known.has("H") ? "H" : known.has("n") ? "n" : names[0] || "H",
        upperRound: known.has("O") ? "O" : known.has("o") ? "o" : names[0] || "O",
      };
      this.keyLower = project.keyGlyphs.lowerStem;
      this.keyUpper = project.keyGlyphs.upperStem;
      project.tracking.activePreset = "custom";
      project.tracking.customPerMille = this.trackingPerMille;

      this.snapshot = {
        project: fit.normalizeProject(project),
        sourceIdentifier,
        sourceName: project.sources[0].name,
        location,
        layerName: editLayerName,
        glyphNames: names,
      };
      this.selectedGlyphName = this.selectedGlyphName || this.sceneController.sceneSettings.selectedGlyphName;
      this.spacingSuggestions = [];
      this.kerningSuggestions = [];
      this.qaIssues = [];
      await this.updateSelectedGlyph();
      this.sourceElement.textContent = `${project.sources[0].name} · ${project.sources[0].glyphs.length} glyphs · ${project.unitsPerEm} UPM`;
      this.setStatus(sourceIdentifier ? "Connected · changes write to Fontra" : "Interpolated instance · read-only edits");
      this.loading = false;
      this.render();
    } catch (error) {
      this.loading = false;
      console.error("Fit: could not read Fontra font", error);
      this.setStatus(`Could not read font: ${error}`, true);
      this.render();
    }
  }

  async updateSelectedGlyph() {
    const name = this.selectedGlyphName || this.sceneController.sceneSettings.selectedGlyphName;
    if (!name || !this.snapshot) {
      this.liveSelected = null;
      return;
    }
    try {
      const instance = await this.fontController.getGlyphInstance(
        name,
        this.snapshot.location,
        this.snapshot.layerName
      );
      if (!instance) {
        this.liveSelected = null;
        return;
      }
      const bounds = instance.flattenedPath?.getBounds();
      this.liveSelected = {
        name,
        left: bounds ? bounds.xMin : instance.leftMargin ?? 0,
        right: bounds ? instance.xAdvance - bounds.xMax : instance.rightMargin ?? 0,
        advance: instance.xAdvance ?? 0,
      };
    } catch {
      this.liveSelected = null;
    }
  }

  render() {
    if (!this.bodyElement) return;
    for (const [id, element] of this.tabButtons) {
      element.classList.toggle("is-active", id === this.tab);
    }
    this.undoButton.disabled = !this.lastEdit;
    this.bodyElement.innerHTML = "";
    if (!this.snapshot) {
      this.bodyElement.appendChild(
        el("div", { class: "fit-empty" }, [
          el("span", { class: "fit-spin" }),
          " Reading the live Fontra font…",
        ])
      );
      return;
    }
    if (this.tab === "spacing") this.renderSpacing();
    else if (this.tab === "kerning") this.renderKerning();
    else if (this.tab === "tracking") this.renderTracking();
    else this.renderQA();
  }

  renderSpacing() {
    const project = this.snapshot.project;
    const names = [...project.sources[0].glyphs]
      .sort((a, b) => (a.unicode ?? 1e9) - (b.unicode ?? 1e9) || a.name.localeCompare(b.name))
      .map((glyph) => glyph.name);

    const selected = this.liveSelected;
    const glyphCard = el("div", { class: "fit-card" }, [
      el("div", { class: "fit-card-title fit-between fit-row" }, [
        el("span", { text: selected ? `Selected · ${selected.name}` : "Selected glyph" }),
        selected ? el("span", { class: "fit-badge", text: "live" }) : null,
      ]),
      selected
        ? el("div", { class: "fit-metrics" }, [
            this.metricField("LSB", selected.left, (value) => this.applySelectedMetric("left", value)),
            this.metricField("RSB", selected.right, (value) => this.applySelectedMetric("right", value)),
            this.metricField("Advance", selected.advance, (value) => this.applySelectedMetric("advance", value)),
          ])
        : el("div", { class: "fit-empty", text: "Select a glyph in Fontra." }),
    ]);

    const method = el("div", { class: "fit-seg" }, [
      ["stem", "Stem", "Rhythm from stem interval"],
      ["optical", "Optical", "Match side profiles"],
      ["hybrid", "Hybrid", "Blend both"],
    ].map(([id, label, hint]) => {
      const btn = el("button", {
        class: this.method === id ? "is-active" : "",
        title: hint,
        text: label,
        onclick: () => {
          this.method = id;
          this.render();
        },
      });
      return btn;
    }));

    const controls = el("div", { class: "fit-card" }, [
      el("div", { class: "fit-card-title", text: "Auto-spacing" }),
      method,
      el("div", { class: "fit-grid fit-grid-2", style: "margin-top:6px" }, [
        this.selectField("Lower stem key", names, this.keyLower, (value) => {
          this.keyLower = value;
          this.snapshot.project.keyGlyphs.lowerStem = value;
        }),
        this.selectField("Upper stem key", names, this.keyUpper, (value) => {
          this.keyUpper = value;
          this.snapshot.project.keyGlyphs.upperStem = value;
        }),
        this.inputField("Target gap", this.targetGap, (value) => (this.targetGap = value), "0 = auto"),
      ]),
      el("div", { class: "fit-row", style: "margin-top:7px" }, [
        button("Analyze font", () => this.analyzeSpacing(), "fit-btn--primary"),
        button(`Apply safe (${this.spacingSuggestions.filter((s) => s.confidence >= 0.82).length})`, () =>
          this.applySpacing(this.spacingSuggestions.filter((s) => s.confidence >= 0.82))
        ),
        button("Apply all", () => this.applySpacing(this.spacingSuggestions)),
      ]),
    ]);

    const suggestionList = el("div", { class: "fit-card" }, [
      el("div", { class: "fit-card-title fit-between fit-row" }, [
        el("span", { text: `Suggestions · ${this.spacingSuggestions.length}` }),
        this.spacingSuggestions.length
          ? el("span", { class: "fit-badge", text: "non-destructive until applied" })
          : null,
      ]),
      ...(this.spacingSuggestions.length
        ? this.spacingSuggestions.slice(0, 60).map((suggestion) =>
            el("div", { class: "fit-suggestion" }, [
              el("div", { class: "fit-suggestion-name", text: suggestion.glyphName, title: suggestion.reason }),
              el("div", { class: "fit-suggestion-values" }, [
                `${Math.round(suggestion.currentLeft)}→`,
                el("strong", { text: String(Math.round(suggestion.proposedLeft)) }),
                " / ",
                `${Math.round(suggestion.currentRight)}→`,
                el("strong", { text: String(Math.round(suggestion.proposedRight)) }),
              ]),
              el("button", {
                class: "fit-btn fit-btn--small fit-btn--ghost",
                text: "Apply",
                onclick: () => this.applySpacing([suggestion]),
              }),
            ])
          )
        : [el("div", { class: "fit-empty", text: "Run “Analyze font” to get a spacing proposal." })]),
    ]);

    this.bodyElement.append(glyphCard, controls, suggestionList);
  }

  metricField(label, value, onChange) {
    return el("label", { class: "fit-field" }, [
      label,
      numberInput(value, onChange),
    ]);
  }

  inputField(label, value, onChange, hint) {
    return el("label", { class: "fit-field" }, [
      label,
      numberInput(value, onChange),
      hint ? el("span", { class: "fit-muted", text: hint }) : null,
    ]);
  }

  selectField(label, values, value, onChange) {
    const select = el("select", { class: "fit-select" });
    for (const item of values) {
      select.appendChild(el("option", { value: item, text: item, selected: item === value ? "" : undefined }));
    }
    select.addEventListener("change", () => onChange(select.value));
    return el("label", { class: "fit-field" }, [label, select]);
  }

  async analyzeSpacing() {
    if (!this.snapshot) return;
    this.setStatus("Measuring side profiles…");
    const project = this.snapshot.project;
    project.keyGlyphs.lowerStem = this.keyLower;
    project.keyGlyphs.upperStem = this.keyUpper;
    const params = {
      ...fit.DEFAULT_SPACING_PARAMS,
      method: this.method,
      targetGap: this.targetGap,
      keyLower: this.keyLower,
      keyUpper: this.keyUpper,
    };
    this.spacingSuggestions = fit.spacingSuggestions(project, params);
    this.setStatus(`${this.spacingSuggestions.length} spacing suggestions`);
    this.render();
  }

  async applySpacing(suggestions) {
    if (!suggestions.length || !this.snapshot) return;
    if (!this.snapshot.sourceIdentifier) {
      this.setStatus("Move to a source/master to edit sidebearings.", true);
      return;
    }
    this.setStatus(`Applying ${suggestions.length} spacing changes…`);
    const font = { glyphs: {} };
    const editable = [];
    for (const suggestion of suggestions) {
      const varGlyph = await this.fontController.getGlyph(suggestion.glyphName);
      if (!varGlyph) continue;
      const layerName = this.layerNameFor(varGlyph);
      if (!layerName) continue;
      font.glyphs[suggestion.glyphName] = varGlyph.glyph;
      editable.push({ suggestion, layerName });
    }
    try {
      const changes = recordChanges(font, (fontProxy) => {
        for (const { suggestion, layerName } of editable) {
          const layerGlyph = fontProxy.glyphs[suggestion.glyphName].layers[layerName].glyph;
          const dx = suggestion.proposedLeft - suggestion.currentLeft;
          layerGlyph.move(dx, 0);
          layerGlyph.xAdvance += dx + (suggestion.proposedRight - suggestion.currentRight);
        }
      });
      await this.fontController.editFinal(
        changes.change,
        changes.rollbackChange,
        "Fit: apply spacing",
        true
      );
      this.fontController.notifyEditListeners("editFinal", this);
      this.lastEdit = changes;
      this.undoButton.disabled = false;
      fit.applySpacingSuggestions(this.snapshot.project, suggestions);
      const applied = new Set(suggestions.map((s) => s.glyphName));
      this.spacingSuggestions = this.spacingSuggestions.filter((s) => !applied.has(s.glyphName));
      await this.updateSelectedGlyph();
      this.setStatus(`Applied spacing to ${editable.length} glyphs`);
      this.render();
    } catch (error) {
      console.error("Fit: spacing apply failed", error);
      this.setStatus(`Spacing apply failed: ${error}`, true);
    }
  }

  renderKerning() {
    const project = this.snapshot.project;
    const names = [...project.sources[0].glyphs]
      .sort((a, b) => (a.unicode ?? 1e9) - (b.unicode ?? 1e9) || a.name.localeCompare(b.name))
      .map((glyph) => glyph.name);
    const pairValue = fit.resolveKerning(project, this.pairLeft, this.pairRight);

    const pairCard = el("div", { class: "fit-card" }, [
      el("div", { class: "fit-card-title", text: "Kerning pair" }),
      el("div", { class: "fit-grid fit-grid-2" }, [
        this.selectField("Left glyph", names, this.pairLeft, (value) => {
          this.pairLeft = value;
          this.render();
        }),
        this.selectField("Right glyph", names, this.pairRight, (value) => {
          this.pairRight = value;
          this.render();
        }),
      ]),
      el("div", { class: "fit-muted", style: "margin-top:5px" }, [
        `Current Fontra value: ${pairValue > 0 ? "+" : ""}${Math.round(pairValue)} units`,
      ]),
      el("div", { class: "fit-row", style: "margin-top:6px" }, [
        button("Suggest pair", () => this.analyzeKerning([this.pairLeft, this.pairRight]), "fit-btn--primary"),
        button("Suggest all pairs", () => this.analyzeKerning()),
      ]),
    ]);

    const list = el("div", { class: "fit-card" }, [
      el("div", { class: "fit-card-title fit-between fit-row" }, [
        el("span", { text: `Suggestions · ${this.kerningSuggestions.length}` }),
        this.kerningSuggestions.length
          ? el("span", { class: "fit-badge", text: "writes kern values" })
          : null,
      ]),
      ...(this.kerningSuggestions.length
        ? this.kerningSuggestions.slice(0, 80).map((suggestion) =>
            el("div", { class: "fit-suggestion" }, [
              el("div", { class: "fit-suggestion-name", text: `${suggestion.left}${suggestion.right}`, title: suggestion.reason }),
              el("div", { class: "fit-suggestion-values" }, [
                `${suggestion.currentValue}→`,
                el("strong", { text: String(suggestion.value) }),
              ]),
              el("button", {
                class: "fit-btn fit-btn--small fit-btn--ghost",
                text: "Apply",
                onclick: () => this.applyKerning([suggestion]),
              }),
            ])
          )
        : [el("div", { class: "fit-empty", text: "Analyze a pair or the default pair list." })]),
      this.kerningSuggestions.length
        ? el("div", { class: "fit-row", style: "margin-top:6px" }, [
            button("Apply safe", () =>
              this.applyKerning(this.kerningSuggestions.filter((s) => s.confidence >= 0.82 && !s.collision))
            ),
            button("Apply all", () => this.applyKerning(this.kerningSuggestions)),
          ])
        : null,
    ]);

    this.bodyElement.append(pairCard, list);
  }

  async analyzeKerning(pair) {
    if (!this.snapshot) return;
    this.setStatus("Analyzing pair distances…");
    const project = this.snapshot.project;
    const params = {
      ...defaultAutoKern(),
    };
    const baseGap = fit.defaultTargetGap(project, fit.DEFAULT_SPACING_PARAMS);
    let pairs;
    if (pair) {
      pairs = [fit.kerningKey(pair[0], pair[1])];
    } else {
      pairs = fit.defaultPairList(project).slice(0, 1400);
    }
    this.kerningSuggestions = fit.autoKernSuggestions(project, pairs, params, baseGap, 0.65);
    this.setStatus(`${this.kerningSuggestions.length} kerning suggestions`);
    this.render();
  }

  async applyKerning(suggestions) {
    if (!suggestions.length || !this.snapshot) return;
    if (!this.snapshot.sourceIdentifier) {
      this.setStatus("Move to a source/master to edit kerning.", true);
      return;
    }
    this.setStatus(`Applying ${suggestions.length} kerning changes…`);
    try {
      const kerningController = await this.fontController.getKerningController("kern");
      const editContext = kerningController.getEditContext(
        suggestions.map((suggestion) => ({
          leftName: suggestion.left,
          rightName: suggestion.right,
          sourceIdentifier: this.snapshot.sourceIdentifier,
        }))
      );
      const changes = await editContext.edit(
        suggestions.map((suggestion) => suggestion.value),
        "Fit: auto-kern"
      );
      if (changes) this.lastEdit = changes;
      this.undoButton.disabled = !this.lastEdit;
      fit.applyKerningSuggestions(this.snapshot.project, suggestions);
      const applied = new Set(suggestions.map((s) => `${s.left}\0${s.right}`));
      this.kerningSuggestions = this.kerningSuggestions.filter(
        (s) => !applied.has(`${s.left}\0${s.right}`)
      );
      this.setStatus(`Applied kerning to ${suggestions.length} pairs`);
      this.render();
    } catch (error) {
      console.error("Fit: kerning apply failed", error);
      this.setStatus(`Kerning apply failed: ${error}`, true);
    }
  }

  renderTracking() {
    const em = (this.trackingPerMille / 1000).toFixed(4);
    const css = `.letter-spacing {\n  letter-spacing: ${em}em; /* ${this.trackingPerMille}/1000 em */\n}`;
    const fea = `feature kern {\n  pos @ALL <0 0 ${Math.round(this.trackingPerMille)} 0>;\n} kern;`;
    const card = el("div", { class: "fit-card" }, [
      el("div", { class: "fit-card-title", text: "Tracking" }),
      el("div", { class: "fit-grid fit-grid-2" }, [
        this.inputField("Units / 1000 em", this.trackingPerMille, (value) => {
          this.trackingPerMille = value;
          this.render();
        }),
      ]),
      el("div", { class: "fit-muted", style: "margin-top:5px" }, [
        "Tracking is layout data. Fit does not bake it into advance widths.",
      ]),
      el("div", { class: "fit-row", style: "margin-top:6px" }, [
        button("Copy CSS", async () => {
          await navigator.clipboard?.writeText(css);
          this.setStatus("Tracking CSS copied");
        }),
        button("Copy feature", async () => {
          await navigator.clipboard?.writeText(fea);
          this.setStatus("Tracking feature copied");
        }),
      ]),
    ]);

    const cssCard = el("div", { class: "fit-card" }, [
      el("div", { class: "fit-card-title", text: "CSS" }),
      el("pre", { class: "fit-code", text: css }),
    ]);
    const feaCard = el("div", { class: "fit-card" }, [
      el("div", { class: "fit-card-title", text: "OpenType feature preview" }),
      el("pre", { class: "fit-code", text: fea }),
      el("div", { class: "fit-muted", style: "margin-top:5px" }, [
        "Define the @ALL class for your font before compiling this feature.",
      ]),
    ]);
    this.bodyElement.append(card, cssCard, feaCard);
  }

  renderQA() {
    const project = this.snapshot.project;
    const summary = fit.qaSummary(this.qaIssues);
    const scoreClass =
      summary.score >= 85 ? "fit-score--good" : summary.score >= 60 ? "fit-score--mid" : "fit-score--low";
    const card = el("div", { class: "fit-card" }, [
      el("div", { class: "fit-card-title fit-between fit-row" }, [
        el("span", { text: "Health" }),
        button("Run QA", () => this.runQA(), "fit-btn--small"),
      ]),
      el("div", { class: "fit-row", style: "gap:12px;margin:4px 0 6px" }, [
        el("div", { class: `fit-score ${scoreClass}`, text: String(summary.score) }),
        el("div", { class: "fit-muted" }, [
          `${summary.errors} errors`,
          el("br"),
          `${summary.warnings} warnings · ${summary.info} notes`,
        ]),
      ]),
    ]);
    const issues = el("div", { class: "fit-card" }, [
      el("div", { class: "fit-card-title", text: `Issues · ${this.qaIssues.length}` }),
      ...(this.qaIssues.length
        ? this.qaIssues.slice(0, 100).map((issue) =>
            el("div", { class: "fit-issue", title: issue.detail }, [
              el("span", { class: `fit-dot fit-dot--${issue.severity}` }),
              el("div", {}, [
                el("div", { class: "fit-issue-title", text: issue.title }),
                el("div", { class: "fit-issue-detail", text: issue.detail }),
              ]),
            ])
          )
        : [el("div", { class: "fit-empty", text: "Run QA to inspect the live font." })]),
    ]);
    this.bodyElement.append(card, issues);
  }

  async runQA() {
    if (!this.snapshot) return;
    this.setStatus("Scanning pairs and metrics…");
    this.qaIssues = fit.runQA(this.snapshot.project, fit.DEFAULT_QA_PARAMS);
    this.setStatus(`${this.qaIssues.length} QA issues`);
    this.render();
  }

  async applySelectedMetric(kind, value) {
    if (!this.snapshot) return;
    if (!this.snapshot.sourceIdentifier) {
      this.setStatus("Move to a source/master to edit metrics.", true);
      return;
    }
    const name = this.selectedGlyphName || this.sceneController.sceneSettings.selectedGlyphName;
    if (!name) return;
    const varGlyph = await this.fontController.getGlyph(name);
    const layerName = varGlyph && this.layerNameFor(varGlyph);
    if (!varGlyph || !layerName) return;
    const instance = await this.fontController.getGlyphInstance(
      name,
      this.snapshot.location,
      this.snapshot.layerName
    );
    if (!instance) return;
    const bounds = instance.flattenedPath?.getBounds();
    const currentLeft = bounds ? bounds.xMin : instance.leftMargin ?? 0;
    const currentRight = bounds ? instance.xAdvance - bounds.xMax : instance.rightMargin ?? 0;
    const font = { glyphs: { [name]: varGlyph.glyph } };
    try {
      const changes = recordChanges(font, (fontProxy) => {
        const layerGlyph = fontProxy.glyphs[name].layers[layerName].glyph;
        if (kind === "left") {
          const dx = value - currentLeft;
          layerGlyph.move(dx, 0);
          layerGlyph.xAdvance += dx;
        } else if (kind === "right") {
          layerGlyph.xAdvance += value - currentRight;
        } else {
          layerGlyph.xAdvance = value;
        }
      });
      await this.fontController.editFinal(
        changes.change,
        changes.rollbackChange,
        `Fit: set ${kind} of ${name}`,
        true
      );
      this.fontController.notifyEditListeners("editFinal", this);
      this.lastEdit = changes;
      this.undoButton.disabled = false;
      await this.updateSelectedGlyph();
      this.setStatus(`${name} ${kind} updated`);
      this.render();
    } catch (error) {
      console.error("Fit: metric edit failed", error);
      this.setStatus(`Metric edit failed: ${error}`, true);
    }
  }

  layerNameFor(varGlyph) {
    if (this.snapshot?.layerName) return this.snapshot.layerName;
    const sourceIndex = varGlyph.getSourceIndex(this.snapshot?.location || {});
    return sourceIndex === undefined ? undefined : varGlyph.sources[sourceIndex]?.layerName;
  }

  async undoLast() {
    if (!this.lastEdit) return;
    const { change, rollbackChange } = this.lastEdit;
    this.setStatus("Undoing last Fit change…");
    try {
      await this.fontController.applyChange(rollbackChange);
      await this.fontController.editFinal(rollbackChange, change, "Undo Fit change", true);
      this.fontController.notifyEditListeners("editFinal", this);
      this.lastEdit = null;
      this.undoButton.disabled = true;
      await this.loadSnapshot();
      this.setStatus("Last Fit change undone");
    } catch (error) {
      console.error("Fit: undo failed", error);
      this.setStatus(`Undo failed: ${error}`, true);
    }
  }
}

function defaultAutoKern() {
  return {
    threshold: 3,
    minKern: -250,
    maxKern: 180,
    collisionGap: 8,
    onlyPairList: true,
  };
}

export function start(editorController, pluginPath) {
  FitPanel.prototype.iconPath = `${pluginPath}/fontra-plugin/fit.svg`;
  customElements.define("fit-letter-spacing-panel", FitPanel);
  editorController.addSidebarPanel(new FitPanel(editorController), "right");
}
