import { useEffect, useRef, useState } from "react";
import { isTauri } from "../lib/tauri-fs";
import { useMcp } from "../state/mcp";
import { projectRoot } from "../state/project";
import { useUi } from "../state/ui";
import { Icon } from "./Icon";

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      /* clipboard blocked: the text is still selectable */
    }
  };
  return (
    <div className="codeblock">
      <div className="codehead">
        <span>{label}</span>
        <button className="ghost small" onClick={copy}>
          <Icon name={done ? "check" : "copy"} size={14} /> {done ? "Copied" : "Copy"}
        </button>
      </div>
      <pre><code>{text}</code></pre>
    </div>
  );
}

function since(t: number) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 5 ? "just now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}

function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

/** Live state of the built-in MCP server, with the controls to restart it. */
function McpStatus() {
  const m = useMcp();
  useEffect(() => {
    void m.refresh();
    const t = setInterval(() => void useMcp.getState().refresh(), 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section className="panel" aria-label="MCP server status">
      <header className="panel-head">
        <h3 className="status-title">
          <span className={`mcp-chip ${m.running ? "running" : "stopped"}`}><i /> {m.running ? "Running" : "Stopped"}</span>
        </h3>
        <div className="row">
          <button disabled={m.busy} onClick={() => void m.restart()}><Icon name="refresh" size={15} /> {m.running ? "Restart" : "Start"}</button>
          {m.running && <button disabled={m.busy} onClick={() => void m.stop()}><Icon name="power" size={15} /> Stop</button>}
        </div>
      </header>
      <dl className="statgrid">
        <dt>Address</dt><dd>{m.running ? `http://127.0.0.1:${m.port}/mcp` : "Not listening"}</dd>
        <dt>Running for</dt><dd>{m.running && m.startedMs ? duration(Date.now() - m.startedMs) : "-"}</dd>
        <dt>Requests handled</dt><dd>{m.handled}{m.errors ? ` (${m.errors} with errors)` : ""}</dd>
        <dt>Last activity</dt><dd>{m.lastAt ? `${since(m.lastAt)}: ${m.lastTool}` : "None yet"}</dd>
        {m.lastError && (<><dt>Last error</dt><dd className="error">{m.lastError}</dd></>)}
      </dl>
      {!m.running && <p className="muted">No MCP client can reach the editor while the server is stopped.</p>}
    </section>
  );
}

const PROMPTS = [
  "Draw a 32×32 treasure chest in warm browns, preview it, and fix anything that looks off.",
  "Make a 24×16 map called harbor with water along the south edge, a sand beach, and a path to the north.",
  "Run project_validate and tell me what is broken.",
];

export function ConnectDialog() {
  const close = () => useUi.getState().setConnect(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const desktop = isTauri();
  const live = useMcp();
  const port = live.running ? live.port : null;
  const dir = projectRoot();
  const known = dir && dir !== ".";
  const folder = known ? dir : "/path/to/your/project";
  const url = port ? `http://127.0.0.1:${port}/mcp` : undefined;

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const config = JSON.stringify(
    { mcpServers: { "spire-editor": { command: "npx", args: ["tsx", "/path/to/mon-spire-editor/packages/mcp-server/src/index.ts", folder] } } },
    null,
    2,
  );
  const httpCli = `claude mcp add --transport http spire-editor ${url ?? ""}`;
  const httpJson = JSON.stringify({ mcpServers: { "spire-editor": { type: "http", url } } }, null, 2);
  const bridge = `npx -y mcp-remote ${url ?? ""}`;
  const cli = `claude mcp add spire-editor -- npx tsx /path/to/mon-spire-editor/packages/mcp-server/src/index.ts ${folder}`;

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <header>
          <h2 id="connect-title">MCP</h2>
          <button ref={closeBtn} className="ghost icon" onClick={close} aria-label="Close"><Icon name="close" /></button>
        </header>
        <div className="dialog-body">
          <p>
            An MCP server lets an AI client (Claude Code, Claude Desktop and others) draw sprites, edit maps and read results as tools. You and the client work on the same folder, so changes show up here as they happen.
          </p>
          {desktop && <McpStatus />}
          {desktop ? (
            <>
              <h3>Add the server</h3>
              {!live.running && <p className="muted">The server is stopped. Start it above to get an address.</p>}
              {url && (
                <>
                  <p>
                    The server is built into this app and listens on <code>{url}</code> while the app is open. It always works on
                    the project you have open{known ? <> (<code>{dir}</code>)</> : ""}. Nothing to install.
                  </p>
                  <CopyBlock label="Claude Code" text={httpCli} />
                  <CopyBlock label="Or in .mcp.json" text={httpJson} />
                  <details className="more">
                    <summary>Claude Desktop</summary>
                    <p className="muted">Claude Desktop starts local servers as programs, so use a small bridge to reach this address:</p>
                    <CopyBlock label="Command (use in the app's MCP config)" text={bridge} />
                  </details>
                  <p className="muted">Only programs on this computer can connect, and web pages are refused.</p>
                </>
              )}
            </>
          ) : (
            <>
              <h3>Add the server</h3>
              <p className="muted">Browser mode has no built-in server. Run the stdio server from the repository instead:</p>
              <CopyBlock label="Claude Code" text={cli} />
              <CopyBlock label="Or in .mcp.json / Claude Desktop config" text={config} />
              {!known && <p className="muted">Replace <code>/path/to/your/project</code> with the folder that holds <code>project.json</code>.</p>}
            </>
          )}
          <h3>Try asking</h3>
          <ul className="prompts">
            {PROMPTS.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <p className="muted">The full guide, with every tool and example, is in <code>docs/mcp-guide.md</code>.</p>
        </div>
      </div>
    </div>
  );
}
