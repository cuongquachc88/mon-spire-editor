import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, MODELS, deleteKey, loadKey, loadSettings, saveKey, saveSettings, testKey, type AiSettings } from "../lib/agent";
import { isTauri } from "../lib/tauri-fs";
import { useGen } from "../state/gen";
import { Icon } from "./Icon";

/** API key, model and limits. The key goes to the OS credential store (desktop) and is never shown again. */
export function AiSettingsPanel() {
  const key = useGen((s) => s.key);
  const [settings, setSettings] = useState<AiSettings>(loadSettings);
  const [draft, setDraft] = useState("");
  const [remember, setRemember] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  const desktop = isTauri();

  // Start open when there is no key yet; after that only the user opens or closes it (saving a key must not hide the form).
  const [open, setOpen] = useState<boolean>();
  useEffect(() => void useGen.getState().refreshKey(), []);
  useEffect(() => {
    if (key.checked) setOpen((o) => o ?? !key.has);
  }, [key.checked, key.has]);
  const update = (p: Partial<AiSettings>) => {
    const next = { ...settings, ...p };
    setSettings(next);
    saveSettings(next);
  };

  const save = async () => {
    const k = draft.trim();
    if (!k) return;
    setBusy(true);
    try {
      await saveKey(k, remember && desktop);
      setDraft("");
      setMsg({ ok: true, text: remember && desktop ? "Key saved in your system keychain." : "Key will be used until you close the app." });
      await useGen.getState().refreshKey();
    } catch (e) {
      setMsg({ ok: false, text: `Could not save the key: ${e instanceof Error ? e.message : e}` });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    const k = draft.trim() || (await loadKey());
    if (!k) return setMsg({ ok: false, text: "Paste a key first." });
    setBusy(true);
    try {
      await testKey(k, settings);
      setMsg({ ok: true, text: "The key works." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await deleteKey();
      setMsg({ ok: true, text: "Key removed." });
    } catch (e) {
      setMsg({ ok: false, text: `Could not remove the key: ${e instanceof Error ? e.message : e}` });
    }
    await useGen.getState().refreshKey();
  };

  return (
    <details className="panel ai-settings" open={!!open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <b>AI generation</b>
        <span className={`keystate ${key.has ? "on" : ""}`}>{key.has ? `Key ${key.mask}` : "No API key"}</span>
      </summary>
      <div className="form">
        <p className="muted">
          Paste an Anthropic API key to let this app draw sprites itself. The prompt, and the images the model looks at while it works, are sent to Anthropic with your key. Nothing else leaves your computer.
        </p>
        <label>API key
          <input type="password" autoComplete="off" spellCheck={false} placeholder={key.has ? "Paste a new key to replace it" : "sk-ant-…"} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
        {desktop && <label><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember it in the system keychain</label>}
        <div className="row">
          <button className="primary" disabled={busy || !draft.trim()} onClick={save}>Save key</button>
          <button disabled={busy || (!draft.trim() && !key.has)} onClick={test}>Test</button>
          <button disabled={busy || !key.has} onClick={remove}>Remove</button>
        </div>
        {msg && <p className={msg.ok ? "ok-text" : "error"} role="status">{msg.text}</p>}

        <label>Model
          <select value={MODELS.some((m) => m.id === settings.model) ? settings.model : "custom"} onChange={(e) => e.target.value !== "custom" && update({ model: e.target.value })}>
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            {!MODELS.some((m) => m.id === settings.model) && <option value="custom">{settings.model}</option>}
          </select>
        </label>
        <label>Most turns per sprite: {settings.maxTurns}
          <input type="range" min={4} max={30} value={settings.maxTurns} onChange={(e) => update({ maxTurns: +e.target.value })} />
          <small className="muted">Each turn is one model call. More turns allow more refining, and cost more.</small>
        </label>
        <details className="more">
          <summary>Advanced</summary>
          <label>Model id
            <input value={settings.model} onChange={(e) => update({ model: e.target.value.trim() || DEFAULT_SETTINGS.model })} />
          </label>
          <label>API address
            <input value={settings.baseUrl} onChange={(e) => update({ baseUrl: e.target.value.trim() || DEFAULT_SETTINGS.baseUrl })} />
            <small className="muted">Change this only to use a compatible proxy.</small>
          </label>
        </details>
      </div>
    </details>
  );
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** What the agent is doing right now, with the latest preview it looked at. */
export function GenerationProgress() {
  const g = useGen();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!g.running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [g.running]);
  if (!g.running && g.log.length === 0) return null;
  const secs = g.startedAt ? Math.round((Date.now() - g.startedAt) / 1000) : 0;

  return (
    <section className="panel" aria-live="polite" aria-label="Generation progress">
      <header className="panel-head">
        <h2>{g.running ? `Drawing “${g.sheetId}”` : `Finished “${g.sheetId}”`}</h2>
        <div className="row">
          <span className="muted">{g.running ? `turn ${g.turn} of ${g.maxTurns} · ${secs}s · ` : ""}{fmt(g.input)} in / {fmt(g.output)} out tokens</span>
          {g.running && <button onClick={() => g.stop()}><Icon name="power" size={15} /> Stop</button>}
        </div>
      </header>
      <div className="gen-body">
        {g.image && <img className="gen-preview" src={g.image} alt={`Latest preview of ${g.sheetId}`} />}
        <ol className="gen-log">
          {g.log.map((l) => <li key={l.id} className={l.kind}>{l.text}</li>)}
        </ol>
      </div>
    </section>
  );
}
