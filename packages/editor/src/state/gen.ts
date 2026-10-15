import { create } from "zustand";
import { loadKey, maskKey } from "../lib/agent";

export interface LogLine {
  id: number;
  kind: "turn" | "text" | "tool" | "ok" | "fail" | "info";
  text: string;
}

interface GenState {
  running: boolean;
  requestId?: string;
  sheetId?: string;
  startedAt?: number;
  turn: number;
  maxTurns: number;
  input: number;
  output: number;
  log: LogLine[];
  /** Latest sprite_preview the agent looked at, as a data URL. */
  image?: string;
  abort?: AbortController;
  /** API key status, without ever holding the key itself in this store. */
  key: { checked: boolean; has: boolean; mask?: string };
  begin(requestId: string, sheetId: string, abort: AbortController, maxTurns: number): void;
  push(kind: LogLine["kind"], text: string): void;
  patch(p: Partial<GenState>): void;
  end(): void;
  stop(): void;
  refreshKey(): Promise<void>;
}

let seq = 0;

export const useGen = create<GenState>((set, get) => ({
  running: false,
  turn: 0,
  maxTurns: 0,
  input: 0,
  output: 0,
  log: [],
  key: { checked: false, has: false },
  begin: (requestId, sheetId, abort, maxTurns) =>
    set({ running: true, requestId, sheetId, abort, maxTurns, turn: 0, input: 0, output: 0, log: [], image: undefined, startedAt: Date.now() }),
  push: (kind, text) => set((s) => ({ log: [...s.log.slice(-200), { id: ++seq, kind, text }] })),
  patch: (p) => set(p),
  end: () => set({ running: false, abort: undefined }),
  stop: () => get().abort?.abort(),
  async refreshKey() {
    const k = await loadKey();
    set({ key: { checked: true, has: !!k, mask: k ? maskKey(k) : undefined } });
  },
}));
