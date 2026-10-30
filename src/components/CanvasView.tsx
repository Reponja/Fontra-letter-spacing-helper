import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, FontProject, Glyph } from "../core/types";
import { sidebearingsOf } from "../core/geometry";
import { resolveKerning } from "../core/project";
import { glyphPaths, layoutText, type LayoutItem, type TextLayout } from "../render/layout";

interface CanvasViewProps {
  project: FontProject;
  ghostProject?: FontProject;
  referenceProject?: FontProject;
  text: string;
  mode: AppSettings["mode"];
  selectedGlyph: string;
  selectedPair: [string, string];
  settings: AppSettings;
  measurementLine: number;
  onSelectGlyph: (name: string) => void;
  onSelectPair: (pair: [string, string]) => void;
  onSidebearingChange: (glyphName: string, side: "left" | "right", value: number) => void;
  onKerningChange: (left: string, right: string, value: number) => void;
}

type DragState =
  | {
      kind: "sidebearing";
      glyphName: string;
      side: "left" | "right";
      startValue: number;
      startX: number;
      delta: number;
    }
  | {
      kind: "kerning";
      left: string;
      right: string;
      startValue: number;
      startX: number;
      delta: number;
      leftIndex: number;
    }
  | {
      kind: "pan";
      startX: number;
      startY: number;
      startPanX: number;
      startPanY: number;
    }
  | undefined;

interface DrawContext {
  scale: number;
  originX: number;
  baselineY: number;
  width: number;
  height: number;
}

const COLORS = {
  ink: "#171717",
  selectedInk: "#0b6bcb",
  ghost: "#d9480f",
  reference: "#7048e8",
  guide: "#c9c4ba",
  guideStrong: "#8c8579",
  sidebearing: "#1c7ed6",
  kerningNeg: "#1c7ed6",
  kerningPos: "#e8590c",
  box: "#d8d2c8",
  tracking: "#0ca678",
};

export default function CanvasView(props: CanvasViewProps) {
  const {
    project,
    ghostProject,
    referenceProject,
    text,
    mode,
    selectedGlyph,
    selectedPair,
    settings,
    measurementLine,
    onSelectGlyph,
    onSelectPair,
    onSidebearingChange,
    onKerningChange,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 900, height: 520 });
  const [drag, setDrag] = useState<DragState>();
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const dragRef = useRef<DragState>(undefined);
  const viewRef = useRef(view);
  const layoutRef = useRef<TextLayout | undefined>(undefined);
  const drawContextRef = useRef<DrawContext | undefined>(undefined);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    dragRef.current = drag;
    draw();
  }, [drag]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () => layoutText(project, text || "nnoo", { applyKerning: true, applyTracking: mode === "tracking" }),
    [project, text, mode]
  );
  layoutRef.current = layout;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(100, size.width);
    const height = Math.max(100, size.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const bg = settings.theme === "dark" ? "#1d1c1a" : "#fbfaf7";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    if (mode === "proof") {
      drawWaterfall(ctx, project, text, selectedGlyph, width, height, settings);
      return;
    }

    const em = project.unitsPerEm;
    const vertical = project.ascender - project.descender;
    const paddingX = 64;
    const paddingY = 92;
    const baseFit = Math.min(
      (width - paddingX * 2) / Math.max(1, layout.totalWidth),
      (height - paddingY * 2) / Math.max(1, vertical)
    );
    const scale = Math.max(0.02, baseFit * settings.zoom * view.zoom);
    const originX = Math.max(paddingX, (width - layout.totalWidth * scale) / 2) + view.panX;
    const baselineY =
      Math.min(height - paddingY, Math.max(paddingY, height * 0.7)) + view.panY;
    const drawContext = { scale, originX, baselineY, width, height };
    drawContextRef.current = drawContext;

    drawGrid(ctx, project, drawContext, settings);
    if (ghostProject) {
      drawProject(ctx, ghostProject, text, drawContext, settings, selectedGlyph, undefined, COLORS.ghost, 0.28, false);
    }
    if (referenceProject) {
      drawProject(ctx, referenceProject, text, drawContext, settings, selectedGlyph, undefined, COLORS.reference, 0.28, false);
    }
    drawProject(ctx, project, text, drawContext, settings, selectedGlyph, drag, COLORS.ink, 1, true);

    const selected = layout.items.find((item) => item.glyph.name === selectedGlyph);
    if (selected) {
      drawSelectedGlyphOverlay(ctx, project, selected, drawContext, drag, measurementLine);
    }
    drawLegend(ctx, layout, drawContext, selectedGlyph, mode, settings);
  }, [layout, project, ghostProject, referenceProject, text, mode, selectedGlyph, selectedPair, settings, size, drag, measurementLine, view]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const context = drawContextRef.current;
      const currentLayout = layoutRef.current;
      if (!context || !currentLayout) return;
      const rect = canvas.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const oldView = viewRef.current;
      const factor = Math.exp(-event.deltaY * 0.0014);
      const nextZoom = Math.min(8, Math.max(0.2, oldView.zoom * factor));
      const scaleFactor = nextZoom / oldView.zoom;
      const worldX = (pointerX - context.originX) / context.scale;
      const worldY = (context.baselineY - pointerY) / context.scale;
      const newScale = context.scale * scaleFactor;
      const width = Math.max(100, size.width);
      const height = Math.max(100, size.height);
      const paddingX = 64;
      const paddingY = 92;
      const vertical = project.ascender - project.descender;
      const baseFit = Math.min(
        (width - paddingX * 2) / Math.max(1, currentLayout.totalWidth),
        (height - paddingY * 2) / Math.max(1, vertical)
      );
      const baseScale = Math.max(0.02, baseFit * settings.zoom * nextZoom);
      const baseOriginX = Math.max(paddingX, (width - currentLayout.totalWidth * baseScale) / 2);
      const baseBaselineY = Math.min(height - paddingY, Math.max(paddingY, height * 0.7));
      const newOriginX = pointerX - worldX * newScale;
      const newBaselineY = pointerY + worldY * newScale;
      setView({
        zoom: nextZoom,
        panX: newOriginX - baseOriginX,
        panY: newBaselineY - baseBaselineY,
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [size, settings.zoom, project.ascender, project.descender]);

  useEffect(() => {
    const isTextField = (target: EventTarget | null) =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable);

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextField(event.target)) return;
      if (event.code === "Space") {
        event.preventDefault();
        setSpaceDown(true);
      } else if (event.key === "0") {
        setView({ zoom: 1, panX: 0, panY: 0 });
      } else if (event.key === "+" || event.key === "=") {
        setView((current) => ({ ...current, zoom: Math.min(8, current.zoom * 1.15) }));
      } else if (event.key === "-") {
        setView((current) => ({ ...current, zoom: Math.max(0.2, current.zoom / 1.15) }));
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceDown(false);
    };
    const onBlur = () => setSpaceDown(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const getPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const beginPan = (pointer: { x: number; y: number }, event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = viewRef.current;
    setDrag({
      kind: "pan",
      startX: pointer.x,
      startY: pointer.y,
      startPanX: current.panX,
      startPanY: current.panY,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const pointer = getPointer(event);
    const context = drawContextRef.current;
    if (!context || !layoutRef.current) return;
    const { scale, originX } = context;
    const items = layoutRef.current.items;

    if (event.button === 1 || spaceDown || event.altKey) {
      event.preventDefault();
      beginPan(pointer, event);
      return;
    }

    const hit = items.find((item) => {
      const x0 = originX + item.x * scale;
      const x1 = x0 + Math.max(item.advance, 20) * scale;
      return pointer.x >= x0 && pointer.x <= x1;
    });
    if (hit) onSelectGlyph(hit.glyph.name);

    if (mode === "spacing" && hit) {
      const sb = sidebearingsOf(hit.glyph);
      const leftX = originX + (hit.x + sb.left) * scale;
      const rightX = originX + (hit.x + hit.advance - sb.right) * scale;
      if (Math.abs(pointer.x - leftX) < 10) {
        setDrag({
          kind: "sidebearing",
          glyphName: hit.glyph.name,
          side: "left",
          startValue: sb.left,
          startX: pointer.x,
          delta: 0,
        });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      if (Math.abs(pointer.x - rightX) < 10) {
        setDrag({
          kind: "sidebearing",
          glyphName: hit.glyph.name,
          side: "right",
          startValue: sb.right,
          startX: pointer.x,
          delta: 0,
        });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }

    if (mode === "kerning") {
      for (let i = 0; i < items.length - 1; i++) {
        const left = items[i];
        const right = items[i + 1];
        const gapX = originX + (left.x + left.advance + resolveKerning(project, left.glyph.name, right.glyph.name)) * scale;
        if (Math.abs(pointer.x - gapX) < 18 || (pointer.x > originX + (left.x + left.advance) * scale - 8 && pointer.x < originX + right.x * scale + 8)) {
          onSelectPair([left.glyph.name, right.glyph.name]);
          setDrag({
            kind: "kerning",
            left: left.glyph.name,
            right: right.glyph.name,
            startValue: resolveKerning(project, left.glyph.name, right.glyph.name),
            startX: pointer.x,
            delta: 0,
            leftIndex: i,
          });
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }
      }
    }

    if (event.button === 0) {
      beginPan(pointer, event);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag) return;
    const pointer = getPointer(event);
    const context = drawContextRef.current;
    if (!context) return;
    if (drag.kind === "pan") {
      setView((current) => ({
        ...current,
        panX: drag.startPanX + (pointer.x - drag.startX),
        panY: drag.startPanY + (pointer.y - drag.startY),
      }));
      return;
    }
    const delta = (pointer.x - drag.startX) / context.scale;
    setDrag({ ...drag, delta });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag) return;
    if (drag.kind === "pan") {
      setDrag(undefined);
      return;
    }
    const pointer = getPointer(event);
    const context = drawContextRef.current;
    if (context) {
      const delta = (pointer.x - drag.startX) / context.scale;
      if (Math.abs(delta) >= 1) {
        if (drag.kind === "sidebearing") {
          onSidebearingChange(drag.glyphName, drag.side, Math.round(drag.startValue + delta));
        } else {
          onKerningChange(drag.left, drag.right, Math.round(drag.startValue + delta));
        }
      }
    }
    setDrag(undefined);
  };

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className={`glyph-canvas ${settings.blur ? "is-blurred" : ""} ${settings.flip ? "is-flipped" : ""} ${spaceDown ? "can-pan" : ""} ${drag?.kind === "pan" ? "is-panning" : ""}`}
        style={{
          filter: settings.blur ? `blur(${settings.blur}px)` : undefined,
          transform: settings.flip ? "scaleX(-1)" : undefined,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(undefined)}
      />
      {mode !== "proof" && (
        <div className="canvas-hint">
          {mode === "spacing"
            ? "Drag a blue sidebearing line to edit · drag empty space to pan"
            : mode === "kerning"
              ? "Click or drag a pair gap to edit · drag empty space to pan"
              : "Drag empty space to pan · Ctrl+wheel to zoom"}
          {" · Ctrl+wheel zoom · 0 reset · "}
          {Math.round(settings.zoom * view.zoom * 100)}%
        </div>
      )}
    </div>
  );
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  project: FontProject,
  context: DrawContext,
  settings: AppSettings
) {
  if (!settings.showGuides) return;
  const { scale, originX, baselineY, width } = context;
  const lines = [
    { y: project.ascender, label: "ascender", strong: false },
    { y: project.capHeight, label: "cap", strong: false },
    { y: project.xHeight, label: "x-height", strong: true },
    { y: 0, label: "baseline", strong: true },
    { y: project.descender, label: "descender", strong: false },
  ];
  ctx.save();
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "bottom";
  for (const line of lines) {
    const y = baselineY - line.y * scale;
    if (y < -100 || y > context.height + 100) continue;
    ctx.strokeStyle = line.strong ? COLORS.guideStrong : COLORS.guide;
    ctx.lineWidth = line.strong ? 1.2 : 0.8;
    ctx.setLineDash(line.strong ? [] : [4, 6]);
    ctx.beginPath();
    ctx.moveTo(originX - 28, y);
    ctx.lineTo(width - 20, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.guideStrong;
    ctx.fillText(line.label, 8, y - 3);
  }
  ctx.restore();
}

function drawProject(
  ctx: CanvasRenderingContext2D,
  project: FontProject,
  text: string,
  context: DrawContext,
  settings: AppSettings,
  selectedGlyph: string,
  drag: DragState,
  color: string,
  alpha: number,
  interactive: boolean
) {
  const layout = layoutText(project, text || "nnoo", {
    applyKerning: true,
    applyTracking: settings.mode === "tracking",
  });
  const { scale, originX, baselineY } = context;
  let kerningPreview = 0;
  let kerningLeftIndex = -1;
  if (drag?.kind === "kerning") {
    kerningPreview = drag.delta;
    kerningLeftIndex = drag.leftIndex;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  for (const [itemIndex, item] of layout.items.entries()) {
    const shift =
      kerningPreview && itemIndex > kerningLeftIndex ? kerningPreview : 0;
    const x = originX + (item.x + shift) * scale;
    drawAdvanceBox(ctx, item, x, context, settings, color, interactive);
    if (settings.spacingOnly) continue;
    const isSelected = interactive && item.glyph.name === selectedGlyph;
    ctx.save();
    ctx.translate(x, baselineY);
    ctx.scale(scale, -scale);
    for (const path of glyphPaths(item.glyph)) {
      ctx.fillStyle = isSelected ? COLORS.selectedInk : color;
      ctx.fill(path, "evenodd");
    }
    ctx.restore();
  }
  ctx.restore();

  if (interactive && settings.showKerning) {
    drawKerningIndicators(ctx, layout, context, color);
  }
  if (interactive && settings.showMetrics) {
    drawMetrics(ctx, layout, context, selectedGlyph);
  }
}

function drawAdvanceBox(
  ctx: CanvasRenderingContext2D,
  item: LayoutItem,
  x: number,
  context: DrawContext,
  settings: AppSettings,
  color: string,
  interactive: boolean
) {
  if (!interactive) return;
  const { scale, baselineY } = context;
  const top = baselineY - (item.bounds?.maxY ?? 0) * scale;
  const bottom = baselineY - (item.bounds?.minY ?? 0) * scale;
  ctx.save();
  ctx.strokeStyle = settings.spacingOnly ? COLORS.box : "rgba(120,110,95,0.16)";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 5]);
  ctx.beginPath();
  ctx.moveTo(x, baselineY - 40);
  ctx.lineTo(x, baselineY + 40);
  ctx.moveTo(x + item.advance * scale, baselineY - 40);
  ctx.lineTo(x + item.advance * scale, baselineY + 40);
  ctx.stroke();
  ctx.setLineDash([]);
  if (settings.spacingOnly) {
    ctx.fillStyle = "rgba(80,70,58,0.12)";
    ctx.fillRect(x, top, item.advance * scale, bottom - top);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    const sb = sidebearingsOf(item.glyph);
    ctx.fillRect(x, top, Math.max(0, sb.left * scale), bottom - top);
    ctx.fillRect(
      x + (item.advance - sb.right) * scale,
      top,
      Math.max(0, sb.right * scale),
      bottom - top
    );
  }
  ctx.restore();
}

function drawMetrics(
  ctx: CanvasRenderingContext2D,
  layout: TextLayout,
  context: DrawContext,
  selectedGlyph: string
) {
  const { scale, originX, baselineY } = context;
  ctx.save();
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  for (const item of layout.items) {
    if (item.glyph.name !== selectedGlyph) continue;
    const sb = sidebearingsOf(item.glyph);
    const x = originX + item.x * scale;
    const y = baselineY - (item.bounds?.maxY ?? 0) * scale - 14;
    ctx.fillStyle = COLORS.guideStrong;
    ctx.fillText(`${item.glyph.name} · ${sb.advance}`, x + (item.advance * scale) / 2, y);
    ctx.fillStyle = COLORS.sidebearing;
    ctx.fillText(`${sb.left}`, x + (sb.left * scale) / 2, y + 13);
    ctx.fillText(`${sb.right}`, x + (item.advance - sb.right / 2) * scale, y + 13);
  }
  ctx.restore();
}

function drawKerningIndicators(
  ctx: CanvasRenderingContext2D,
  layout: TextLayout,
  context: DrawContext,
  color: string
) {
  const { scale, originX, baselineY } = context;
  ctx.save();
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  for (let i = 0; i < layout.items.length - 1; i++) {
    const left = layout.items[i];
    const right = layout.items[i + 1];
    const value = right.kerning;
    if (!value) continue;
    const x = originX + (right.x - value / 2) * scale;
    const y = baselineY + 30;
    ctx.strokeStyle = value < 0 ? COLORS.kerningNeg : COLORS.kerningPos;
    ctx.fillStyle = value < 0 ? COLORS.kerningNeg : COLORS.kerningPos;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, baselineY + 18);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.fillText(`${value > 0 ? "+" : ""}${value}`, x, y + 12);
  }
  ctx.restore();
}

function drawSelectedGlyphOverlay(
  ctx: CanvasRenderingContext2D,
  project: FontProject,
  item: LayoutItem,
  context: DrawContext,
  drag: DragState,
  measurementLine: number
) {
  const { scale, originX, baselineY } = context;
  const sb = sidebearingsOf(item.glyph);
  const x = originX + item.x * scale;
  const top = baselineY - project.ascender * scale;
  const bottom = baselineY - project.descender * scale;
  const dragDelta = drag?.kind === "sidebearing" ? drag.delta : 0;
  const leftValue = sb.left + (drag?.kind === "sidebearing" && drag.side === "left" ? dragDelta : 0);
  const rightValue = sb.right + (drag?.kind === "sidebearing" && drag.side === "right" ? dragDelta : 0);
  const leftX = x + leftValue * scale;
  const rightX = x + item.advance * scale - rightValue * scale;

  ctx.save();
  ctx.strokeStyle = COLORS.sidebearing;
  ctx.fillStyle = COLORS.sidebearing;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([]);
  for (const [lineX, value, label] of [
    [leftX, leftValue, "LSB"],
    [rightX, rightValue, "RSB"],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(lineX, top - 12);
    ctx.lineTo(lineX, bottom + 12);
    ctx.stroke();
    ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(`${label} ${Math.round(value)}`, lineX + 4, top - 18);
  }
  if (measurementLine > 0) {
    const y = baselineY - project.xHeight * measurementLine * scale;
    ctx.strokeStyle = "rgba(28,126,214,0.45)";
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x - 20, y);
    ctx.lineTo(x + item.advance * scale + 20, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  layout: TextLayout,
  context: DrawContext,
  selectedGlyph: string,
  mode: AppSettings["mode"],
  settings: AppSettings
) {
  const { width } = context;
  ctx.save();
  ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "rgba(90,82,70,0.8)";
  const label =
    mode === "spacing"
      ? "SPACING · sidebearings and rhythm"
      : mode === "kerning"
        ? "KERNING · pair corrections"
        : mode === "tracking"
          ? "TRACKING · uniform spacing"
          : mode === "qa"
            ? "QA · issue review"
            : "PROOF";
  ctx.fillText(label, 16, 22);
  ctx.textAlign = "right";
  ctx.fillText(`${layout.items.length} glyphs · UPM ${layout.em}`, width - 16, 22);
  ctx.restore();
}

function drawWaterfall(
  ctx: CanvasRenderingContext2D,
  project: FontProject,
  text: string,
  selectedGlyph: string,
  width: number,
  height: number,
  settings: AppSettings
) {
  const sizes = [10, 12, 14, 18, 24, 36, 56, 80];
  ctx.save();
  ctx.fillStyle = settings.theme === "dark" ? "#e9e4db" : "#26231f";
  let y = 40;
  for (const size of sizes) {
    const scale = size / project.unitsPerEm;
    const layout = layoutText(project, text || "nnoo", { applyKerning: true, applyTracking: true });
    const lineWidth = layout.totalWidth * scale;
    const fit = Math.min(1, (width - 80) / Math.max(1, lineWidth));
    const actualScale = scale * fit;
    ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "rgba(120,110,95,0.8)";
    ctx.fillText(`${size} px`, 12, y - 4);
    ctx.save();
    ctx.translate(58, y + size * 0.8);
    ctx.scale(actualScale, -actualScale);
    for (const item of layout.items) {
      ctx.save();
      ctx.translate(item.x, 0);
      for (const path of glyphPaths(item.glyph)) {
        ctx.fillStyle =
          item.glyph.name === selectedGlyph
            ? COLORS.selectedInk
            : settings.theme === "dark"
              ? "#e9e4db"
              : "#26231f";
        ctx.fill(path, "evenodd");
      }
      ctx.restore();
    }
    ctx.restore();
    y += size * 1.5 + 18;
    if (y > height - 20) break;
  }
  ctx.restore();
}
