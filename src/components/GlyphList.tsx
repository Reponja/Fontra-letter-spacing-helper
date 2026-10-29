import { useEffect, useMemo, useRef, useState } from "react";
import type { FontProject, Glyph } from "../core/types";
import { activeSource, leftGroupOf, rightGroupOf, sortedGlyphs } from "../core/project";
import { sidebearingsOf } from "../core/geometry";
import { spacingOutliers } from "../core/spacing";
import GlyphThumb from "./GlyphThumb";

interface GlyphListProps {
  project: FontProject;
  selectedGlyph: string;
  onSelectGlyph: (name: string) => void;
}

type Filter = "all" | "lower" | "upper" | "number" | "punct" | "ungrouped" | "outliers";

export default function GlyphList({ project, selectedGlyph, onSelectGlyph }: GlyphListProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const listRef = useRef<HTMLDivElement>(null);
  const outlierNames = useMemo(() => new Set(spacingOutliers(project).map((item) => item.glyphName)), [project]);

  const glyphs = useMemo(() => {
    const all = sortedGlyphs(project);
    return all.filter((glyph) => {
      if (query) {
        const haystack = `${glyph.name} ${glyph.unicode ? String.fromCodePoint(glyph.unicode) : ""}`.toLowerCase();
        if (!haystack.includes(query.toLowerCase())) return false;
      }
      switch (filter) {
        case "lower":
          return glyph.category === "Lowercase";
        case "upper":
          return glyph.category === "Uppercase" || glyph.category === "Smallcaps";
        case "number":
          return glyph.category === "Number";
        case "punct":
          return glyph.category === "Punctuation" || glyph.category === "Symbol";
        case "ungrouped":
          return !leftGroupOf(project, glyph.name) || !rightGroupOf(project, glyph.name);
        case "outliers":
          return outlierNames.has(glyph.name);
        default:
          return true;
      }
    });
  }, [project, query, filter, outlierNames]);

  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>(`[data-glyph="${CSS.escape(selectedGlyph)}"]`);
    element?.scrollIntoView({ block: "nearest" });
  }, [selectedGlyph]);

  const digits = project.unitsPerEm >= 1000 ? 0 : 1;

  return (
    <div className="glyph-list">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">Glyphs</div>
          <div className="panel-title">{glyphs.length} of {activeSource(project).glyphs.length}</div>
        </div>
        <span className="badge">{project.unitsPerEm} UPM</span>
      </div>
      <div className="search-row">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search glyphs…"
          className="text-input"
          aria-label="Search glyphs"
        />
      </div>
      <div className="filter-row">
        {(
          [
            ["all", "All"],
            ["lower", "abc"],
            ["upper", "ABC"],
            ["number", "123"],
            ["punct", "Punct"],
            ["ungrouped", "Ungrouped"],
            ["outliers", "Outliers"],
          ] as Array<[Filter, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            className={`chip ${filter === value ? "is-active" : ""}`}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="glyph-scroll" ref={listRef}>
        {glyphs.map((glyph) => (
          <GlyphRow
            key={glyph.name}
            glyph={glyph}
            project={project}
            selected={glyph.name === selectedGlyph}
            isOutlier={outlierNames.has(glyph.name)}
            digits={digits}
            onClick={() => onSelectGlyph(glyph.name)}
          />
        ))}
        {!glyphs.length && <div className="empty-state">No glyphs match this filter.</div>}
      </div>
    </div>
  );
}

function GlyphRow({
  glyph,
  project,
  selected,
  isOutlier,
  digits,
  onClick,
}: {
  glyph: Glyph;
  project: FontProject;
  selected: boolean;
  isOutlier: boolean;
  digits: number;
  onClick: () => void;
}) {
  const sb = sidebearingsOf(glyph);
  const leftGroup = leftGroupOf(project, glyph.name);
  const rightGroup = rightGroupOf(project, glyph.name);
  return (
    <button
      data-glyph={glyph.name}
      className={`glyph-row ${selected ? "is-selected" : ""}`}
      onClick={onClick}
      title={`${glyph.name} · LSB ${sb.left.toFixed(digits)} · RSB ${sb.right.toFixed(digits)}`}
    >
      <GlyphThumb glyph={glyph} />
      <span className="glyph-row-name">
        <span className="glyph-name">{glyph.name}</span>
        <span className="glyph-meta">
          {glyph.unicode ? String.fromCodePoint(glyph.unicode) : "—"}
          {isOutlier && <span className="dot dot--outlier" title="Spacing outlier" />}
        </span>
      </span>
      <span className="glyph-metrics">
        <span>{sb.left.toFixed(digits)}</span>
        <span className="muted">/</span>
        <span>{sb.right.toFixed(digits)}</span>
      </span>
      <span className="glyph-groups">
        {leftGroup && <span className="group-dot group-dot--left" title={`Left group: ${leftGroup}`} />}
        {rightGroup && <span className="group-dot group-dot--right" title={`Right group: ${rightGroup}`} />}
      </span>
    </button>
  );
}
