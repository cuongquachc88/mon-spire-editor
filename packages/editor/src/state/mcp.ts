import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { isTauri } from "../lib/tauri-fs";

interface RustStatus {
  running: boolean;
  port: number | null;
  started_ms: number | null;
}

interface McpState {
  /** False in the browser: there is no built-in server there, so the UI hides MCP status. */
  available: boolean;
  running: boolean;
  port: number | null;
  startedMs: number | null;
  /** Requests answered since the app started (not reset by a restart: it is the app's history). */
  handled: number;
  errors: number;
  lastAt: number | null;
  lastTool: string | null;
  lastError: string | null;
  busy: boolean;
  refresh(): Promise<void>;
  restart(): Promise<void>;
  stop(): Promise<void>;
  start(): Promise<void>;
  /** Called by the host after each request. */
  record(info: { tool?: string; error?: string }): void;
}

export const useMcp = create<McpState>((set, get) => {
  const apply = (s: RustStatus) => set({ running: s.running, port: s.port, startedMs: s.started_ms });
  const run = async (cmd: "mcp_restart" | "mcp_stop" | "mcp_start") => {
    set({ busy: true });
    try {
      apply(await invoke<RustStatus>(cmd));
    } finally {
      set({ busy: false });
    }
  };
  return {
    available: isTauri(),
    running: false,
    port: null,
    startedMs: null,
    handled: 0,
    errors: 0,
    lastAt: null,
    lastTool: null,
    lastError: null,
    busy: false,
    async refresh() {
      if (!get().available) return;
      try {
        apply(await invoke<RustStatus>("mcp_status"));
      } catch {
        set({ running: false, port: null });
      }
    },
    restart: () => run("mcp_restart"),
    stop: () => run("mcp_stop"),
    start: () => run("mcp_start"),
    record({ tool, error }) {
      set((s) => ({
        handled: s.handled + 1,
        errors: s.errors + (error ? 1 : 0),
        lastAt: Date.now(),
        lastTool: tool ?? s.lastTool,
        lastError: error ?? s.lastError,
      }));
    },
  };
});
