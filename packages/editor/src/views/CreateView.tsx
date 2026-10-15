import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { RequestSchema, STYLE_PACKS, SUBJECT_CATEGORIES, SUBJECT_PRESETS, SpriteSpecSchema, buildSpritePrompt, slugify, type SpecPatch, type SpriteRequest } from "@mse/core";
import { AiSettingsPanel, GenerationProgress } from "../components/GeneratePanel";
import { Icon } from "../components/Icon";
import { confirmAsk } from "../lib/ask";
import { generateSprite } from "../lib/generate";
import { useGen } from "../state/gen";
import { isTauri } from "../lib/tauri-fs";
import { useMcp } from "../state/mcp";
import { store, useProject } from "../state/project";
import { useUi } from "../state/ui";

interface Draft {
  subject: string;
  kind: string;
  width: number;
  height: number;
  frames: number;
  motion: string;
  style: string;
  colors: number;
  palette: string;
  outline: string;
  shading: string;
  view: string;
  light: string;
  notes: string;
  sheetId: string;
  /** Preferred id when a preset was chosen (its own id, e.g. "slime"), until the subject is edited. */
  idBase: string;
  /** Once the user types an id themselves we stop deriving it from the subject. */
  sheetIdTouched: boolean;
}

const EMPTY: Draft = {
  subject: "", kind: "creature", width: 32, height: 32, frames: 1, motion: "", style: "snes", colors: 16, palette: "",
  outline: "dark", shading: "cel", view: "side", light: "top-left", notes: "", sheetId: "", idBase: "", sheetIdTouched: false,
};

/** Kept outside the component so switching tabs does not lose what you typed. */
const useDraft = create<{ d: Draft; set(p: Partial<Draft>): void; reset(d?: Partial<Draft>): void }>((set) => ({
  d: EMPTY,
  set: (p) => set((s) => ({ d: { ...s.d, ...p } })),
  reset: (d) => set({ d: { ...EMPTY, ...d } }),
}));

/** Turn a core spec patch into draft fields (the draft keeps the palette as editable text). */
function patchToDraft(p: SpecPatch, d: Draft): Partial<Draft> {
  const { palette, ...rest } = p;
  return { ...(rest as Partial<Draft>), ...(palette ? { palette: palette.join(", ") } : {}) };
}

const SIZES = [16, 24, 32, 48, 64];
const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 5 ? "just now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

function toSpec(d: Draft, sheetId: string) {
  const palette = d.palette.split(/[\s,]+/).filter(Boolean);
  return SpriteSpecSchema.safeParse({
    subject: d.subject, kind: d.kind, width: d.width, height: d.height, frames: d.frames, motion: d.motion, style: d.style,
    colors: d.colors, palette, outline: d.outline, shading: d.shading, view: d.view, light: d.light, notes: d.notes, sheetId,
  });
}

const STATUS: Record<SpriteRequest["status"], string> = {
  pending: "Waiting for an MCP client",
  in_progress: "Being drawn",
  done: "Done",
  failed: "Failed",
};

export function CreateView() {
  const { d, set, reset } = useDraft();
  const { sheets, requests } = useProject();
  const openPixel = useUi((s) => s.openPixel);
  const setConnect = useUi((s) => s.setConnect);
  const mcp = useMcp();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [cat, setCat] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [pack, setPack] = useState("");
  const gen = useGen();
  const presets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return SUBJECT_PRESETS.filter((x) => (cat === "All" || x.category === cat) && (!q || `${x.label} ${x.spec.subject}`.toLowerCase().includes(q)));
  }, [cat, search]);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000); // keeps "5 s ago" fresh
    return () => clearInterval(t);
  }, []);

  // sheet id: derived from the subject until the user edits it; never silently collide with an existing sheet
  const derived = useMemo(() => {
    const base = d.idBase || slugify(d.subject);
    let id = base;
    for (let n = 2; sheets[id]; n++) id = `${base}-${n}`;
    return id;
  }, [d.subject, d.idBase, sheets]);
  const sheetId = d.sheetIdTouched ? d.sheetId : derived;
  const exists = !!sheets[sheetId];

  const parsed = useMemo(() => toSpec(d, sheetId), [d, sheetId]);
  const prompt = parsed.success ? buildSpritePrompt(parsed.data) : "";
  const problem = d.subject.trim() === "" ? "Describe what to draw to see the prompt." : !parsed.success ? parsed.error.issues[0]!.message : exists ? `A sheet called "${sheetId}" already exists. Pick another id.` : undefined;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setNotice("Prompt copied. Paste it into your MCP client.");
    } catch {
      setError("Could not copy automatically. Select the prompt text and copy it.");
    }
  };

  const queue = async () => {
    if (!parsed.success || problem) return;
    try {
      const now = new Date().toISOString();
      const req = RequestSchema.parse({ id: `req-${Date.now().toString(36)}`, createdAt: now, updatedAt: now, status: "pending", spec: parsed.data, prompt });
      await store.saveRequest(req);
      await useProject.getState().load();
      setError(undefined);
      setNotice("Queued. In your MCP client, ask it to do the pending sprite requests.");
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const generate = () => {
    if (!parsed.success || problem) return;
    setError(undefined);
    setNotice(undefined);
    void generateSprite(parsed.data, prompt);
  };

  const list = Object.values(requests).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const waiting = list.filter((r) => r.status === "pending").length;

  const update = async (r: SpriteRequest, patch: Partial<SpriteRequest>) => {
    await store.saveRequest({ ...r, ...patch, updatedAt: new Date().toISOString() });
    await useProject.getState().load();
  };
  const remove = async (r: SpriteRequest) => {
    if (r.status === "in_progress" && !(await confirmAsk("This request is being drawn. Remove it anyway?"))) return;
    await store.remove("requests", r.id);
    await useProject.getState().load();
  };

  const num = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(v)) || min));

  return (
    <div className="view create">
      <aside className="side">
        <h3>What should be drawn?</h3>
        <textarea rows={3} placeholder="A red slime with a tiny golden crown" value={d.subject} onChange={(e) => set({ subject: e.target.value, idBase: "" })} />
        <h3>Presets</h3>
        <input type="search" placeholder="Search presets: slime, torch, chest…" aria-label="Search presets" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="chips" role="tablist" aria-label="Preset groups">
          {["All", ...SUBJECT_CATEGORIES].map((c) => (
            <button key={c} role="tab" aria-selected={cat === c} className={`chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
        <div className="presets">
          {presets.map((x) => (
            <button key={x.id} title={x.spec.subject} onClick={() => set({ ...patchToDraft({ motion: "", ...x.spec }, d), idBase: x.id, sheetIdTouched: false })}>
              <span>{x.label}</span>
              <small>{x.spec.width}×{x.spec.height}{(x.spec.frames ?? 1) > 1 ? ` · ${x.spec.frames}f` : ""}</small>
            </button>
          ))}
          {presets.length === 0 && <p className="muted">No preset matches “{search}”.</p>}
        </div>
        <label>Style pack
          <select
            value={pack}
            onChange={(e) => {
              setPack(e.target.value);
              const sp = STYLE_PACKS.find((x) => x.id === e.target.value);
              if (!sp) return;
              const note = sp.spec.notes;
              set({ ...patchToDraft({ ...sp.spec, notes: undefined }, d), ...(note ? { notes: d.notes.includes(note) ? d.notes : [d.notes, note].filter(Boolean).join(" ") } : {}) });
            }}
          >
            <option value="">Custom</option>
            {STYLE_PACKS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          {pack && <small className="muted">{STYLE_PACKS.find((x) => x.id === pack)?.description}</small>}
        </label>

        <h3>Size</h3>
        <div className="row">
          <select value={d.width === d.height && SIZES.includes(d.width) ? String(d.width) : "custom"} onChange={(e) => e.target.value !== "custom" && set({ width: +e.target.value, height: +e.target.value })}>
            {SIZES.map((s) => <option key={s} value={s}>{s}×{s}</option>)}
            <option value="custom">Custom</option>
          </select>
          <input type="number" aria-label="Width" value={d.width} onChange={(e) => set({ width: num(e.target.value, 4, 256) })} />×
          <input type="number" aria-label="Height" value={d.height} onChange={(e) => set({ height: num(e.target.value, 4, 256) })} />
        </div>
        <label>Frames: {d.frames}
          <input type="range" min={1} max={8} value={d.frames} onChange={(e) => set({ frames: +e.target.value })} />
        </label>
        {d.frames > 1 && <input placeholder="What moves? e.g. wings flap up and down" value={d.motion} onChange={(e) => set({ motion: e.target.value })} />}

        <h3>Look</h3>
        <label>Type
          <select value={d.kind} onChange={(e) => set({ kind: e.target.value })}>
            <option value="character">Character</option><option value="creature">Creature</option><option value="item">Item</option>
            <option value="prop">Prop</option><option value="tree">Tree or plant</option><option value="tile">Seamless tile</option><option value="ui">UI icon</option>
          </select>
        </label>
        <label>Style
          <select value={d.style} onChange={(e) => set({ style: e.target.value })}>
            <option value="nes">8-bit (NES)</option><option value="gameboy">Game Boy (4 greens)</option>
            <option value="snes">16-bit (SNES)</option><option value="modern">Modern pixel art</option>
          </select>
        </label>
        <label>Colours: {d.colors}
          <input type="range" min={2} max={32} value={d.colors} onChange={(e) => set({ colors: +e.target.value })} />
        </label>
        <label>Exact palette (optional)
          <input placeholder="#1d2b53, #ff004d, #fff1e8" value={d.palette} onChange={(e) => set({ palette: e.target.value })} />
        </label>
        <div className="grid2">
          <label>Outline
            <select value={d.outline} onChange={(e) => set({ outline: e.target.value })}>
              <option value="dark">Dark</option><option value="colored">Coloured</option><option value="none">None</option>
            </select>
          </label>
          <label>Shading
            <select value={d.shading} onChange={(e) => set({ shading: e.target.value })}>
              <option value="cel">Cel</option><option value="flat">Flat</option><option value="dither">Dithered</option>
            </select>
          </label>
          <label>View
            <select value={d.view} onChange={(e) => set({ view: e.target.value })}>
              <option value="side">Side</option><option value="front">Front</option><option value="three-quarter">Three-quarter</option><option value="top-down">Top-down</option>
            </select>
          </label>
          <label>Light from
            <select value={d.light} onChange={(e) => set({ light: e.target.value })}>
              <option value="top-left">Top left</option><option value="top-right">Top right</option><option value="top">Above</option>
            </select>
          </label>
        </div>
        <label>Anything else
          <textarea rows={2} placeholder="Wears round glasses. Keep it cute, not scary." value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
        <label>Sheet id
          <input value={sheetId} onChange={(e) => set({ sheetId: e.target.value, sheetIdTouched: true })} />
        </label>
      </aside>

      <main className="canvas-wrap column">
        <section className="panel">
          <header className="panel-head">
            <h2>Prompt</h2>
            <div className="row">
              <button disabled={!!problem} onClick={copy}><Icon name="copy" size={15} /> Copy prompt</button>
              <button disabled={!!problem} onClick={queue} title="Save it as a request that an MCP client picks up"><Icon name="sparkle" size={15} /> Queue for MCP client</button>
              <button
                className="primary"
                disabled={!!problem || gen.running || !gen.key.has}
                onClick={generate}
                title={gen.key.has ? "Draw it now with your API key" : "Add an API key under AI generation first"}
              >
                <Icon name="sparkle" size={15} /> {gen.running ? "Drawing…" : "Generate now"}
              </button>
            </div>
          </header>
          {problem ? <p className="muted">{problem}</p> : <pre className="prompt-text">{prompt}</pre>}
          {error && <p className="error" role="alert">{error}</p>}
          {notice && <p className="muted" role="status">{notice}</p>}
          <p className="muted small-note">
            {isTauri()
              ? mcp.lastAt
                ? `An MCP client last used a tool ${ago(mcp.lastAt)} (${mcp.lastTool}).`
                : "No MCP client has called this app yet."
              : "Copy the prompt into your MCP client, or queue it and let a client pick it up over MCP."}{" "}
            <button className="link" onClick={() => setConnect(true)}>{isTauri() ? "MCP status and setup" : "MCP setup"}</button>
          </p>
        </section>

        <GenerationProgress />
        <AiSettingsPanel />

        <section className="panel">
          <header className="panel-head">
            <h2>Requests {waiting > 0 && <span className="count">{waiting} waiting</span>}</h2>
          </header>
          {waiting > 0 && (
            <p className="muted">
              Tell your MCP client: <b>“Do the pending sprite requests in Mon Spire Editor.”</b> (Most clients also list the <code>do_pending_requests</code> prompt in their MCP menu.)
            </p>
          )}
          {list.length === 0 && <p className="muted">Nothing queued yet. Build a prompt on the left and queue it.</p>}
          <ul className="requests">
            {list.map((r) => (
              <li key={r.id} className={`req ${r.status}`}>
                <div className="req-main">
                  <span className={`status ${r.status}`}><i /> {STATUS[r.status]}</span>
                  <b>{r.spec.subject}</b>
                  <small>{r.spec.width}×{r.spec.height}{r.spec.frames > 1 ? `, ${r.spec.frames} frames` : ""} · sheet “{r.spec.sheetId}” · {ago(Date.parse(r.updatedAt))}</small>
                  {r.note && <small className={r.status === "failed" ? "error" : "muted"}>{r.note}</small>}
                </div>
                <div className="row">
                  {r.status === "done" && r.resultSheetId && sheets[r.resultSheetId] && <button onClick={() => openPixel(r.resultSheetId!)}>Open sprite</button>}
                  {r.status === "failed" && <button onClick={() => update(r, { status: "pending", note: undefined })}>Try again</button>}
                  <button className="ghost icon" aria-label="Remove request" title="Remove" onClick={() => remove(r)}><Icon name="close" size={16} /></button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
