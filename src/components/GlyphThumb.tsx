import type { Glyph } from "../core/types";
import { glyphBounds } from "../core/geometry";
import { contoursToSvgPath } from "../core/path";

export default function GlyphThumb({ glyph, size = 30 }: { glyph: Glyph; size?: number }) {
  const bounds = glyphBounds(glyph);
  const path = contoursToSvgPath(glyph.contours);
  if (!bounds || !path) {
    return <span className="glyph-thumb glyph-thumb--empty">·</span>;
  }
  const padding = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.08;
  const width = Math.max(1, bounds.maxX - bounds.minX + padding * 2);
  const height = Math.max(1, bounds.maxY - bounds.minY + padding * 2);
  return (
    <svg
      className="glyph-thumb"
      width={size}
      height={size}
      viewBox={`${bounds.minX - padding} ${-bounds.maxY - padding} ${width} ${height}`}
      aria-hidden="true"
    >
      <path d={path} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
