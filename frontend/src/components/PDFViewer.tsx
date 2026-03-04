import React, { useRef, useEffect, useCallback, useState } from "react";
import type { BoxInfo, TextAnnotation } from "../types";
import { renderPage } from "../api/client";

interface PDFViewerProps {
  fileId: string | null;
  pageNum: number;
  boxes: Record<string, BoxInfo>;
  selectedColumn: string | null;
  onDrawBox: (box: BoxInfo) => void;
  /** Optional highlight box (absolute PDF coords) for BQ row navigation */
  highlightBox?: { x0: number; y0: number; x1: number; y1: number } | null;
  /** PDF page dimensions needed to convert absolute coords to relative */
  pdfPageSize?: { width: number; height: number } | null;
  /** Text annotations to display on the PDF (draggable overlays) */
  annotations?: TextAnnotation[];
  /** Callback when user drags an annotation to a new position */
  onAnnotationMove?: (annotationId: string, newX: number, newY: number) => void;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4.0;
const ZOOM_STEP = 0.05;
const RENDER_SCALE = 2.0;

export function PDFViewer({
  fileId,
  pageNum,
  boxes,
  selectedColumn,
  onDrawBox,
  highlightBox,
  pdfPageSize,
  annotations = [],
  onAnnotationMove,
}: PDFViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drawing, setDrawing] = useState<{
    startX: number; startY: number; curX: number; curY: number;
  } | null>(null);
  const [imgNatural, setImgNatural] = useState({ w: 0, h: 0 });

  // Fetch page image whenever file/page changes
  useEffect(() => {
    if (!fileId) { setImgSrc(null); return; }
    setLoading(true);
    setError(null);
    setPan({ x: 0, y: 0 });
    renderPage(fileId, pageNum, 2.0)
      .then((b64) => { setImgSrc(`data:image/png;base64,${b64}`); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, [fileId, pageNum]);

  // Redraw canvas: boxes + highlight (annotations are now DOM overlays)
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || imgNatural.w === 0) return;

    const displayW = imgNatural.w * zoom;
    const displayH = imgNatural.h * zoom;
    canvas.width = displayW;
    canvas.height = displayH;

    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, displayW, displayH);

    const drawBox = (box: BoxInfo, color: string, lineWidth: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash([]);
      ctx.strokeRect(box.x * displayW, box.y * displayH, box.width * displayW, box.height * displayH);
      ctx.fillStyle = color;
      ctx.font = `${Math.max(11, 13 * zoom)}px sans-serif`;
      ctx.fillText(box.column_name, box.x * displayW + 2, box.y * displayH - 3);
    };

    Object.values(boxes).forEach((box) => {
      const isSelected = box.column_name === selectedColumn;
      const boxColor = box.color || "#2980b9";
      drawBox(box, isSelected ? "#e74c3c" : boxColor, isSelected ? 2.5 : 1.5);
    });

    // Draw in-progress box
    if (drawing) {
      const x = Math.min(drawing.startX, drawing.curX);
      const y = Math.min(drawing.startY, drawing.curY);
      const w = Math.abs(drawing.curX - drawing.startX);
      const h = Math.abs(drawing.curY - drawing.startY);
      ctx.strokeStyle = "#e74c3c";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(x, y, w, h);
    }

    // Draw highlight box for BQ row navigation
    if (highlightBox && pdfPageSize && pdfPageSize.width > 0 && pdfPageSize.height > 0) {
      const rx = highlightBox.x0 / pdfPageSize.width;
      const ry = highlightBox.y0 / pdfPageSize.height;
      const rw = (highlightBox.x1 - highlightBox.x0) / pdfPageSize.width;
      const rh = (highlightBox.y1 - highlightBox.y0) / pdfPageSize.height;
      ctx.strokeStyle = "#f39c12";
      ctx.lineWidth = 3;
      ctx.setLineDash([]);
      ctx.strokeRect(rx * displayW, ry * displayH, rw * displayW, rh * displayH);
      ctx.fillStyle = "rgba(243, 156, 18, 0.15)";
      ctx.fillRect(rx * displayW, ry * displayH, rw * displayW, rh * displayH);
    }
  }, [boxes, selectedColumn, zoom, imgNatural, drawing, highlightBox, pdfPageSize]);

  // Ctrl+Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, parseFloat((z + delta * 4).toFixed(2)))));
  }, []);

  // Middle-mouse pan
  const pandStartRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 1) {
      e.preventDefault();
      pandStartRef.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
      return;
    }
    // Left-button: box drawing on canvas
    if (e.button !== 0 || !selectedColumn || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setDrawing({ startX: x, startY: y, curX: x, curY: y });
  }, [pan, selectedColumn]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (pandStartRef.current) {
      const dx = e.clientX - pandStartRef.current.mx;
      const dy = e.clientY - pandStartRef.current.my;
      setPan({ x: pandStartRef.current.px + dx, y: pandStartRef.current.py + dy });
      return;
    }
    if (!drawing || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setDrawing((prev) => prev ? { ...prev, curX: x, curY: y } : null);
  }, [drawing]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (pandStartRef.current) { pandStartRef.current = null; return; }
    if (!drawing || !canvasRef.current || !selectedColumn) { setDrawing(null); return; }
    const displayW = canvasRef.current.width;
    const displayH = canvasRef.current.height;
    if (displayW === 0 || displayH === 0) { setDrawing(null); return; }
    const x1 = Math.min(drawing.startX, drawing.curX) / displayW;
    const y1 = Math.min(drawing.startY, drawing.curY) / displayH;
    const w = Math.abs(drawing.curX - drawing.startX) / displayW;
    const h = Math.abs(drawing.curY - drawing.startY) / displayH;
    if (w > 0.005 && h > 0.005) {
      onDrawBox({ column_name: selectedColumn, x: x1, y: y1, width: w, height: h });
    }
    setDrawing(null);
  }, [drawing, selectedColumn, onDrawBox]);

  const imgLoaded = () => {
    if (imgRef.current) setImgNatural({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
  };

  // Coordinate conversion helpers
  const absToDisplayX = useCallback((absX: number) => {
    if (!pdfPageSize || pdfPageSize.width <= 0) return 0;
    return (absX / pdfPageSize.width) * imgNatural.w * zoom / RENDER_SCALE;
  }, [pdfPageSize, imgNatural.w, zoom]);

  const absToDisplayY = useCallback((absY: number) => {
    if (!pdfPageSize || pdfPageSize.height <= 0) return 0;
    return (absY / pdfPageSize.height) * imgNatural.h * zoom / RENDER_SCALE;
  }, [pdfPageSize, imgNatural.h, zoom]);

  const displayToAbsX = useCallback((dispX: number) => {
    if (!pdfPageSize || imgNatural.w <= 0) return 0;
    return (dispX / (imgNatural.w * zoom)) * pdfPageSize.width * RENDER_SCALE;
  }, [pdfPageSize, imgNatural.w, zoom]);

  const displayToAbsY = useCallback((dispY: number) => {
    if (!pdfPageSize || imgNatural.h <= 0) return 0;
    return (dispY / (imgNatural.h * zoom)) * pdfPageSize.height * RENDER_SCALE;
  }, [pdfPageSize, imgNatural.h, zoom]);

  const displayW = imgNatural.w * zoom;
  const displayH = imgNatural.h * zoom;

  // Whether annotations should be interactive (not when drawing boxes)
  const annotationsInteractive = !selectedColumn;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "#888" }}>
      {/* Zoom bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", background: "#555", color: "#fff", fontSize: 12 }}>
        <button style={iconBtn} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, parseFloat((z - 0.1).toFixed(2))))} title="Zoom out">−</button>
        <input
          type="number"
          style={{ width: 56, textAlign: "center", fontSize: 12, padding: "1px 2px" }}
          value={Math.round(zoom * 100)}
          min={Math.round(MIN_ZOOM * 100)}
          max={Math.round(MAX_ZOOM * 100)}
          step={5}
          onChange={(e) => setZoom(parseFloat(e.target.value) / 100)}
        />
        <span>%</span>
        <button style={iconBtn} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, parseFloat((z + 0.1).toFixed(2))))} title="Zoom in">+</button>
        <button style={iconBtn} onClick={() => { setZoom(1.0); setPan({ x: 0, y: 0 }); }} title="Reset">↺</button>
        <span style={{ marginLeft: "auto", opacity: 0.7 }}>
          {annotations.length > 0
            ? `📝 ${annotations.length} text overlays on page (drag to reposition)`
            : selectedColumn
              ? `Drawing box for: "${selectedColumn}"`
              : "Click a table cell to select a column"}
        </span>
      </div>

      {/* Page viewport */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: "hidden", position: "relative", cursor: selectedColumn ? "crosshair" : "default" }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setDrawing(null); pandStartRef.current = null; }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {loading && <div style={centeredOverlay}>Loading page...</div>}
        {error && <div style={{ ...centeredOverlay, color: "#f55" }}>{error}</div>}
        {!loading && !imgSrc && !error && (
          <div style={centeredOverlay}>Select a page from the tree to view it here</div>
        )}

        {imgSrc && (
          <div
            style={{
              position: "absolute",
              transform: `translate(${pan.x}px, ${pan.y}px)`,
              transformOrigin: "top left",
              userSelect: "none",
            }}
          >
            {/* Page image */}
            <img
              ref={imgRef}
              src={imgSrc}
              alt="PDF page"
              width={displayW}
              height={displayH}
              onLoad={imgLoaded}
              draggable={false}
              style={{ display: "block" }}
            />
            {/* Box overlay canvas */}
            <canvas
              ref={canvasRef}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                pointerEvents: "none",
                width: displayW,
                height: displayH,
              }}
            />
            {/* Draggable annotation overlays */}
            {pdfPageSize && pdfPageSize.width > 0 && annotations.map((ann) => (
              <DraggableAnnotation
                key={ann.id}
                annotation={ann}
                displayX={absToDisplayX(ann.x)}
                displayY={absToDisplayY(ann.y)}
                zoom={zoom}
                interactive={annotationsInteractive}
                onDragEnd={(newDispX, newDispY) => {
                  if (onAnnotationMove) {
                    onAnnotationMove(ann.id, displayToAbsX(newDispX), displayToAbsY(newDispY));
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Draggable Annotation Overlay ──────────────────────────────────────────

interface DraggableAnnotationProps {
  annotation: TextAnnotation;
  displayX: number;
  displayY: number;
  zoom: number;
  interactive: boolean;
  onDragEnd: (newDisplayX: number, newDisplayY: number) => void;
}

function DraggableAnnotation({
  annotation,
  displayX,
  displayY,
  zoom,
  interactive,
  onDragEnd,
}: DraggableAnnotationProps) {
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });
  const [hovered, setHovered] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number } | null>(null);

  const fontSize = (annotation.font_size ?? 10) * zoom;
  const isBold = annotation.bold;
  const color = annotation.color ?? "#0000FF";

  // Determine background color based on annotation type (from color hint)
  const bgColor = color === "#008000" || color === "green"
    ? "rgba(200, 255, 200, 0.85)"    // Green bg for page totals
    : color === "#0000FF" || color === "blue"
      ? "rgba(220, 230, 255, 0.85)"  // Blue bg for user edits
      : "rgba(255, 255, 220, 0.85)"; // Yellow bg for others

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!interactive) return;
    e.preventDefault();
    e.stopPropagation();
    dragStartRef.current = { mouseX: e.clientX, mouseY: e.clientY };
    setDragging(true);
    setOffset({ dx: 0, dy: 0 });

    const onMove = (ev: MouseEvent) => {
      if (!dragStartRef.current) return;
      setOffset({
        dx: ev.clientX - dragStartRef.current.mouseX,
        dy: ev.clientY - dragStartRef.current.mouseY,
      });
    };

    const onUp = (ev: MouseEvent) => {
      if (dragStartRef.current) {
        const dx = ev.clientX - dragStartRef.current.mouseX;
        const dy = ev.clientY - dragStartRef.current.mouseY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          onDragEnd(displayX + dx, displayY + dy);
        }
      }
      setDragging(false);
      setOffset({ dx: 0, dy: 0 });
      dragStartRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [interactive, displayX, displayY, onDragEnd]);

  const finalX = displayX + (dragging ? offset.dx : 0);
  const finalY = displayY + (dragging ? offset.dy : 0);

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { if (!dragging) setHovered(false); }}
      style={{
        position: "absolute",
        left: finalX,
        top: finalY - fontSize - 2,
        fontSize,
        lineHeight: 1.15,
        color,
        background: dragging
          ? "rgba(255, 255, 150, 0.95)"
          : hovered
            ? bgColor
            : bgColor.replace("0.85", "0.6"),
        border: `1px solid ${
          dragging ? "#e74c3c" : hovered ? color : "rgba(0,0,0,0.08)"
        }`,
        borderRadius: 2,
        padding: `${Math.max(1, 1.5 * zoom)}px ${Math.max(2, 3 * zoom)}px`,
        cursor: interactive ? (dragging ? "grabbing" : "grab") : "default",
        userSelect: "none",
        whiteSpace: "nowrap",
        zIndex: dragging ? 100 : hovered ? 50 : 10,
        fontFamily: "sans-serif",
        fontWeight: isBold ? 700 : 400,
        boxShadow: dragging
          ? "0 3px 10px rgba(0,0,0,0.35)"
          : hovered
            ? "0 1px 4px rgba(0,0,0,0.2)"
            : "none",
        transition: dragging
          ? "none"
          : "box-shadow 0.15s, background 0.15s, border-color 0.15s",
        pointerEvents: interactive ? "auto" : "none",
        letterSpacing: "0.02em",
      }}
      title={interactive ? "拖曳以移動位置" : ""}
    >
      {annotation.text}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const iconBtn: React.CSSProperties = {
  padding: "1px 8px",
  border: "1px solid #888",
  borderRadius: 3,
  background: "#666",
  color: "#fff",
  cursor: "pointer",
  fontSize: 14,
};

const centeredOverlay: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#fff",
  fontSize: 14,
};
