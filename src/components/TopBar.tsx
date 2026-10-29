import { useRef, useState } from "react";
import type { FontProject } from "../core/types";

export type ExportKind =
  | "json"
  | "ufo"
  | "designspace"
  | "otf"
  | "fontra"
  | "features"
  | "css"
  | "tracking-json"
  | "tracking-csv"
  | "qa-csv"
  | "qa-html";

interface TopBarProps {
  project?: FontProject;
  canUndo: boolean;
  canRedo: boolean;
  theme: "dark" | "light";
  onUndo: () => void;
  onRedo: () => void;
  onToggleTheme: () => void;
  onLoadDemo: () => void;
  onImportProject: (file: File) => void;
  onImportFontra: (files: FileList) => void;
  onImportUfo: (files: FileList) => void;
  onImportDesignspace: (files: FileList) => void;
  onImportFont: (file: File) => void;
  onImportZip: (file: File) => void;
  onLoadReference: (file: File) => void;
  onSourceChange: (index: number) => void;
  onExport: (kind: ExportKind) => void;
}

export default function TopBar({
  project,
  canUndo,
  canRedo,
  theme,
  onUndo,
  onRedo,
  onToggleTheme,
  onLoadDemo,
  onImportProject,
  onImportFontra,
  onImportUfo,
  onImportDesignspace,
  onImportFont,
  onImportZip,
  onLoadReference,
  onSourceChange,
  onExport,
}: TopBarProps) {
  const projectInput = useRef<HTMLInputElement>(null);
  const fontraInput = useRef<HTMLInputElement>(null);
  const ufoInput = useRef<HTMLInputElement>(null);
  const designspaceInput = useRef<HTMLInputElement>(null);
  const fontInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const referenceInput = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">F</div>
        <div>
          <div className="brand-name">Fit</div>
          <div className="brand-sub">Letter Spacing Lab</div>
        </div>
      </div>

      <div className="project-title">
        <span className="project-name">{project?.name || "No project"}</span>
        {project && (
          <span className="project-meta">
            {project.sources[project.activeSource]?.name} · {project.sources[project.activeSource]?.glyphs.length} glyphs
          </span>
        )}
      </div>

      <div className="topbar-actions">
        {project && project.sources.length > 1 && (
          <select
            className="select-input select-input--source"
            value={project.activeSource}
            onChange={(event) => onSourceChange(Number(event.target.value))}
            title="Active source / master"
            aria-label="Active source"
          >
            {project.sources.map((source, index) => (
              <option key={`${source.name}-${index}`} value={index}>
                {source.name}
              </option>
            ))}
          </select>
        )}
        <button className="icon-button" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button className="icon-button" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷
        </button>
        <span className="topbar-divider" />
        <button className="button button--ghost" onClick={onLoadDemo}>
          Demo
        </button>

        <div className="menu-wrap">
          <button className="button" onClick={() => setImportOpen((open) => !open)}>
            Import <span className="caret">▾</span>
          </button>
          {importOpen && (
            <div className="menu" onMouseLeave={() => setImportOpen(false)}>
              <button className="menu-item" onClick={() => { projectInput.current?.click(); setImportOpen(false); }}>
                <strong>Fit project</strong><span>.fit.json</span>
              </button>
              <button className="menu-item" onClick={() => { fontraInput.current?.click(); setImportOpen(false); }}>
                <strong>Fontra project</strong><span>.fontra folder</span>
              </button>
              <button className="menu-item" onClick={() => { ufoInput.current?.click(); setImportOpen(false); }}>
                <strong>UFO</strong><span>.ufo folder</span>
              </button>
              <button className="menu-item" onClick={() => { designspaceInput.current?.click(); setImportOpen(false); }}>
                <strong>Designspace</strong><span>.designspace + UFOs</span>
              </button>
              <button className="menu-item" onClick={() => { zipInput.current?.click(); setImportOpen(false); }}>
                <strong>Fontra / UFO zip</strong><span>.zip</span>
              </button>
              <button className="menu-item" onClick={() => { fontInput.current?.click(); setImportOpen(false); }}>
                <strong>Binary font</strong><span>.ttf / .otf</span>
              </button>
            </div>
          )}
        </div>

        <div className="menu-wrap">
          <button className="button button--primary" onClick={() => setExportOpen((open) => !open)}>
            Export <span className="caret">▾</span>
          </button>
          {exportOpen && (
            <div className="menu menu--right" onMouseLeave={() => setExportOpen(false)}>
              <div className="menu-label">Project</div>
              <button className="menu-item" onClick={() => { onExport("json"); setExportOpen(false); }}><strong>Fit project</strong><span>.fit.json</span></button>
              <button className="menu-item" onClick={() => { onExport("ufo"); setExportOpen(false); }}><strong>UFO</strong><span>.ufo.zip</span></button>
              <button className="menu-item" onClick={() => { onExport("designspace"); setExportOpen(false); }}><strong>Designspace</strong><span>.designspace.zip</span></button>
              <button className="menu-item" onClick={() => { onExport("otf"); setExportOpen(false); }}><strong>OpenType font</strong><span>.otf</span></button>
              <button className="menu-item" onClick={() => { onExport("fontra"); setExportOpen(false); }}><strong>Fontra</strong><span>.fontra.zip</span></button>
              <div className="menu-label">Tracking / OpenType</div>
              <button className="menu-item" onClick={() => { onExport("features"); setExportOpen(false); }}><strong>Feature code</strong><span>cpsp + kern</span></button>
              <button className="menu-item" onClick={() => { onExport("css"); setExportOpen(false); }}><strong>CSS</strong><span>letter-spacing</span></button>
              <button className="menu-item" onClick={() => { onExport("tracking-json"); setExportOpen(false); }}><strong>Tracking data</strong><span>.json</span></button>
              <button className="menu-item" onClick={() => { onExport("tracking-csv"); setExportOpen(false); }}><strong>Tracking table</strong><span>.csv</span></button>
              <div className="menu-label">QA</div>
              <button className="menu-item" onClick={() => { onExport("qa-csv"); setExportOpen(false); }}><strong>QA report</strong><span>.csv</span></button>
              <button className="menu-item" onClick={() => { onExport("qa-html"); setExportOpen(false); }}><strong>QA report</strong><span>.html</span></button>
            </div>
          )}
        </div>

        <button className="icon-button" onClick={() => referenceInput.current?.click()} title="Load reference font">
          ◫
        </button>
        <button className="icon-button" onClick={onToggleTheme} title="Toggle theme">
          {theme === "dark" ? "☼" : "☾"}
        </button>
      </div>

      <input
        ref={projectInput}
        type="file"
        accept=".json,.fit.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImportProject(file);
          event.target.value = "";
        }}
      />
      <input
        ref={fontraInput}
        type="file"
        multiple
        hidden
        {...({ webkitdirectory: "true", directory: "true" } as Record<string, string>)}
        onChange={(event) => {
          if (event.target.files?.length) onImportFontra(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={ufoInput}
        type="file"
        multiple
        hidden
        {...({ webkitdirectory: "true", directory: "true" } as Record<string, string>)}
        onChange={(event) => {
          if (event.target.files?.length) onImportUfo(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={designspaceInput}
        type="file"
        multiple
        hidden
        {...({ webkitdirectory: "true", directory: "true" } as Record<string, string>)}
        onChange={(event) => {
          if (event.target.files?.length) onImportDesignspace(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={fontInput}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImportFont(file);
          event.target.value = "";
        }}
      />
      <input
        ref={zipInput}
        type="file"
        accept=".zip"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImportZip(file);
          event.target.value = "";
        }}
      />
      <input
        ref={referenceInput}
        type="file"
        accept=".ttf,.otf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onLoadReference(file);
          event.target.value = "";
        }}
      />
    </header>
  );
}
