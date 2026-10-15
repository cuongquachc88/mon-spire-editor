import { useEffect, useMemo, useRef, useState } from "react";
import { exportAtlas, sliceGrid, type Animation, type Tileset } from "@mse/core";
import { confirmAsk } from "../lib/ask";
import { decodePng, toImageData } from "../lib/image";
import { buildFrameArt, type TileArt } from "../lib/tiles";
import { fs, store, useProject } from "../state/project";
import { useUi } from "../state/ui";

type Section = "sheets" | "tilesets" | "animations";

const ID_RE = /^[a-z0-9_-]+$/i;

export function AssetsView() {
  const [section, setSection] = useState<Section>("sheets");
  return (
    <div className="view assets">
      <nav className="subtabs">
        {(["sheets", "tilesets", "animations"] as Section[]).map((s) => (
          <button key={s} className={section === s ? "on" : ""} onClick={() => setSection(s)}>{s}</button>
        ))}
      </nav>
      {section === "sheets" && <Sheets />}
      {section === "tilesets" && <Tilesets />}
      {section === "animations" && <Animations />}
    </div>
  );
}

const reload = () => useProject.getState().load();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- Sheets ---------------------------------------------------------------------------------
function Sheets() {
  const { sheets, images, tilesets, animations } = useProject();
  const openPixel = useUi((s) => s.openPixel);
  const [sel, setSel] = useState<string>();
  const [grid, setGrid] = useState({ w: 16, h: 16, margin: 0, spacing: 0 });
  const [error, setError] = useState<string>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sheet = sel ? sheets[sel] : undefined;
  const image = sel ? images[sel] : undefined;
  const [zoom, setZoom] = useState(4);
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    if (sheet?.frameWidth) setGrid({ w: sheet.frameWidth, h: sheet.frameHeight ?? sheet.frameWidth, margin: sheet.margin, spacing: sheet.spacing });
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !image) return;
    c.width = image.width * zoom;
    c.height = image.height * zoom;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const off = new OffscreenCanvas(image.width, image.height);
    off.getContext("2d")!.putImageData(toImageData(image), 0, 0);
    ctx.drawImage(off, 0, 0, c.width, c.height);
    ctx.strokeStyle = "rgba(0,200,255,0.9)";
    for (const f of sheet?.frames ?? []) ctx.strokeRect(f.rect.x * zoom + 0.5, f.rect.y * zoom + 0.5, f.rect.w * zoom - 1, f.rect.h * zoom - 1);
  }, [image, sheet, zoom]);

  const importPng = async (file: File) => {
    try {
      const id = file.name.replace(/\.png$/i, "").replace(/[^a-z0-9_-]+/gi, "_");
      if (!ID_RE.test(id)) throw new Error("Could not derive a valid id from the file name");
      if (sheets[id]) throw new Error(`Sheet "${id}" already exists`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      await decodePng(bytes); // rejects non-images
      await fs.writeBinary(`assets/${id}.png`, bytes);
      await store.saveSheet({ id, image: `assets/${id}.png`, margin: 0, spacing: 0, frames: [] });
      await reload();
      setSel(id);
      setError(undefined);
    } catch (e) {
      setError(`Import failed: ${msg(e)}`);
    }
  };

  const slice = async () => {
    if (!sheet || !image) return;
    const frames = sliceGrid({ imageWidth: image.width, imageHeight: image.height, frameWidth: grid.w, frameHeight: grid.h, margin: grid.margin, spacing: grid.spacing, idPrefix: sheet.id });
    if (!frames.length) return setError(`${grid.w}×${grid.h} frames do not fit in ${image.width}×${image.height}`);
    const used = Object.values(tilesets).some((t) => t.sheetId === sheet.id) || Object.values(animations).some((a) => a.sheetId === sheet.id);
    if (used && sheet.frames.length && !(await confirmAsk("Tilesets/animations use this sheet. Re-slicing replaces frame ids; references to frames that no longer exist will break. Continue?"))) return;
    try {
      await store.saveSheet({ ...sheet, frameWidth: grid.w, frameHeight: grid.h, margin: grid.margin, spacing: grid.spacing, frames });
      await reload();
      setError(undefined);
    } catch (e) {
      setError(msg(e));
    }
  };

  const exportAtlasFiles = async () => {
    if (!sheet || !image) return;
    try {
      const atlas = exportAtlas(sheet, { width: image.width, height: image.height }, Object.values(animations).filter((a) => a.sheetId === sheet.id), `${sheet.id}.png`);
      await fs.writeText(`export/atlas/${sheet.id}.json`, JSON.stringify(atlas, null, 2) + "\n");
      await fs.writeBinary(`export/atlas/${sheet.id}.png`, await fs.readBinary(sheet.image));
      setError(undefined);
      setNotice(`Wrote export/atlas/${sheet.id}.json and .png`);
    } catch (e) {
      setNotice(undefined);
      setError(`Export failed: ${msg(e)}`);
    }
  };

  const removeSheet = async (id: string) => {
    try {
      const { tilesets: ts, animations: an } = await store.sheetUsage(id);
      if (ts.length) return setError(`Cannot delete: used by tileset ${ts.join(", ")}`);
      const extra = an.length ? ` This also deletes animation${an.length > 1 ? "s" : ""} ${an.join(", ")}.` : "";
      if (!(await confirmAsk(`Delete sheet "${id}" and its PNG?${extra}`))) return;
      await store.removeSheet(id);
      if (sel === id) setSel(undefined);
      setError(undefined);
      await reload();
    } catch (e) {
      setError(msg(e));
    }
  };

  return (
    <div className="split">
      <aside className="side">
        <h3>Sheets</h3>
        <ul className="list">
          {Object.keys(sheets).map((id) => (
            <li key={id} className={id === sel ? "on" : ""} onClick={() => setSel(id)}>
              {id} <small>{sheets[id]!.frames.length} frames</small>
              <button className="x" title={`Delete sheet "${id}"`} onClick={(e) => (e.stopPropagation(), removeSheet(id))}>✕</button>
            </li>
          ))}
        </ul>
        <label className="filebtn">
          Import PNG…
          <input type="file" accept="image/png" hidden onChange={(e) => e.target.files?.[0] && importPng(e.target.files[0])} />
        </label>
        {error && <p className="error">{error}</p>}
        {sheet && (
          <>
            <h3>Slice grid</h3>
            <div className="grid2">
              <label>frame w <input type="number" min={1} value={grid.w} onChange={(e) => setGrid({ ...grid, w: +e.target.value })} /></label>
              <label>frame h <input type="number" min={1} value={grid.h} onChange={(e) => setGrid({ ...grid, h: +e.target.value })} /></label>
              <label>margin <input type="number" min={0} value={grid.margin} onChange={(e) => setGrid({ ...grid, margin: +e.target.value })} /></label>
              <label>spacing <input type="number" min={0} value={grid.spacing} onChange={(e) => setGrid({ ...grid, spacing: +e.target.value })} /></label>
            </div>
            <button onClick={slice}>Slice</button>
            <button onClick={() => openPixel(sheet.id)}>Edit pixels</button>
            <button onClick={exportAtlasFiles}>Export atlas</button>
            <button onClick={() => removeSheet(sheet.id)}>Delete sheet</button>
            {notice && <p className="muted">{notice}</p>}
            <label>Zoom {zoom}× <input type="range" min={1} max={16} value={zoom} onChange={(e) => setZoom(+e.target.value)} /></label>
          </>
        )}
      </aside>
      <main className="canvas-wrap">
        {sheet && image ? <canvas ref={canvasRef} className="checker" /> : <p className="empty muted">{sheet ? "Image file missing or unreadable." : "Select or import a sheet."}</p>}
      </main>
    </div>
  );
}

// ---- Tilesets -------------------------------------------------------------------------------
function Tilesets() {
  const { sheets, images, tilesets, maps } = useProject();
  const [sel, setSel] = useState<string>();
  const [selTile, setSelTile] = useState<number>();
  const [form, setForm] = useState({ id: "", name: "", sheetId: "" });
  const [error, setError] = useState<string>();
  const ts = sel ? tilesets[sel] : undefined;
  const art = useMemo(() => (ts ? buildFrameArt(sheets[ts.sheetId], images[ts.sheetId]) : new Map<string, TileArt>()), [ts, sheets, images]);

  const create = async () => {
    const sheet = sheets[form.sheetId];
    if (!ID_RE.test(form.id)) return setError("Id may only contain letters, numbers, - and _");
    if (tilesets[form.id]) return setError(`Tileset "${form.id}" already exists`);
    if (!sheet) return setError("Choose a sheet");
    if (!sheet.frames.length) return setError("Slice the sheet into frames first");
    try {
      await store.saveTileset({ id: form.id, name: form.name || form.id, sheetId: sheet.id, tiles: sheet.frames.map((f) => ({ frameId: f.id, collision: false, tags: [] })) });
      await reload();
      setSel(form.id);
      setError(undefined);
    } catch (e) {
      setError(msg(e));
    }
  };

  const update = async (fn: (t: Tileset) => void) => {
    if (!ts) return;
    const copy = structuredClone(ts);
    fn(copy);
    // Show the change immediately; if saving fails, reload from disk so the UI doesn't lie.
    useProject.setState((s) => ({ tilesets: { ...s.tilesets, [copy.id]: copy } }));
    try {
      await store.saveTileset(copy);
    } catch (e) {
      setError(msg(e));
      await reload();
    }
  };

  const remove = async () => {
    if (!ts) return;
    const users = Object.values(maps).filter((m) => m.layers.some((l) => l.kind === "tile" && l.tilesetId === ts.id)).map((m) => m.id);
    if (users.length) return setError(`Cannot delete: used by map ${users.join(", ")}`);
    if (!(await confirmAsk(`Delete tileset "${ts.id}"?`))) return;
    await store.remove("tilesets", ts.id);
    setSel(undefined);
    await reload();
  };

  const tile = ts && selTile !== undefined ? ts.tiles[selTile] : undefined;

  return (
    <div className="split">
      <aside className="side">
        <h3>Tilesets</h3>
        <ul className="list">
          {Object.keys(tilesets).map((id) => <li key={id} className={id === sel ? "on" : ""} onClick={() => (setSel(id), setSelTile(undefined))}>{id} <small>{tilesets[id]!.tiles.length} tiles</small></li>)}
        </ul>
        <details open={!Object.keys(tilesets).length}>
          <summary>New tileset from sheet</summary>
          <div className="form">
            <input placeholder="id" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
            <input placeholder="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="row">
              <select value={form.sheetId} onChange={(e) => setForm({ ...form, sheetId: e.target.value })}>
                <option value="">Sheet…</option>
                {Object.keys(sheets).map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
              <button onClick={create}>Create</button>
            </div>
          </div>
        </details>
        {error && <p className="error">{error}</p>}
        {ts && <button onClick={remove}>Delete tileset</button>}
        {tile && selTile !== undefined && (
          <>
            <h3>Tile {selTile + 1}</h3>
            <label><input type="checkbox" checked={tile.collision} onChange={(e) => update((t) => void (t.tiles[selTile]!.collision = e.target.checked))} /> Blocks movement</label>
            <label>Tags (comma separated)
              <input key={`${sel}-${selTile}`} defaultValue={tile.tags.join(", ")} onBlur={(e) => update((t) => void (t.tiles[selTile]!.tags = e.target.value.split(",").map((x) => x.trim()).filter(Boolean)))} />
            </label>
            <label>Terrain (autotile group)
              <input key={`t-${sel}-${selTile}`} placeholder="e.g. grass" defaultValue={tile.terrain ?? ""} onBlur={(e) => update((t) => void (t.tiles[selTile]!.terrain = e.target.value.trim() || undefined))} />
            </label>
            <fieldset className="mask" disabled={!tile.terrain}>
              <legend>Neighbours of the same terrain {tile.mask === undefined ? "(not set)" : `(mask ${tile.mask})`}</legend>
              {([["N", 1], ["E", 2], ["S", 4], ["W", 8]] as const).map(([name, bit]) => (
                <label key={name}>
                  <input type="checkbox" checked={((tile.mask ?? 0) & bit) !== 0} onChange={(e) => update((t) => void (t.tiles[selTile]!.mask = e.target.checked ? ((t.tiles[selTile]!.mask ?? 0) | bit) : ((t.tiles[selTile]!.mask ?? 0) & ~bit)))} />
                  {name}
                </label>
              ))}
            </fieldset>
          </>
        )}
      </aside>
      <main className="canvas-wrap">
        {ts ? (
          <div className="tilegrid big">
            {ts.tiles.map((t, i) => {
              const a = art.get(t.frameId);
              return (
                <button key={i} className={selTile === i ? "on" : ""} onClick={() => setSelTile(i)} title={`Tile ${i + 1} · ${t.frameId}`}>
                  {a ? <img src={a.url} alt={t.frameId} /> : <span>{i + 1}</span>}
                  {t.collision && <i className="badge">■</i>}
                </button>
              );
            })}
          </div>
        ) : <p className="empty muted">Select or create a tileset.</p>}
      </main>
    </div>
  );
}

// ---- Animations -----------------------------------------------------------------------------
function Preview({ anim }: { anim: Animation }) {
  const { sheets, images } = useProject();
  const art = useMemo(() => buildFrameArt(sheets[anim.sheetId], images[anim.sheetId]), [anim.sheetId, sheets, images]);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c || !anim.frames.length) return;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const step = anim.frames[i]!;
      const a = art.get(step.frameId);
      ctx.clearRect(0, 0, c.width, c.height);
      if (a) ctx.drawImage(a.canvas, 0, 0, c.width, c.height);
      if (i === anim.frames.length - 1 && !anim.loop) return;
      i = (i + 1) % anim.frames.length;
      timer = setTimeout(tick, step.durationMs);
    };
    tick();
    return () => clearTimeout(timer);
  }, [anim, art]);

  return <canvas ref={ref} width={96} height={96} className="checker preview" />;
}

function Animations() {
  const { sheets, images, animations } = useProject();
  const [form, setForm] = useState({ id: "", name: "", sheetId: "", fps: 8, loop: true });
  const [seq, setSeq] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const sheet = sheets[form.sheetId];
  const art = useMemo(() => buildFrameArt(sheet, images[form.sheetId]), [sheet, images, form.sheetId]);

  const create = async () => {
    if (!ID_RE.test(form.id)) return setError("Id may only contain letters, numbers, - and _");
    if (animations[form.id]) return setError(`Animation "${form.id}" already exists`);
    if (!sheet) return setError("Choose a sheet");
    if (!seq.length) return setError("Click frames to build the sequence");
    try {
      await store.saveAnimation({
        id: form.id,
        name: form.name || form.id,
        sheetId: sheet.id,
        frames: seq.map((frameId) => ({ frameId, durationMs: Math.round(1000 / Math.max(1, form.fps)) })),
        loop: form.loop,
        tags: [],
      });
      await reload();
      setSeq([]);
      setError(undefined);
    } catch (e) {
      setError(msg(e));
    }
  };

  const remove = async (id: string) => {
    if (!(await confirmAsk(`Delete animation "${id}"?`))) return;
    await store.remove("animations", id);
    await reload();
  };

  return (
    <div className="split">
      <aside className="side">
        <h3>New animation</h3>
        <input placeholder="id" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
        <input placeholder="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <select value={form.sheetId} onChange={(e) => (setForm({ ...form, sheetId: e.target.value }), setSeq([]))}>
          <option value="">Sheet…</option>
          {Object.keys(sheets).map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <label>FPS {form.fps} <input type="range" min={1} max={30} value={form.fps} onChange={(e) => setForm({ ...form, fps: +e.target.value })} /></label>
        <label><input type="checkbox" checked={form.loop} onChange={(e) => setForm({ ...form, loop: e.target.checked })} /> Loop</label>
        <p className="muted">Sequence: {seq.length ? seq.join(" → ") : "click frames on the right"}</p>
        <div className="row">
          <button onClick={() => setSeq(seq.slice(0, -1))} disabled={!seq.length}>Remove last</button>
          <button onClick={() => setSeq([])} disabled={!seq.length}>Clear</button>
        </div>
        <button onClick={create}>Create</button>
        {error && <p className="error">{error}</p>}
      </aside>
      <main className="canvas-wrap column">
        {sheet && (
          <div className="tilegrid big">
            {sheet.frames.map((f) => (
              <button key={f.id} onClick={() => setSeq([...seq, f.id])} title={f.id}>
                {art.get(f.id) ? <img src={art.get(f.id)!.url} alt={f.id} /> : <span>{f.id}</span>}
              </button>
            ))}
          </div>
        )}
        <h3>Existing</h3>
        <div className="cards">
          {Object.values(animations).map((a) => (
            <div key={a.id} className="card">
              <Preview anim={a} />
              <b>{a.id}</b>
              <small>{a.frames.length} frames{a.loop ? " · loop" : ""}</small>
              <button onClick={() => remove(a.id)}>Delete</button>
            </div>
          ))}
          {!Object.keys(animations).length && <p className="muted">No animations yet.</p>}
        </div>
      </main>
    </div>
  );
}
