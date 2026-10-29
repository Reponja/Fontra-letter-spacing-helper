import Panel from "fontra/editor/panel.js";
import { getSelectedGlyphInfo } from "fontra/editor/scene-model.js";
import { createDomElement, div, input, span } from "fontra/core/html-utils.js";
import { ObservableController } from "fontra/core/observable-object.js";

const DEFAULT_URL = "http://localhost:5173/";

/**
 * Fit — Fontra panel bridge.
 *
 * The Fit lab is a standalone web app. This panel embeds it in an iframe and
 * keeps the current Fontra glyph selection in sync through postMessage. It is
 * intentionally thin: the algorithms live in the Fit app, so they can also be
 * used outside Fontra.
 */
class FitSpacingPanel extends Panel {
  identifier = "fit-spacing-panel";
  iconPath = "/images/fit.svg";

  static styles = `
    .fit-panel {
      display: flex;
      flex-direction: column;
      gap: 0.7em;
      height: 100%;
      padding: 0.9em;
      box-sizing: border-box;
      white-space: normal;
      overflow: hidden;
    }
    .fit-title { font-weight: 700; font-size: 1.05em; }
    .fit-help { opacity: 0.7; font-size: 0.9em; line-height: 1.35; }
    .fit-status {
      display: flex;
      gap: 0.5em;
      align-items: baseline;
      padding: 0.5em 0.6em;
      border-radius: 6px;
      background: var(--ui-list-background-color, #8882);
      font-size: 0.9em;
    }
    .fit-status strong { font-family: var(--fontra-ui-regular, monospace); }
    .fit-row { display: grid; grid-template-columns: 1fr auto; gap: 0.4em; }
    .fit-row input {
      min-width: 0;
      border: 1px solid var(--ui-list-border-color, #8884);
      border-radius: 5px;
      padding: 0.4em 0.5em;
      background: var(--text-input-background-color, transparent);
      color: var(--text-input-foreground-color, inherit);
      font-size: 0.9em;
    }
    .fit-actions { display: flex; flex-wrap: wrap; gap: 0.35em; }
    .fit-actions button {
      border: 1px solid var(--ui-list-border-color, #8884);
      border-radius: 5px;
      padding: 0.35em 0.6em;
      background: var(--ui-list-background-color, transparent);
      color: inherit;
      cursor: pointer;
      font-size: 0.88em;
    }
    .fit-actions button:hover { background: var(--ui-list-header-background-color, #8883); }
    .fit-actions button.primary { font-weight: 600; }
    .fit-frame-wrap {
      flex: 1;
      min-height: 220px;
      border: 1px solid var(--ui-list-border-color, #8884);
      border-radius: 6px;
      overflow: hidden;
      background: #f4f1ea;
    }
    .fit-frame { width: 100%; height: 100%; border: 0; display: block; }
    .fit-note { opacity: 0.6; font-size: 0.8em; line-height: 1.35; }
  `;

  constructor(editorController) {
    super(editorController);
    this.selectedGlyphName = "";
    this.fitReady = false;
    this.handleMessage = (event) => {
      if (event.data?.type === "fit:ready") {
        this.fitReady = true;
        this.updateStatus();
        this.sendSelection();
      }
    };
    window.addEventListener("message", this.handleMessage);
    const update = () => this.updateSelection();
    editorController.sceneSettingsController.addKeyListener("selectedGlyph", update);
    editorController.sceneSettingsController.addKeyListener("glyphLines", update);
    this.updateSelection();
  }

  get model() {
    return this.controller.model;
  }

  updateSelection() {
    const settings = this.editorController.sceneSettings;
    const info = getSelectedGlyphInfo(settings.selectedGlyph, settings.glyphLines);
    this.selectedGlyphName = info?.glyphName ?? "";
    this.updateStatus();
  }

  updateStatus() {
    if (!this.statusElement) return;
    this.statusElement.innerHTML = "";
    this.statusElement.appendChild(
      span({}, ["Fontra selection: "])
    );
    this.statusElement.appendChild(
      createDomElement("strong", {}, [this.selectedGlyphName || "—"])
    );
    this.statusElement.appendChild(
      span({ class: "fit-note" }, [this.fitReady ? " · Fit connected" : " · Fit not connected"])
    );
  }

  sendSelection() {
    if (!this.selectedGlyphName) return;
    this.frame?.contentWindow?.postMessage(
      { type: "fit:select-glyph", glyph: this.selectedGlyphName },
      "*"
    );
  }

  sendText() {
    const text = this.proofInput?.value ?? "";
    this.frame?.contentWindow?.postMessage({ type: "fit:set-text", text }, "*");
  }

  reloadFrame() {
    this.fitReady = false;
    this.updateStatus();
    if (this.frame) {
      this.frame.src = this.model.url || DEFAULT_URL;
    }
  }

  getContentElement() {
    this.controller = new ObservableController({ url: DEFAULT_URL });
    this.controller.synchronizeWithLocalStorage("fontra.fit-spacing-plugin.");

    const urlInput = input({
      type: "text",
      value: this.model.url || DEFAULT_URL,
      onchange: (event) => {
        this.model.url = event.target.value.trim() || DEFAULT_URL;
        this.reloadFrame();
      },
    });
    const proofInput = input({
      type: "text",
      value: "Hamburgevons nnoo HHOO",
      placeholder: "Proof text",
    });
    this.proofInput = proofInput;

    this.statusElement = div({ class: "fit-status" }, []);
    this.frame = createDomElement("iframe", {
      class: "fit-frame",
      src: this.model.url || DEFAULT_URL,
      title: "Fit — Letter Spacing Lab",
    });
    this.updateStatus();

    const button = (label, onClick, primary = false) =>
      createDomElement(
        "button",
        { class: primary ? "primary" : "", onclick: onClick },
        [label]
      );

    return div({ class: "fit-panel" }, [
      div({ class: "fit-title" }, ["Fit — Letter Spacing Lab"]),
      div(
        { class: "fit-help" },
        [
          "Auto-spacing, kerning, tracking and QA. Select a glyph in Fontra, then send it to Fit, or open the full lab.",
        ]
      ),
      this.statusElement,
      div({ class: "fit-row" }, [
        urlInput,
        button("Reload", () => this.reloadFrame()),
      ]),
      div({ class: "fit-actions" }, [
        button("Send glyph", () => this.sendSelection(), true),
        button("Open full lab", () => window.open(this.model.url || DEFAULT_URL, "_blank")),
      ]),
      div({ class: "fit-row" }, [
        proofInput,
        button("Send text", () => this.sendText()),
      ]),
      div({ class: "fit-frame-wrap" }, [this.frame]),
      div(
        { class: "fit-note" },
        [
          "Run `npm run dev` in the Fit repo, or build it and point the URL at the hosted app. UFO/.fontra import and export happen inside Fit.",
        ]
      ),
    ]);
  }
}

export function start(editorController, pluginPath) {
  FitSpacingPanel.prototype.iconPath = `${pluginPath}/fit.svg`;
  customElements.define("fit-spacing-panel", FitSpacingPanel);
  editorController.addSidebarPanel(new FitSpacingPanel(editorController), "right");
}
