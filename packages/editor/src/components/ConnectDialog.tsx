import { useEffect, useRef, useState } from "react";
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

const PROMPTS = [
  "Draw a 32×32 treasure chest in warm browns, preview it, and fix anything that looks off.",
  "Make a 24×16 map called harbor with water along the south edge, a sand beach, and a path to the north.",
  "Run project_validate and tell me what is broken.",
];

export function ConnectDialog() {
  const close = () => useUi.getState().setConnect(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const dir = projectRoot();
  const known = dir && dir !== ".";
  const folder = known ? dir : "/path/to/your/project";

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
  const cli = `claude mcp add spire-editor -- npx tsx /path/to/mon-spire-editor/packages/mcp-server/src/index.ts ${folder}`;

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <header>
          <h2 id="connect-title">Connect Claude to this project</h2>
          <button ref={closeBtn} className="ghost icon" onClick={close} aria-label="Close"><Icon name="close" /></button>
        </header>
        <div className="dialog-body">
          <p>
            Claude talks to your project through an MCP server: a small program that lets it draw sprites, edit maps and read results
            as tools. Both of you work on the same folder, so changes show up here as they happen.
          </p>
          <h3>Add the server</h3>
          <CopyBlock label="Claude Code" text={cli} />
          <CopyBlock label="Or in .mcp.json / Claude Desktop config" text={config} />
          {!known && <p className="muted">Replace <code>/path/to/your/project</code> with the folder that holds <code>project.json</code>.</p>}
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
