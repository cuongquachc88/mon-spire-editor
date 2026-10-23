import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  SetPixelsCommand,
  createImage,
  floodCells,
  lineCells,
  rectCells,
  unpack,
  type PixelImage,
  type Point,
} from "@mse/core";
import { encodePng, hexToPacked, packedToHex, toImageData } from "../lib/image";
import { Icon, type IconName } from "../components/Icon";
import { Doc, useDoc } from "../state/doc";
import { fs, store, useProject } from "../state/project";
import { useUi } from "../state/ui";
import { ZOOM_LEVELS, fitZoom as fitZoomFor, maxZoomFor, nearestLevel, nextZoom, zoomLabel } from "../lib/zoom";

type Tool = "pencil" | "eraser" | "line" | "rect" | "fill" | "picker";

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: "pencil", label: "Pencil", key: "b" },
  { id: "eraser", label: "Eraser", key: "e" },
  { id: "line", label: "Line", key: "l" },
  { id: "rect", label: "Rect", key: "r" },
  { id: "fill", label: "Fill", key: "g" },
  { id: "picker", label: "Pick", key: "i" },
];

const TOOL_ICON: Record<Tool, IconName> = { pencil: "pencil", eraser: "eraser", line: "line", rect: "rect", fill: "fill", picker: "picker" };

const PALETTE = [
  "#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
  "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa",
];

function blockCells(p: Point, size: number): Point[] {
  const off = Math.floor((size - 1) / 2);
  const out: Point[] = [];
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) out.push({ x: p.x - off + dx, y: p.y - off + dy });
  return out;
}

export function PixelView() {
  const target = useUi((s) => s.pixelTarget);
  const sheets = useProject((s) => s.sheets);
  const images = useProject((s) => s.images);
  const externalRev = useProject((s) => s.externalRev);
  const [doc, setDoc] = useState<Doc<PixelImage>>();
  const docSheet = useRef<string>();
  const seenRev = useRef(0);

  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState(hexToPacked("#ff004d"));
  const [size, setSize] = useState(1);
  const [zoom, setZoom] = useState(16);
  const [showFrames, setShowFrames] = useState(true);
  const [mirrorX, setMirrorX] = useState(false);
  const [mirrorY, setMirrorY] = useState(false);
  const [tiled, setTiled] = useState(false);
  const tiledRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<Point>();
  const [newForm, setNewForm] = useState({ id: "", w: 16, h: 16 });
  const [error, setError] = useState<string>();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLElement>(null);
  /** Image point that must stay under the cursor (viewport offset cx,cy) while the zoom changes. */
  const anchor = useRef<{ ix: number; iy: number; cx: number; cy: number }>();
  const wheelAcc = useRef(0);
  const stroke = useRef<{ key: string; last: Point; start: Point } | null>(null);
  const preview = useRef<Point[]>([]);

  useDoc(doc);

  const fitZoom = (w: number, h: number) => {
    const el = wrapRef.current;
    return fitZoomFor(w, h, (el?.clientWidth ?? 680) - 40, (el?.clientHeight ?? 680) - 40);
  };
  /** Move to the next zoom step, keeping the image point under (clientX, clientY) fixed; no point = view centre. */
  const stepZoom = (dir: 1 | -1, at?: { x: number; y: number }) => {
    if (!doc) return;
    const next = nextZoom(zoom, dir, doc.data.width, doc.data.height);
    if (next !== undefined) setZoomAt(next, at);
  };
  const setZoomAt = (next: number, at?: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    const el = wrapRef.current;
    if (canvas && el) {
      const wr = el.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      const px = at?.x ?? wr.left + el.clientWidth / 2;
      const py = at?.y ?? wr.top + el.clientHeight / 2;
      anchor.current = { ix: (px - cr.left) / zoom, iy: (py - cr.top) / zoom, cx: px - wr.left, cy: py - wr.top };
    }
    setZoom(next);
  };

  const saveFor = useCallback(
    (sheetId: string, imagePath: string) => async (img: PixelImage) => {
      await fs.writeBinary(imagePath, await encodePng(img));
      if (!useProject.getState().sheets[sheetId]) {
        await store.saveSheet({ id: sheetId, image: imagePath, margin: 0, spacing: 0, frames: [] });
        await useProject.getState().load();
      } else {
        await useProject.getState().refreshImage(sheetId);
      }
    },
    [],
  );

  // Open the target asset; reload from disk after external changes when there is nothing unsaved.
  useEffect(() => {
    if (!target || target === "new") return;
    const sheet = sheets[target];
    const img = images[target];
    if (!sheet || !img) return;
    // Our own saves also change `images`; only reload for a new target or a genuine external edit.
    const sameDoc = docSheet.current === target && doc;
    if (sameDoc && (doc.isDirty || externalRev === seenRev.current)) return;
    seenRev.current = externalRev;
    void doc?.flush();
    const copy: PixelImage = { width: img.width, height: img.height, data: img.data.slice() };
    docSheet.current = target;
    setDoc(new Doc(copy, saveFor(target, sheet.image)));
    setZoom(fitZoom(img.width, img.height));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, sheets, images, externalRev]);

  useEffect(() => () => void doc?.flush(), [doc]);

  const createNew = () => {
    const id = newForm.id.trim();
    if (!/^[a-z0-9_-]+$/i.test(id)) return setError("Id may only contain letters, numbers, - and _");
    if (sheets[id]) return setError(`Asset "${id}" already exists`);
    if (newForm.w < 1 || newForm.h < 1 || newForm.w > 512 || newForm.h > 512) return setError("Size must be 1..512");
    setError(undefined);
    const d = new Doc(createImage(newForm.w, newForm.h), saveFor(id, `assets/${id}.png`));
    docSheet.current = id;
    useUi.setState({ pixelTarget: id });
    setDoc(d);
    setZoom(fitZoom(newForm.w, newForm.h));
    d.touch(); // write the blank file so the asset exists
  };

  // ---- rendering -------------------------------------------------------------------------
  const sheet = target ? sheets[target] : undefined;
  const version = doc?.getVersion();
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !doc) return;
    const { width, height } = doc.data;
    canvas.width = Math.max(1, Math.round(width * zoom));
    canvas.height = Math.max(1, Math.round(height * zoom));
    const zx = canvas.width / width;
    const zy = canvas.height / height;
    const el = wrapRef.current;
    const a = anchor.current;
    if (a && el) {
      anchor.current = undefined;
      el.scrollLeft = canvas.offsetLeft + a.ix * zx - a.cx;
      el.scrollTop = canvas.offsetTop + a.iy * zy - a.cy;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const off = new OffscreenCanvas(width, height);
    off.getContext("2d")!.putImageData(toImageData(doc.data), 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

    // Tool preview (shapes in progress)
    if (preview.current.length) {
      ctx.fillStyle = tool === "eraser" ? "rgba(255,255,255,0.5)" : packedToHex(color);
      for (const p of mirrorPts(preview.current, width, height)) ctx.fillRect(p.x * zx, p.y * zy, zx, zy);
    }
    if (zoom >= 8) {
      ctx.strokeStyle = "rgba(128,128,128,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= width; x++) (ctx.moveTo(x * zx + 0.5, 0), ctx.lineTo(x * zoom + 0.5, canvas.height));
      for (let y = 0; y <= height; y++) (ctx.moveTo(0, y * zy + 0.5), ctx.lineTo(canvas.width, y * zy + 0.5));
      ctx.stroke();
    }
    if (showFrames && sheet) {
      ctx.strokeStyle = "rgba(0,200,255,0.9)";
      for (const f of sheet.frames) ctx.strokeRect(f.rect.x * zx + 0.5, f.rect.y * zy + 0.5, f.rect.w * zx - 1, f.rect.h * zy - 1);
    }
    if (mirrorX || mirrorY) {
      ctx.strokeStyle = "rgba(255,122,107,0.9)"; // coral = the mirrored half
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      if (mirrorX) (ctx.moveTo(canvas.width / 2, 0), ctx.lineTo(canvas.width / 2, canvas.height));
      if (mirrorY) (ctx.moveTo(0, canvas.height / 2), ctx.lineTo(canvas.width, canvas.height / 2));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (hover && zx >= 3) {
      ctx.strokeStyle = "#fff";
      ctx.strokeRect(hover.x * zx + 0.5, hover.y * zy + 0.5, zx - 1, zy - 1);
    }
  }, [doc, version, zoom, hover, showFrames, sheet, color, tool, mirrorX, mirrorY]);

  // Seamless-tiling check: the image repeated 3x3, like Aseprite's tiled mode.
  useEffect(() => {
    const c = tiledRef.current;
    if (!c || !doc || !tiled) return;
    const { width, height } = doc.data;
    const sc = Math.max(1, Math.min(8, Math.floor(180 / Math.max(width, height))));
    c.width = width * 3 * sc;
    c.height = height * 3 * sc;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const off = new OffscreenCanvas(width, height);
    off.getContext("2d")!.putImageData(toImageData(doc.data), 0, 0);
    for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 3; tx++) ctx.drawImage(off, tx * width * sc, ty * height * sc, width * sc, height * sc);
  }, [doc, version, tiled]);

  // ---- tools -----------------------------------------------------------------------------
  const cellAt = (e: React.PointerEvent): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    const { width, height } = doc!.data;
    return { x: Math.floor(((e.clientX - r.left) / r.width) * width), y: Math.floor(((e.clientY - r.top) / r.height) * height) };
  };

  /** Add the mirrored copies of each point when symmetry is on (mirror axes are the image centre lines). */
  function mirrorPts(pts: Point[], w: number, h: number): Point[] {
    if (!mirrorX && !mirrorY) return pts;
    const out = [...pts];
    for (const p of pts) {
      if (mirrorX) out.push({ x: w - 1 - p.x, y: p.y });
      if (mirrorY) out.push({ x: p.x, y: h - 1 - p.y });
      if (mirrorX && mirrorY) out.push({ x: w - 1 - p.x, y: h - 1 - p.y });
    }
    return out;
  }

  const flip = (axis: "h" | "v") => {
    if (!doc) return;
    const { width, height, data } = doc.data;
    const cells: { index: number; value: number }[] = [];
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const v = data[(axis === "v" ? height - 1 - y : y) * width + (axis === "h" ? width - 1 - x : x)]!;
        if (v !== data[y * width + x]) cells.push({ index: y * width + x, value: v });
      }
    if (cells.length) doc.exec(new SetPixelsCommand(axis === "h" ? "Flip horizontally" : "Flip vertically", cells));
  };

  const paint = (d: Doc<PixelImage>, pts: Point[], value: number, key?: string) => {
    const { width, height, data } = d.data;
    const seen = new Set<number>();
    const cells: { index: number; value: number }[] = [];
    for (const p of mirrorPts(pts, width, height)) {
      if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) continue;
      const index = p.y * width + p.x;
      if (seen.has(index) || data[index] === value) continue;
      seen.add(index);
      cells.push({ index, value });
    }
    if (cells.length) d.exec(new SetPixelsCommand(tool, cells, key));
  };

  const onDown = (e: React.PointerEvent) => {
    if (!doc || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = cellAt(e);
    const { width, height, data } = doc.data;
    if (tool === "picker") {
      if (p.x >= 0 && p.y >= 0 && p.x < width && p.y < height) {
        const c = data[p.y * width + p.x]!;
        if (unpack(c).a > 0) setColor(c);
      }
      return;
    }
    if (tool === "fill") {
      paint(doc, floodCells(width, height, (i) => data[i]!, p).map((i) => ({ x: i % width, y: Math.floor(i / width) })), color);
      return;
    }
    stroke.current = { key: `s${performance.now()}`, last: p, start: p };
    if (tool === "pencil" || tool === "eraser") {
      paint(doc, blockCells(p, size), tool === "eraser" ? 0 : color, stroke.current.key);
    } else {
      preview.current = [p];
      doc.repaint();
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const p = cellAt(e);
    if (p.x !== hover?.x || p.y !== hover?.y) setHover(p);
    const s = stroke.current;
    if (!doc || !s) return;
    if (tool === "pencil" || tool === "eraser") {
      const pts = lineCells(s.last, p).flatMap((c) => blockCells(c, size));
      paint(doc, pts, tool === "eraser" ? 0 : color, s.key);
      s.last = p;
    } else if (tool === "line") {
      preview.current = lineCells(s.start, p);
      doc.repaint();
    } else if (tool === "rect") {
      preview.current = rectCells(s.start, p, e.shiftKey);
      doc.repaint();
    }
  };

  const onUp = () => {
    const s = stroke.current;
    stroke.current = null;
    if (!doc || !s) return;
    if (tool === "line" || tool === "rect") {
      const pts = preview.current.flatMap((c) => blockCells(c, size));
      preview.current = [];
      paint(doc, pts, color);
    }
  };

  // Shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || !doc) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? doc.redo() : doc.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doc.redo();
      } else if (!mod && (e.key === "+" || e.key === "=")) {
        stepZoom(1);
      } else if (!mod && e.key === "-") {
        stepZoom(-1);
      } else if (!mod && e.key === "0") {
        setZoomAt(fitZoom(doc.data.width, doc.data.height));
      } else if (!mod && e.key === "1") {
        setZoomAt(1);
      } else if (!mod) {
        const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
        if (t) setTool(t.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ⌘/Ctrl + wheel (and trackpad pinch, which reports Ctrl) zooms around the cursor; a plain wheel scrolls.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !doc) return;
      e.preventDefault();
      wheelAcc.current += e.deltaY;
      if (Math.abs(wheelAcc.current) < 40) return;
      const dir = wheelAcc.current < 0 ? 1 : -1;
      wheelAcc.current = 0;
      stepZoom(dir, { x: e.clientX, y: e.clientY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const sheetIds = useMemo(() => Object.keys(sheets), [sheets]);
  const swatches = useMemo(() => PALETTE.map(hexToPacked), []);

  return (
    <div className="view pixel">
      <aside className="side">
        <h3>Image</h3>
        <select value={target && target !== "new" ? target : ""} onChange={(e) => useUi.setState({ pixelTarget: e.target.value || undefined })}>
          <option value="">Select asset…</option>
          {sheetIds.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>

        <h3>New image</h3>
        <input placeholder="id" value={newForm.id} onChange={(e) => setNewForm({ ...newForm, id: e.target.value })} />
        <div className="row">
          <input type="number" value={newForm.w} onChange={(e) => setNewForm({ ...newForm, w: +e.target.value })} />
          ×
          <input type="number" value={newForm.h} onChange={(e) => setNewForm({ ...newForm, h: +e.target.value })} />
        </div>
        <button onClick={createNew}>Create</button>
        {error && <p className="error">{error}</p>}

        <h3>Tools</h3>
        <div className="tools">
          {TOOLS.map((t) => (
            <button key={t.id} className={tool === t.id ? "on" : ""} onClick={() => setTool(t.id)} title={`${t.label} (${t.key.toUpperCase()})`}>
              <Icon name={TOOL_ICON[t.id]} size={18} /><span>{t.label}</span>
            </button>
          ))}
        </div>
        <label>Brush {size}px <input type="range" min={1} max={8} value={size} onChange={(e) => setSize(+e.target.value)} /></label>
        <label>Zoom {zoomLabel(zoom)}
          <input
            type="range"
            min={0}
            max={ZOOM_LEVELS.length - 1}
            value={nearestLevel(zoom)}
            onChange={(e) => setZoomAt(Math.min(ZOOM_LEVELS[+e.target.value]!, doc ? maxZoomFor(doc.data.width, doc.data.height) : 64))}
          />
        </label>
        <div className="row zoom-row">
          <button disabled={!doc} onClick={() => stepZoom(-1)} title="Zoom out (-)" aria-label="Zoom out">−</button>
          <button disabled={!doc} onClick={() => stepZoom(1)} title="Zoom in (+)" aria-label="Zoom in">+</button>
          <button disabled={!doc} onClick={() => doc && setZoomAt(fitZoom(doc.data.width, doc.data.height))} title="Fit the image in the view (0)">Fit</button>
          <button disabled={!doc} onClick={() => setZoomAt(1)} title="Actual size (1)">1:1</button>
        </div>
        <p className="muted hint">⌘/Ctrl + scroll zooms at the cursor</p>
        <label><input type="checkbox" checked={showFrames} onChange={(e) => setShowFrames(e.target.checked)} /> Show frame grid</label>
        <h3>Symmetry and view</h3>
        <div className="row">
          <button className={mirrorX ? "on" : ""} onClick={() => setMirrorX(!mirrorX)} title="Mirror strokes left-right"><Icon name="mirror" size={15} /> Mirror X</button>
          <button className={mirrorY ? "on" : ""} onClick={() => setMirrorY(!mirrorY)} title="Mirror strokes top-bottom"><Icon name="flipv" size={15} /> Mirror Y</button>
        </div>
        <div className="row">
          <button disabled={!doc} onClick={() => flip("h")} title="Flip the whole image left-right">Flip ↔</button>
          <button disabled={!doc} onClick={() => flip("v")} title="Flip the whole image top-bottom">Flip ↕</button>
          <button className={tiled ? "on" : ""} onClick={() => setTiled(!tiled)} title="Preview the image repeated 3×3"><Icon name="grid" size={15} /> Tiled</button>
        </div>

        <h3>Color</h3>
        <input type="color" value={packedToHex(color)} onChange={(e) => setColor(hexToPacked(e.target.value))} />
        <div className="palette">
          {swatches.map((c) => (
            <button key={c} className={c === color ? "on" : ""} style={{ background: packedToHex(c) }} onClick={() => setColor(c)} />
          ))}
        </div>

        <div className="row">
          <button disabled={!doc?.history.canUndo} onClick={() => doc?.undo()}><Icon name="undo" size={15} /> Undo</button>
          <button disabled={!doc?.history.canRedo} onClick={() => doc?.redo()}><Icon name="redo" size={15} /> Redo</button>
        </div>
        {doc && <p className="muted">{doc.saveError ? `Save failed: ${doc.saveError}` : doc.isDirty ? "Saving…" : "Saved"}</p>}
      </aside>

      <main className="canvas-wrap" ref={wrapRef}>
        {doc ? (
          <div className="pixel-stage">
            <canvas
              ref={canvasRef}
              className="checker"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={() => setHover(undefined)}
            />
            {tiled && (
              <figure>
                <canvas ref={tiledRef} className="checker static" />
                <figcaption className="muted">Tiled 3×3: look for visible seams</figcaption>
              </figure>
            )}
          </div>
        ) : (
          <p className="empty muted">Select an asset or create a new image to start drawing.</p>
        )}
      </main>
    </div>
  );
}
