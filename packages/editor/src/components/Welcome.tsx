import { useState } from "react";
import { confirmAsk } from "../lib/ask";
import { pickAndOpen, openProjectDir, recentProjects } from "../lib/open-project";
import { isTauri } from "../lib/tauri-fs";
import { useProject } from "../state/project";
import { useUi } from "../state/ui";
import { HeroScene } from "./HeroScene";
import { Icon, Mark } from "./Icon";

const tail = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function Welcome({ message }: { message?: string }) {
  const project = useProject((s) => s.project);
  const status = useProject((s) => s.status);
  const [error, setError] = useState<string>();
  const desktop = isTauri();
  const open = status === "ready" && project;

  const run = async (fn: () => Promise<unknown>) => {
    try {
      setError(undefined);
      await fn();
      useUi.getState().setWelcome(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="welcome">
      <section className="intro">
        <div className="brand">
          <Mark size={30} />
          <span className="wordmark">Mon Spire</span>
        </div>
        <h1>Draw the tiles, lay out the map, let Claude lend a hand.</h1>
        <p className="lede">
          A sprite, pixel-art and tilemap editor. Your project is a plain folder, so you and Claude can edit it at the same time.
        </p>

        <div className="actions">
          {open && (
            <button className="primary" onClick={() => useUi.getState().setWelcome(false)}>
              Continue with {project.name}
            </button>
          )}
          {desktop && (
            <button className={open ? "" : "primary"} onClick={() => run(() => pickAndOpen((d) => confirmAsk(`No project.json in\n${d}\n\nCreate a new project here?`)))}>
              <Icon name="folder" /> Open project folder
            </button>
          )}
          <button onClick={() => useUi.getState().setConnect(true)}>
            <Icon name="plug" /> Connect Claude
          </button>
        </div>
        {(message || error) && <p className="error" role="alert">{error ?? message}</p>}

        {desktop && recentProjects().length > 0 && (
          <div className="recent">
            <h2>Recent</h2>
            <ul>
              {recentProjects().map((d) => (
                <li key={d}>
                  <button className="link" onClick={() => run(() => openProjectDir(d))} title={d}>
                    <b>{tail(d)}</b>
                    <span>{d}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!desktop && <p className="muted">Browser mode edits the folder the dev server was started with.</p>}
      </section>

      <section className="stage" aria-label="Preview">
        <HeroScene />
        <ul className="legend">
          <li><i className="dot you" /> You, with the brush</li>
          <li><i className="dot ai" /> Claude, calling tools over MCP</li>
        </ul>
      </section>
    </main>
  );
}
