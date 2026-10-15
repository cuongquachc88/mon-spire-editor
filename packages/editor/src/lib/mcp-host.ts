// The MCP server that ships inside the desktop app. Rust listens on a local port and forwards each JSON-RPC
// body here as an "mcp-request" event; we run the same tool set as the stdio server and reply with the result.
// It always works on whatever project is open in the editor, and its file writes go through the plain file
// adapter (not the editor's tracking one), so the editor's watcher reloads them like any outside edit.
import { Buffer } from "buffer";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { ProjectStore } from "@mse/core";
import { createServer } from "@mse/mcp-server/server";
import { projectRoot } from "../state/project";
import { TauriFs } from "./tauri-fs";

// pngjs and the tool code use Node's Buffer.
(globalThis as { Buffer?: unknown }).Buffer ??= Buffer;

const rawFs = new TauriFs();

type Rpc = JSONRPCMessage & { id?: string | number; method?: string };
const NO_PROJECT = "No project is open in Mon Spire Editor. Open a project folder in the app, then try again.";

/** Collects the single response a stateless request produces. */
class CaptureTransport implements Transport {
  onmessage?: (m: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (e: Error) => void;
  constructor(private onSend: (m: JSONRPCMessage) => void) {}
  async start() {}
  async send(m: JSONRPCMessage) {
    this.onSend(m);
  }
  async close() {
    this.onclose?.();
  }
}

async function handleOne(msg: Rpc): Promise<JSONRPCMessage | undefined> {
  const isRequest = typeof msg.method === "string" && msg.id !== undefined;
  const root = projectRoot();
  const hasProject = !!root && root !== ".";
  if (isRequest && msg.method === "tools/call" && !hasProject) {
    return { jsonrpc: "2.0", id: msg.id!, error: { code: -32000, message: NO_PROJECT } };
  }
  // initialize / tools/list work without a project; tool calls are refused above.
  const server = createServer(new ProjectStore(rawFs, hasProject ? root : ""), rawFs);
  let answer: JSONRPCMessage | undefined;
  let done!: () => void;
  const replied = new Promise<void>((r) => (done = r));
  const transport = new CaptureTransport((m) => {
    if ("id" in m && m.id === msg.id && ("result" in m || "error" in m)) {
      answer = m;
      done();
    }
  });
  await server.connect(transport);
  transport.onmessage?.(msg);
  if (isRequest) await replied;
  await server.close();
  return answer;
}

/** Process a POST body: one message or a batch. Returns "" for "nothing to send back" (notifications only). */
export async function handleMcpBody(body: string): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  const batch = Array.isArray(parsed);
  const answers: JSONRPCMessage[] = [];
  for (const m of (batch ? parsed : [parsed]) as unknown[]) {
    const a = await handleOne(m as Rpc);
    if (a) answers.push(a);
  }
  if (!answers.length) return "";
  return JSON.stringify(batch ? answers : answers[0]);
}

let started = false;

/** Listen for requests from the Rust HTTP endpoint. Safe to call more than once. */
export async function startMcpHost() {
  if (started) return;
  started = true;
  await listen<{ id: number; body: string }>("mcp-request", async (ev) => {
    let reply: string;
    try {
      reply = await handleMcpBody(ev.payload.body);
    } catch (e) {
      reply = JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
    }
    await invoke("mcp_reply", { id: ev.payload.id, body: reply });
  });
}

export const mcpPort = () => invoke<number | null>("mcp_port");
export const initialProject = () => invoke<string | null>("initial_project");
