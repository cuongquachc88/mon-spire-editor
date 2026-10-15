import { useEffect } from "react";
import { ConnectDialog } from "./components/ConnectDialog";
import { Icon, Mark, type IconName } from "./components/Icon";
import { Welcome } from "./components/Welcome";
import { initialProject, startMcpHost } from "./lib/mcp-host";
import { openProjectDir, reopenLast } from "./lib/open-project";
import { isTauri } from "./lib/tauri-fs";
import { httpBackend, useProject } from "./state/project";
import { useMcp } from "./state/mcp";
import { useUi, type Tab } from "./state/ui";
import { AssetsView } from "./views/AssetsView";
import { CreateView } from "./views/CreateView";
import { MapView } from "./views/MapView";
import { PixelView } from "./views/PixelView";

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "create", label: "Create", icon: "sparkle" },
  { id: "assets", label: "Assets", icon: "assets" },
  { id: "pixel", label: "Pixel", icon: "pixel" },
  { id: "map", label: "Map", icon: "map" },
];

export function App() {
  const { status, error, project, lastExternalPath } = useProject();
  const { tab, setTab, welcome, setWelcome, connect, setConnect } = useUi();
  const desktop = isTauri();
  const mcp = useMcp();

  useEffect(() => {
    if (!desktop) {
      void useProject.getState().open(httpBackend());
      return;
    }
    void startMcpHost();
    // `--project <dir>` (scripts, tests) wins over the remembered project
    void initialProject().then((dir) => (dir ? openProjectDir(dir, { remember: false }).catch(() => reopenLast()) : reopenLast()));
  }, [desktop]);

  let body;
  if (status === "none") body = desktop ? <Welcome /> : <div className="center muted">Connecting…</div>;
  else if (status === "loading") body = <div className="center muted">Loading project…</div>;
  else if (status === "error")
    body = desktop ? (
      <Welcome message={`Could not open project: ${error}`} />
    ) : (
      <div className="center">
        <p className="error">Could not open project: {error}</p>
        <button onClick={() => void useProject.getState().load()}>Retry</button>
      </div>
    );
  else if (welcome) body = <Welcome />;
  else
    body = (
      <div className="app">
        <header className="topbar">
          <button className="project" onClick={() => setWelcome(true)} title="Back to the start screen">
            <Mark size={22} />
            <b>{project?.name}</b>
          </button>
          {lastExternalPath && (
            <span className="external" role="status">
              <i className="dot ai" /> Changed outside the editor: {lastExternalPath}
            </span>
          )}
          <span className="grow" />
          {mcp.available && (
            <button
              className={`mcp-chip ${mcp.running ? "running" : "stopped"} ${mcp.lastAt && Date.now() - mcp.lastAt < 3000 ? "active" : ""}`}
              onClick={() => setConnect(true)}
              title="MCP server status"
            >
              <i /> MCP {mcp.running ? `:${mcp.port}` : "stopped"}
            </button>
          )}
          <button className="ghost" onClick={() => setConnect(true)}>
            <Icon name="plug" size={16} /> Connect Claude
          </button>
          {desktop && (
            <button className="ghost" onClick={() => setWelcome(true)}>
              <Icon name="folder" size={16} /> Projects
            </button>
          )}
        </header>
        <div className="shell">
          <nav className="rail" aria-label="Sections">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}>
                <Icon name={t.icon} size={22} />
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="content">
            {tab === "create" && <CreateView />}
            {tab === "assets" && <AssetsView />}
            {tab === "pixel" && <PixelView />}
            {tab === "map" && <MapView />}
          </div>
        </div>
      </div>
    );

  return (
    <>
      {body}
      {connect && <ConnectDialog />}
    </>
  );
}
