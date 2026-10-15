import { useEffect, useMemo, useRef, useState } from "react";
import { MapSchema, SetTilesCommand, exportTiled, floodCells, lineCells, planAutotile, rectCells, stampCells, type Layer, type MapData, type Point } from "@mse/core";
import { LayersCommand } from "../lib/commands";
import { buildFrameArt, buildTileArt, placeholderColor } from "../lib/tiles";
import { Icon, type IconName } from "../components/Icon";
import { Doc, useDoc } from "../state/doc";
import { fs, store, useProject } from "../state/project";
import { useUi } from "../state/ui";

type Tool = "brush" | "terrain" | "eraser" | "line" | "rect" | "fill" | "picker" | "entity";

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: "brush", label: "Brush", key: "b" },
  { id: "terrain", label: "Terrain", key: "t" },
  { id: "eraser", label: "Eraser", key: "e" },
  { id: "line", label: "Line", key: "l" },
  { id: "rect", label: "Rect", key: "r" },
  { id: "fill", label: "Fill", key: "g" },
  { id: "picker", label: "Pick", key: "i" },
  { id: "entity", label: "Entity", key: "n" },
];

const TOOL_ICON: Record<Tool, IconName> = { brush: "pencil", terrain: "terrain", eraser: "eraser", line: "line", rect: "rect", fill: "fill", picker: "picker", entity: "entity" };

interface View {
  zoom: number;
  ox: number;
  oy: number;
}

export function MapView() {
  const mapId = useUi((s) => s.mapId);
  const setMapId = useUi((s) => s.setMapId);
  const { maps, tilesets, sheets, images, animations, project, externalRev } = useProject();
  const [doc, setDoc] = useState<Doc<MapData>>();
  const docId = useRef<string>();
  const seenRev = useRef(0);

  const [tool, setTool] = useState<Tool>("brush");
  const [tile, setTile] = useState(1);
  const [sel, setSel] = useState({ a: 0, b: 0 }); // palette selection (anchor, other corner), 0-based tile indices
  const [terrainName, setTerrainName] = useState<string>();
  const [layerId, setLayerId] = useState<string>();
  const [hover, setHover] = useState<Point>();
  const [selEntity, setSelEntity] = useState<string>();
  const [entityType, setEntityType] = useState("npc");
  const [form, setForm] = useState({ id: "", name: "", w: 20, h: 15, tilesetId: "" });
  const [layerForm, setLayerForm] = useState<{ kind: "tile" | "object" | "collision"; name: string }>({ kind: "tile", name: "" });
  const [error, setError] = useState<string>();

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ zoom: 2, ox: 16, oy: 16 });
  const stroke = useRef<{ key: string; last: Point; start: Point; erase: boolean } | null>(null);
  const pan = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const preview = useRef<Point[]>([]);
  const spaceDown = useRef(false);
  const [, force] = useState(0);
  const redraw = () => force((n) => n + 1);

  useDoc(doc);

  // Open the selected map. Our own saves must not reset undo history; only reload for a new map or an external edit.
  useEffect(() => {
    if (!mapId) return setDoc(undefined);
    const src = useProject.getState().maps[mapId];
    if (!src) return;
    const same = docId.current === mapId && doc;
    if (same && (doc.isDirty || externalRev === seenRev.current)) return;
    seenRev.current = externalRev;
    void doc?.flush();
    docId.current = mapId;
    const copy = structuredClone(src);
    setDoc(
      new Doc(copy, async (m) => {
        await store.saveMap(m);
        useProject.setState((s) => ({ maps: { ...s.maps, [m.id]: structuredClone(m) } }));
      }),
    );
    setLayerId(copy.layers.find((l) => l.kind === "tile")?.id ?? copy.layers[0]?.id);
    setSelEntity(undefined);
    const wrap = wrapRef.current;
    const z = wrap ? Math.max(1, Math.min(8, Math.floor(Math.min(wrap.clientWidth / (copy.width * copy.tileSize), wrap.clientHeight / (copy.height * copy.tileSize)) * 4) / 4)) : 2;
    view.current = { zoom: z, ox: 16, oy: 16 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, maps, externalRev]);

  useEffect(() => () => void doc?.flush(), [doc]);

  const map = doc?.data;
  const layer: Layer | undefined = map?.layers.find((l) => l.id === layerId);
  const firstTile = map?.layers.find((l) => l.kind === "tile");
  const tilesetId = layer?.kind === "tile" ? layer.tilesetId : firstTile?.kind === "tile" ? firstTile.tilesetId : undefined;
  const tileset = tilesetId ? tilesets[tilesetId] : undefined;
  const art = useMemo(
    () => buildTileArt(tileset, tileset ? sheets[tileset.sheetId] : undefined, tileset ? images[tileset.sheetId] : undefined),
    [tileset, sheets, images],
  );
  // The palette mirrors the sheet's grid when the tileset is the sheet's frames in order, so a dragged block is a real block of art.
  const tsSheet = tileset ? sheets[tileset.sheetId] : undefined;
  const tsImage = tileset ? images[tileset.sheetId] : undefined;
  const cols = useMemo(() => {
    const n = tileset?.tiles.length ?? 1;
    if (tileset && tsSheet?.frameWidth && tsImage && tileset.tiles.every((t, i) => t.frameId === tsSheet.frames[i]?.id)) {
      return Math.max(1, Math.floor((tsImage.width - 2 * tsSheet.margin + tsSheet.spacing) / (tsSheet.frameWidth + tsSheet.spacing)));
    }
    return Math.max(1, Math.min(8, n));
  }, [tileset, tsSheet, tsImage]);
  const stampRows = useMemo(() => {
    const n = tileset?.tiles.length ?? 0;
    const [c0, c1] = [Math.min(sel.a % cols, sel.b % cols), Math.max(sel.a % cols, sel.b % cols)];
    const [r0, r1] = [Math.min(Math.floor(sel.a / cols), Math.floor(sel.b / cols)), Math.max(Math.floor(sel.a / cols), Math.floor(sel.b / cols))];
    const rows: number[][] = [];
    for (let r = r0; r <= r1; r++) {
      const row: number[] = [];
      for (let c = c0; c <= c1; c++) row.push(r * cols + c < n ? r * cols + c + 1 : 0);
      rows.push(row);
    }
    return rows;
  }, [sel, cols, tileset]);
  const isStamp = stampRows.length > 1 || (stampRows[0]?.length ?? 1) > 1;
  const terrains = useMemo(() => [...new Set((tileset?.tiles ?? []).map((t) => t.terrain).filter((t): t is string => !!t))], [tileset]);
  const terrain = terrainName && terrains.includes(terrainName) ? terrainName : terrains[0];

  // Entity animations: frames cropped once per sheet/animation change.
  const animArt = useMemo(() => {
    const out = new Map<string, { frames: { canvas: HTMLCanvasElement; durationMs: number }[]; total: number; loop: boolean }>();
    for (const a of Object.values(animations)) {
      const art = buildFrameArt(sheets[a.sheetId], images[a.sheetId]);
      const frames = a.frames.flatMap((f) => (art.get(f.frameId) ? [{ canvas: art.get(f.frameId)!.canvas, durationMs: f.durationMs }] : []));
      if (frames.length) out.set(a.id, { frames, total: frames.reduce((t, f) => t + f.durationMs, 0), loop: a.loop });
    }
    return out;
  }, [animations, sheets, images]);
  const hasAnimated = !!map?.layers.some((l) => l.kind === "object" && l.visible && l.entities.some((e) => typeof e.props.animation === "string" && animArt.has(e.props.animation)));

  // Art for every tileset used by the map (layers may differ).
  const artByTileset = useMemo(() => {
    const out = new Map<string, ReturnType<typeof buildTileArt>>();
    for (const l of map?.layers ?? []) {
      if (l.kind !== "tile" || out.has(l.tilesetId)) continue;
      const ts = tilesets[l.tilesetId];
      out.set(l.tilesetId, buildTileArt(ts, ts ? sheets[ts.sheetId] : undefined, ts ? images[ts.sheetId] : undefined));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map?.layers.map((l) => (l.kind === "tile" ? l.tilesetId : "")).join(), tilesets, sheets, images]);

  // ---- rendering -------------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#1b1b1f";
    ctx.fillRect(0, 0, cw, ch);
    if (!map) return;

    const { zoom, ox, oy } = view.current;
    const cs = map.tileSize * zoom;
    // Only the visible cell range is drawn, so large maps stay fast.
    const x0 = Math.max(0, Math.floor(-ox / cs)), x1 = Math.min(map.width, Math.ceil((cw - ox) / cs));
    const y0 = Math.max(0, Math.floor(-oy / cs)), y1 = Math.min(map.height, Math.ceil((ch - oy) / cs));

    ctx.fillStyle = "#2a2a31";
    ctx.fillRect(ox, oy, map.width * cs, map.height * cs);

    for (const l of map.layers) {
      if (!l.visible) continue;
      ctx.globalAlpha = l.id === layerId || !layerId ? 1 : 0.85;
      if (l.kind === "tile") {
        const tiles = artByTileset.get(l.tilesetId) ?? [];
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const v = l.data[y * map.width + x]!;
            if (!v) continue;
            const a = tiles[v - 1];
            if (a) ctx.drawImage(a.canvas, ox + x * cs, oy + y * cs, cs, cs);
            else {
              ctx.fillStyle = placeholderColor(v);
              ctx.fillRect(ox + x * cs, oy + y * cs, cs, cs);
            }
          }
      } else if (l.kind === "collision") {
        ctx.fillStyle = "rgba(255,60,60,0.35)";
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) if (l.data[y * map.width + x]) ctx.fillRect(ox + x * cs, oy + y * cs, cs, cs);
      } else {
        const now = performance.now();
        for (const e of l.entities) {
          const sx = ox + e.x * zoom, sy = oy + e.y * zoom;
          const an = typeof e.props.animation === "string" ? animArt.get(e.props.animation) : undefined;
          if (an) {
            // bottom-centre anchored, like the MCP preview and the exported data expect
            let t = an.loop ? now % an.total : Math.min(now, an.total - 1);
            const fr = an.frames.find((f) => (t -= f.durationMs) < 0) ?? an.frames[an.frames.length - 1]!;
            const w = fr.canvas.width * zoom, h = fr.canvas.height * zoom;
            ctx.drawImage(fr.canvas, Math.round(sx - w / 2), Math.round(sy - h), w, h);
            if (e.id !== selEntity && tool !== "entity") continue; // no marker clutter unless relevant
          }
          ctx.strokeStyle = e.id === selEntity ? "#fff" : "#ffe14d";
          ctx.lineWidth = 2;
          ctx.strokeRect(sx - 6, sy - 6, 12, 12);
          ctx.beginPath();
          ctx.moveTo(sx - 9, sy), ctx.lineTo(sx + 9, sy), ctx.moveTo(sx, sy - 9), ctx.lineTo(sx, sy + 9);
          ctx.stroke();
          ctx.fillStyle = "#ffe14d";
          ctx.font = "11px system-ui";
          ctx.fillText(e.type, sx + 9, sy - 8);
        }
      }
    }
    ctx.globalAlpha = 1;

    if (cs >= 8) {
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) (ctx.moveTo(ox + x * cs + 0.5, oy + y0 * cs), ctx.lineTo(ox + x * cs + 0.5, oy + y1 * cs));
      for (let y = y0; y <= y1; y++) (ctx.moveTo(ox + x0 * cs, oy + y * cs + 0.5), ctx.lineTo(ox + x1 * cs, oy + y * cs + 0.5));
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.strokeRect(ox + 0.5, oy + 0.5, map.width * cs, map.height * cs);

    if (preview.current.length) {
      ctx.fillStyle = "rgba(120,200,255,0.45)";
      for (const p of preview.current) if (p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height) ctx.fillRect(ox + p.x * cs, oy + p.y * cs, cs, cs);
    }
    if (hover && tool === "brush" && layer?.kind === "tile" && !stroke.current) {
      ctx.globalAlpha = 0.6;
      for (const c of stampCells(map.width, map.height, hover.x, hover.y, stampRows)) {
        const a = art[c.value - 1];
        if (a) ctx.drawImage(a.canvas, ox + (c.index % map.width) * cs, oy + Math.floor(c.index / map.width) * cs, cs, cs);
      }
      ctx.globalAlpha = 1;
    }
    if (hover && hover.x >= 0 && hover.y >= 0 && hover.x < map.width && hover.y < map.height) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + hover.x * cs + 1, oy + hover.y * cs + 1, cs - 2, cs - 2);
    }
  });

  // Keep repainting only while something on the map animates.
  useEffect(() => {
    if (!hasAnimated || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(redraw, 66);
    return () => clearInterval(t);
  }, [hasAnimated]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(redraw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [doc]);

  // ---- input -----------------------------------------------------------------------------
  const cellAt = (e: { clientX: number; clientY: number }): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    const { zoom, ox, oy } = view.current;
    const cs = map!.tileSize * zoom;
    return { x: Math.floor((e.clientX - r.left - ox) / cs), y: Math.floor((e.clientY - r.top - oy) / cs) };
  };
  const pixelAt = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const { zoom, ox, oy } = view.current;
    return { x: (e.clientX - r.left - ox) / zoom, y: (e.clientY - r.top - oy) / zoom };
  };

  const paintable = layer && (layer.kind === "tile" || layer.kind === "collision") && layer.visible && !layer.locked;
  const paintValue = tool === "eraser" ? 0 : layer?.kind === "collision" ? 1 : tile;

  const paint = (pts: Point[], value: number, key?: string) => {
    if (!doc || !map || !layer || (layer.kind !== "tile" && layer.kind !== "collision")) return;
    const seen = new Set<number>();
    const cells: { index: number; value: number }[] = [];
    for (const p of pts) {
      if (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) continue;
      const index = p.y * map.width + p.x;
      if (seen.has(index) || layer.data[index] === value) continue;
      seen.add(index);
      cells.push({ index, value });
    }
    if (cells.length) doc.exec(new SetTilesCommand(layer.id, cells, key));
  };

  const inBounds = (p: Point) => !!map && p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height;
  const paintTerrain = (pts: Point[], erase: boolean, key: string) => {
    if (!doc || !map || layer?.kind !== "tile" || !tileset) return;
    if (!erase && !terrain) return setError("This tileset has no terrain tiles. Give tiles a terrain and mask in Assets → Tilesets.");
    try {
      const idx = pts.filter(inBounds).map((p) => p.y * map.width + p.x);
      const changes = planAutotile(layer.data, map.width, map.height, tileset, erase ? null : terrain!, idx);
      if (changes.length) doc.exec(new SetTilesCommand(layer.id, changes, key));
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const stampAt = (p: Point, key: string) => {
    if (!doc || !map || layer?.kind !== "tile") return;
    const cells = stampCells(map.width, map.height, p.x, p.y, stampRows).filter((c) => layer.data[c.index] !== c.value);
    if (cells.length) doc.exec(new SetTilesCommand(layer.id, cells, key));
  };

  const onDown = (e: React.PointerEvent) => {
    if (!doc || !map) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || spaceDown.current) {
      pan.current = { x: e.clientX, y: e.clientY, ox: view.current.ox, oy: view.current.oy };
      return;
    }
    if (e.button !== 0) return;
    const p = cellAt(e);

    if (tool === "entity") {
      if (layer?.kind !== "object" || layer.locked) return setError("Select an unlocked object layer to place entities");
      setError(undefined);
      const px = pixelAt(e);
      const hit = layer.entities.find((en) => Math.hypot(en.x - px.x, en.y - px.y) * view.current.zoom < 10);
      if (hit) return setSelEntity(hit.id);
      if (p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) return;
      const n = layer.entities.filter((en) => en.type === entityType).length + 1;
      let id = `${entityType}_${n}`;
      while (layer.entities.some((en) => en.id === id)) id += "_";
      const x = (p.x + 0.5) * map.tileSize, y = (p.y + 0.5) * map.tileSize;
      doc.exec(new LayersCommand("Place entity", (m) => {
        const l = m.layers.find((x) => x.id === layer.id);
        if (l?.kind === "object") l.entities.push({ id, type: entityType, x, y, props: {} });
      }));
      return setSelEntity(id);
    }

    if (tool === "picker") {
      if (layer && layer.kind !== "object" && p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height) {
        const v = layer.data[p.y * map.width + p.x]!;
        if (v) (setTile(v), setSel({ a: v - 1, b: v - 1 }));
      }
      return;
    }
    if (!paintable) return setError(layer ? "Layer is locked, hidden, or not a tile/collision layer" : "No layer selected");
    setError(undefined);

    if (tool === "fill") {
      const layerData = (layer as { data: number[] }).data;
      paint(floodCells(map.width, map.height, (i) => layerData[i]!, p).map((i) => ({ x: i % map.width, y: Math.floor(i / map.width) })), paintValue);
      return;
    }
    if (tool === "terrain" && layer?.kind !== "tile") return setError("Terrain paints on tile layers");
    stroke.current = { key: `s${performance.now()}`, last: p, start: p, erase: e.shiftKey };
    if (tool === "terrain") paintTerrain([p], e.shiftKey, stroke.current.key);
    else if (tool === "brush" && isStamp && layer?.kind === "tile") stampAt(p, stroke.current.key);
    else if (tool === "brush" || tool === "eraser") paint([p], paintValue, stroke.current.key);
    else {
      preview.current = [p];
      redraw();
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!map) return;
    if (pan.current) {
      view.current.ox = pan.current.ox + e.clientX - pan.current.x;
      view.current.oy = pan.current.oy + e.clientY - pan.current.y;
      return redraw();
    }
    const p = cellAt(e);
    if (p.x !== hover?.x || p.y !== hover?.y) setHover(p);
    const s = stroke.current;
    if (!s) return;
    if (tool === "terrain") {
      paintTerrain(lineCells(s.last, p), s.erase, s.key);
      s.last = p;
    } else if (tool === "brush" && isStamp && layer?.kind === "tile") {
      lineCells(s.last, p).forEach((c) => stampAt(c, s.key));
      s.last = p;
    } else if (tool === "brush" || tool === "eraser") {
      paint(lineCells(s.last, p), paintValue, s.key);
      s.last = p;
    } else if (tool === "line") {
      preview.current = lineCells(s.start, p);
      redraw();
    } else if (tool === "rect") {
      preview.current = rectCells(s.start, p, !e.shiftKey);
      redraw();
    }
  };

  const onUp = () => {
    pan.current = null;
    const s = stroke.current;
    stroke.current = null;
    if (s && (tool === "line" || tool === "rect")) {
      const pts = preview.current;
      preview.current = [];
      paint(pts, paintValue);
      redraw();
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const v = view.current;
    const r = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const nz = Math.max(0.25, Math.min(16, v.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    // Keep the point under the cursor fixed while zooming.
    v.ox = mx - ((mx - v.ox) / v.zoom) * nz;
    v.oy = my - ((my - v.oy) / v.zoom) * nz;
    v.zoom = nz;
    redraw();
  };
  useEffect(() => {
    const c = canvasRef.current;
    c?.addEventListener("wheel", onWheel, { passive: false });
    return () => c?.removeEventListener("wheel", onWheel);
  }, [doc]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") {
        spaceDown.current = true;
        e.preventDefault();
        return;
      }
      if (!doc) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? doc.redo() : doc.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doc.redo();
      } else if (!mod) {
        const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
        if (t) setTool(t.id);
        if ((e.key === "Delete" || e.key === "Backspace") && selEntity) removeEntity(selEntity);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && (spaceDown.current = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => (window.removeEventListener("keydown", down), window.removeEventListener("keyup", up));
  });

  // ---- map / layer / entity actions ------------------------------------------------------
  const createMap = async () => {
    const id = form.id.trim();
    if (!/^[a-z0-9_-]+$/i.test(id)) return setError("Id may only contain letters, numbers, - and _");
    if (maps[id]) return setError(`Map "${id}" already exists`);
    const tsId = form.tilesetId || Object.keys(tilesets)[0];
    if (!tsId) return setError("Create a tileset in Assets first");
    const parsed = MapSchema.safeParse({
      id,
      name: form.name || id,
      width: form.w,
      height: form.h,
      tileSize: project?.tileSize ?? 16,
      layers: [{ id: "ground", name: "Ground", kind: "tile", tilesetId: tsId, data: new Array(form.w * form.h).fill(0) }],
    });
    if (!parsed.success) return setError(parsed.error.issues.map((i) => i.message).join("; "));
    try {
      await store.saveMap(parsed.data);
      await useProject.getState().load();
      setError(undefined);
      setMapId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addLayer = () => {
    if (!doc || !map) return;
    const name = layerForm.name.trim() || `${layerForm.kind}_${map.layers.length + 1}`;
    let id = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
    while (map.layers.some((l) => l.id === id)) id += "_";
    const n = map.width * map.height;
    const tsId = tilesetId ?? Object.keys(tilesets)[0];
    if (layerForm.kind === "tile" && !tsId) return setError("No tileset available for a tile layer");
    doc.exec(new LayersCommand("Add layer", (m) => {
      const base = { id, name, visible: true, locked: false };
      if (layerForm.kind === "tile") m.layers.push({ ...base, kind: "tile", tilesetId: tsId!, data: new Array(n).fill(0) });
      else if (layerForm.kind === "collision") m.layers.push({ ...base, kind: "collision", data: new Array(n).fill(0) });
      else m.layers.push({ ...base, kind: "object", entities: [] });
    }));
    setLayerId(id);
    setLayerForm({ ...layerForm, name: "" });
  };

  const editLayers = (label: string, fn: (layers: MapData["layers"]) => void) => doc?.exec(new LayersCommand(label, (m) => fn(m.layers)));

  const removeEntity = (id: string) => {
    if (layer?.kind !== "object") return;
    editLayers("Delete entity", (ls) => {
      const l = ls.find((x) => x.id === layer.id);
      if (l?.kind === "object") l.entities = l.entities.filter((e) => e.id !== id);
    });
    setSelEntity(undefined);
  };

  const entity = layer?.kind === "object" ? layer.entities.find((e) => e.id === selEntity) : undefined;
  const applyEntity = (data: FormData) => {
    if (!entity || layer?.kind !== "object") return;
    let props: Record<string, unknown>;
    try {
      props = JSON.parse(String(data.get("props") || "{}"));
      if (typeof props !== "object" || props === null || Array.isArray(props)) throw new Error();
    } catch {
      return setError("Props must be a JSON object");
    }
    const anim = String(data.get("animation") || "");
    if (anim) props.animation = anim;
    else delete props.animation;
    const next = { id: String(data.get("id")).trim(), type: String(data.get("type")).trim(), x: Number(data.get("x")), y: Number(data.get("y")), props };
    if (!next.id || !next.type || Number.isNaN(next.x) || Number.isNaN(next.y)) return setError("id, type, x and y are required");
    if (next.id !== entity.id && layer.entities.some((e) => e.id === next.id)) return setError(`Entity id "${next.id}" already exists`);
    setError(undefined);
    editLayers("Edit entity", (ls) => {
      const l = ls.find((x) => x.id === layer.id);
      if (l?.kind === "object") l.entities = l.entities.map((e) => (e.id === entity.id ? next : e));
    });
    setSelEntity(next.id);
  };

  const [notice, setNotice] = useState<string>();
  const exportMap = async () => {
    if (!doc || !map) return;
    try {
      await doc.flush();
      const used = new Map(Object.entries(tilesets));
      const sizes = new Map(Object.entries(images).map(([id, im]) => [id, { width: im.width, height: im.height }]));
      const out = exportTiled(map, used, new Map(Object.entries(sheets)), sizes);
      await fs.writeText(`export/tiled/${map.id}.tmj`, JSON.stringify(out.map, null, 2) + "\n");
      for (const t of out.tilesets) await fs.writeText(`export/tiled/${t.file}`, JSON.stringify(t.json, null, 2) + "\n");
      setError(undefined);
      setNotice(`Exported export/tiled/${map.id}.tmj (+${out.tilesets.length} tileset)`);
    } catch (e) {
      setNotice(undefined);
      setError(`Export failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const tsList = Object.keys(tilesets);
  const layers = map ? [...map.layers].reverse() : [];

  return (
    <div className="view map">
      <aside className="side">
        <h3>Map</h3>
        <select value={mapId ?? ""} onChange={(e) => setMapId(e.target.value || undefined)}>
          <option value="">Select map…</option>
          {Object.keys(maps).map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
        <details>
          <summary>New map</summary>
          <input placeholder="id" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
          <input placeholder="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="row">
            <input type="number" value={form.w} onChange={(e) => setForm({ ...form, w: +e.target.value })} />×
            <input type="number" value={form.h} onChange={(e) => setForm({ ...form, h: +e.target.value })} />
          </div>
          <select value={form.tilesetId} onChange={(e) => setForm({ ...form, tilesetId: e.target.value })}>
            <option value="">Tileset…</option>
            {tsList.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
          <button onClick={createMap}>Create</button>
        </details>

        <h3>Tools</h3>
        <div className="tools">
          {TOOLS.map((t) => (
            <button key={t.id} className={tool === t.id ? "on" : ""} onClick={() => setTool(t.id)} title={`${t.label} (${t.key.toUpperCase()})`}><Icon name={TOOL_ICON[t.id]} size={18} /><span>{t.label}</span></button>
          ))}
        </div>
        {tool === "entity" && <input placeholder="entity type" value={entityType} onChange={(e) => setEntityType(e.target.value)} />}
        {tool === "terrain" && (
          terrains.length ? (
            <label>Terrain
              <select value={terrain} onChange={(e) => setTerrainName(e.target.value)}>
                {terrains.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          ) : <p className="muted">This tileset has no terrain tiles yet. Give tiles a terrain and a mask in Assets → Tilesets.</p>
        )}
        <p className="muted">
          {tool === "terrain" ? "Paint a terrain and edges fit themselves. Shift = erase it." : "Wheel = zoom · Space/right/middle drag = pan · Shift+Rect = outline"}
        </p>

        <div className="row">
          <button disabled={!doc?.history.canUndo} onClick={() => doc?.undo()}><Icon name="undo" size={15} /> Undo</button>
          <button disabled={!doc?.history.canRedo} onClick={() => doc?.redo()}><Icon name="redo" size={15} /> Redo</button>
        </div>
        {doc && <p className="muted">{doc.saveError ? `Save failed: ${doc.saveError}` : doc.isDirty ? "Saving…" : "Saved"}</p>}
        {error && <p className="error">{error}</p>}
        {notice && <p className="muted">{notice}</p>}
        {map && <button onClick={exportMap}><Icon name="export" size={15} /> Export Tiled (.tmj)</button>}

        {map && (
          <>
            <h3>Layers</h3>
            <ul className="layers">
              {layers.map((l) => {
                const idx = map.layers.findIndex((x) => x.id === l.id);
                return (
                  <li key={l.id} className={l.id === layerId ? "on" : ""} onClick={() => setLayerId(l.id)}>
                    <button title="Visible" onClick={(e) => (e.stopPropagation(), editLayers("Toggle visibility", (ls) => void (ls[idx]!.visible = !ls[idx]!.visible)))}>{l.visible ? "👁" : "–"}</button>
                    <button title="Locked" onClick={(e) => (e.stopPropagation(), editLayers("Toggle lock", (ls) => void (ls[idx]!.locked = !ls[idx]!.locked)))}>{l.locked ? "🔒" : "🔓"}</button>
                    <span className="grow">{l.name} <small>({l.kind})</small></span>
                    <button title="Up" disabled={idx === map.layers.length - 1} onClick={(e) => (e.stopPropagation(), editLayers("Move layer", (ls) => void ls.splice(idx + 1, 0, ls.splice(idx, 1)[0]!)))}>↑</button>
                    <button title="Down" disabled={idx === 0} onClick={(e) => (e.stopPropagation(), editLayers("Move layer", (ls) => void ls.splice(idx - 1, 0, ls.splice(idx, 1)[0]!)))}>↓</button>
                    <button title="Delete" disabled={map.layers.length === 1} onClick={(e) => (e.stopPropagation(), editLayers("Delete layer", (ls) => void ls.splice(idx, 1)), setLayerId(map.layers.find((x) => x.id !== l.id)?.id))}>✕</button>
                  </li>
                );
              })}
            </ul>
            <div className="row">
              <select value={layerForm.kind} onChange={(e) => setLayerForm({ ...layerForm, kind: e.target.value as any })}>
                <option value="tile">tile</option><option value="object">object</option><option value="collision">collision</option>
              </select>
              <input placeholder="name" value={layerForm.name} onChange={(e) => setLayerForm({ ...layerForm, name: e.target.value })} />
              <button onClick={addLayer}>Add</button>
            </div>
          </>
        )}

        {layer?.kind === "tile" && tileset && (
          <>
            <h3>Tiles ({tilesetId})</h3>
            <div className="tilegrid" style={{ gridTemplateColumns: `repeat(${cols}, 38px)` }}>
              {tileset.tiles.map((_, i) => {
                const [c, r] = [i % cols, Math.floor(i / cols)];
                const inSel = c >= Math.min(sel.a % cols, sel.b % cols) && c <= Math.max(sel.a % cols, sel.b % cols) &&
                  r >= Math.min(Math.floor(sel.a / cols), Math.floor(sel.b / cols)) && r <= Math.max(Math.floor(sel.a / cols), Math.floor(sel.b / cols));
                return (
                  <button
                    key={i}
                    className={inSel ? "on" : ""}
                    title={`Tile ${i + 1} (Shift+click to select a block)`}
                    onClick={(e) => (e.shiftKey ? setSel({ a: sel.a, b: i }) : (setSel({ a: i, b: i }), setTile(i + 1)))}
                  >
                    {art[i] ? <img src={art[i]!.url} alt={`tile ${i + 1}`} /> : <span style={{ background: placeholderColor(i + 1) }}>{i + 1}</span>}
                  </button>
                );
              })}
            </div>
            {isStamp && <p className="muted">Stamp {stampRows[0]!.length}×{stampRows.length}: the brush places this block.</p>}
          </>
        )}
        {layer?.kind === "collision" && <p className="muted">Collision layer: brush marks blocked cells.</p>}

        {entity && layer?.kind === "object" && (
          <>
            <h3>Entity</h3>
            <form
              key={entity.id + JSON.stringify(entity)}
              onSubmit={(e) => (e.preventDefault(), applyEntity(new FormData(e.currentTarget)))}
              className="entity-form"
            >
              <label>id <input name="id" defaultValue={entity.id} /></label>
              <label>type <input name="type" defaultValue={entity.type} /></label>
              <div className="row">
                <label>x <input name="x" type="number" defaultValue={entity.x} /></label>
                <label>y <input name="y" type="number" defaultValue={entity.y} /></label>
              </div>
              <label>animation
                <select name="animation" defaultValue={typeof entity.props.animation === "string" ? entity.props.animation : ""}>
                  <option value="">none</option>
                  {Object.keys(animations).map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              </label>
              <label>props (JSON) <textarea name="props" rows={4} defaultValue={JSON.stringify(entity.props, null, 2)} /></label>
              <div className="row">
                <button type="submit">Apply</button>
                <button type="button" onClick={() => removeEntity(entity.id)}>Delete</button>
              </div>
            </form>
          </>
        )}
      </aside>

      <main className="canvas-wrap map-canvas" ref={wrapRef}>
        {map ? (
          <canvas
            ref={canvasRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => setHover(undefined)}
            onContextMenu={(e) => e.preventDefault()}
          />
        ) : (
          <p className="empty muted">Select a map or create one to start editing.</p>
        )}
        {map && hover && <div className="statusbar">{hover.x},{hover.y} · {map.width}×{map.height} · zoom {view.current.zoom.toFixed(2)}×</div>}
      </main>
    </div>
  );
}
