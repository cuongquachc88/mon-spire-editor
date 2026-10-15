// An in-app sprite artist: asks a Claude model to follow the prompt and lets it call the editor's own MCP tools
// in this process. Every call is the same code an outside MCP client would hit, so results show up live.
import { invoke } from "@tauri-apps/api/core";
import { callTool, listTools, type ToolResult } from "./mcp-host";
import { isTauri } from "./tauri-fs";

export const MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (balanced, default)" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (best quality, slower)" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fast and cheap)" },
] as const;

export interface AiSettings {
  model: string;
  maxTurns: number;
  baseUrl: string;
}
export const DEFAULT_SETTINGS: AiSettings = { model: MODELS[0].id, maxTurns: 14, baseUrl: "https://api.anthropic.com" };

const SETTINGS_KEY = "mse:ai";
export function loadSettings(): AiSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export function saveSettings(s: AiSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); // never contains the key
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}

// ---- API key: OS credential store on desktop, this tab's session in the browser -------------------------------
const SECRET = "mse_anthropic_api_key";
let sessionKey: string | undefined;

export async function loadKey(): Promise<string | undefined> {
  if (sessionKey) return sessionKey;
  if (isTauri()) {
    try {
      return (await invoke<string | null>("secret_get", { name: SECRET })) ?? undefined;
    } catch {
      return undefined; // keychain locked or denied: the user can paste the key again
    }
  }
  try {
    return sessionStorage.getItem(SECRET) ?? undefined;
  } catch {
    return undefined;
  }
}

/** `remember` stores it in the OS credential store (desktop only); otherwise it lives until the app closes. */
export async function saveKey(key: string, remember: boolean) {
  sessionKey = key;
  if (isTauri()) {
    if (remember) await invoke("secret_set", { name: SECRET, value: key });
    else await invoke("secret_delete", { name: SECRET }).catch(() => {});
  } else {
    try {
      sessionStorage.setItem(SECRET, key);
    } catch {
      /* in-memory only */
    }
  }
}

export async function deleteKey() {
  sessionKey = undefined;
  if (isTauri()) await invoke("secret_delete", { name: SECRET });
  else
    try {
      sessionStorage.removeItem(SECRET);
    } catch {
      /* nothing stored */
    }
}

export const maskKey = (k: string) => (k.length > 12 ? `${k.slice(0, 7)}…${k.slice(-4)}` : "…");

// ---- HTTP ---------------------------------------------------------------------------------------------------
async function http(url: string, init: RequestInit): Promise<Response> {
  // In the desktop app requests go through Rust (no browser CORS rules, key never in page network logs).
  const f = isTauri() ? (await import("@tauri-apps/plugin-http")).fetch : window.fetch.bind(window);
  return f(url, init);
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("Stopped", "AbortError"))), { once: true });
  });

function friendly(status: number, apiMessage: string): string {
  if (status === 401) return "The API key was rejected (401). Check that it is a valid Anthropic API key.";
  if (status === 403) return `The API key is not allowed to do this (403): ${apiMessage}`;
  if (status === 404) return `The model or address was not found (404): ${apiMessage}`;
  if (status === 429) return "Rate limit reached (429). Wait a moment and try again.";
  if (status === 529 || status >= 500) return `The API is busy or unavailable (${status}). Try again shortly.`;
  return `The API refused the request (${status}): ${apiMessage}`;
}

type Block = Record<string, unknown>;
interface ApiResponse {
  content: Block[];
  stop_reason: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** The configured address, unless the app was started with MSE_API_BASE_URL (desktop only; used by tests). */
async function baseUrl(settings: AiSettings): Promise<string> {
  if (isTauri()) {
    try {
      const o = await invoke<string | null>("api_base_override");
      if (o) return o;
    } catch {
      /* no override */
    }
  }
  return settings.baseUrl;
}

async function post(settings: AiSettings, key: string, body: unknown, signal?: AbortSignal): Promise<ApiResponse> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" };
  if (!isTauri()) headers["anthropic-dangerous-direct-browser-access"] = "true"; // required for direct browser calls
  const base = await baseUrl(settings);
  const url = `${base.replace(/\/+$/, "")}/v1/messages`;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await http(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new ApiError(`Could not reach ${base}: ${e instanceof Error ? e.message : e}`, 0);
    }
    if (res.ok) return (await res.json()) as ApiResponse;
    const retryable = [429, 500, 502, 503, 529].includes(res.status);
    if (retryable && attempt < 2) {
      const wait = Math.min(20, Number(res.headers.get("retry-after")) || 2 ** (attempt + 1));
      await sleep(wait * 1000, signal);
      continue;
    }
    let message = res.statusText;
    try {
      message = (await res.json())?.error?.message ?? message;
    } catch {
      /* body was not JSON */
    }
    throw new ApiError(friendly(res.status, message), res.status);
  }
}

/** Cheapest possible call to find out whether a key and address work. */
export async function testKey(key: string, settings: AiSettings) {
  await post(settings, key, { model: settings.model, max_tokens: 1, messages: [{ role: "user", content: "ok" }] });
}

// ---- the agent loop ---------------------------------------------------------------------------------------------
export type AgentEvent =
  | { type: "turn"; n: number; max: number }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "result"; name: string; ok: boolean; text: string; image?: string }
  | { type: "usage"; input: number; output: number };

export interface AgentResult {
  turns: number;
  input: number;
  output: number;
  stopReason: string;
}

/** Tools an automatic agent should not get: this one reads any file path on the user's disk. */
const BLOCKED = new Set(["sprite_import"]);

const system = (maxTurns: number) =>
  [
    "You are the sprite artist built into Mon Spire Editor, a pixel-art and tilemap editor. You can act only through the provided tools; there is no other way to draw.",
    "Follow the brief you are given exactly: size, frame count, palette and style. Work in a few big batches, then look at the result with sprite_preview and fix what is wrong before you finish. A first draft is rarely good enough.",
    `You have at most ${maxTurns} turns, and each turn can call several tools. Be economical: do not preview after every tiny change, and do not repeat work that is already correct.`,
    "When you are done, reply with one short sentence saying what you made. Do not paste pixel data into your reply.",
  ].join("\n");

function summarize(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (Array.isArray(i.ops)) return `${i.ops.length} drawing op${i.ops.length === 1 ? "" : "s"} on ${String(i.sheetId ?? "")}`.trim();
  const s = JSON.stringify(input);
  return s.length > 90 ? `${s.slice(0, 87)}…` : s;
}

function toApiContent(r: ToolResult): { content: Block[]; image?: string } {
  let image: string | undefined;
  const content: Block[] = r.content.map((c) => {
    if (c.type === "image") {
      image = `data:${c.mimeType};base64,${c.data}`;
      return { type: "image", source: { type: "base64", media_type: c.mimeType, data: c.data } };
    }
    return { type: "text", text: c.text || "(empty)" };
  });
  return { content: content.length ? content : [{ type: "text", text: "(no output)" }], image };
}

/** Old previews cost tokens on every later turn and are stale anyway: keep only the newest few images. */
function pruneImages(messages: { role: string; content: unknown }[], keep: number) {
  let seen = 0;
  for (let m = messages.length - 1; m >= 0; m--) {
    const c = messages[m]!.content;
    if (!Array.isArray(c)) continue;
    for (const block of c as Block[]) {
      if (block.type !== "tool_result" || !Array.isArray(block.content)) continue;
      block.content = (block.content as Block[]).map((b) => (b.type === "image" && ++seen > keep ? { type: "text", text: "[older preview removed to save tokens]" } : b));
    }
  }
}

export async function runAgent(opts: {
  prompt: string;
  requestId?: string;
  key: string;
  settings: AiSettings;
  signal?: AbortSignal;
  onEvent: (e: AgentEvent) => void;
}): Promise<AgentResult> {
  const { settings, key, signal, onEvent } = opts;
  const tools = (await listTools()).filter((t) => !BLOCKED.has(t.name)).map((t) => ({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema }) as Block);
  if (tools.length) tools[tools.length - 1]!.cache_control = { type: "ephemeral" }; // the tool list is identical every turn

  const messages: { role: "user" | "assistant"; content: unknown }[] = [
    { role: "user", content: opts.requestId ? `${opts.prompt}\n\nThis is request "${opts.requestId}": when the sprite is finished, call request_complete with that id.` : opts.prompt },
  ];
  let input = 0, output = 0, stopReason = "";
  let turn = 0;
  while (turn < settings.maxTurns) {
    signal?.throwIfAborted();
    turn++;
    onEvent({ type: "turn", n: turn, max: settings.maxTurns });
    const res = await post(
      settings,
      key,
      { model: settings.model, max_tokens: 16000, system: [{ type: "text", text: system(settings.maxTurns), cache_control: { type: "ephemeral" } }], tools, messages },
      signal,
    );
    input += res.usage?.input_tokens ?? 0;
    output += res.usage?.output_tokens ?? 0;
    onEvent({ type: "usage", input, output });
    stopReason = res.stop_reason;
    messages.push({ role: "assistant", content: res.content });

    for (const b of res.content) if (b.type === "text" && String(b.text).trim()) onEvent({ type: "text", text: String(b.text).trim() });
    const uses = res.content.filter((b) => b.type === "tool_use");
    if (!uses.length) break; // the model is finished

    const results: Block[] = [];
    for (const u of uses) {
      signal?.throwIfAborted();
      const name = String(u.name);
      if (res.stop_reason === "max_tokens") {
        // the reply was cut off mid-call, so its input is incomplete: do not run it
        results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: [{ type: "text", text: "Your reply was cut off before this call was complete. Send smaller batches (fewer ops per call)." }] });
        continue;
      }
      onEvent({ type: "tool", name, summary: summarize(name, u.input) });
      let r: ToolResult;
      try {
        r = await callTool(name, u.input);
      } catch (e) {
        r = { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] };
      }
      const { content, image } = toApiContent(r);
      const text = r.content.find((c) => c.type === "text");
      onEvent({ type: "result", name, ok: !r.isError, text: text && text.type === "text" ? text.text.slice(0, 200) : image ? "(image)" : "", image });
      results.push({ type: "tool_result", tool_use_id: u.id, content, ...(r.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
    pruneImages(messages, 2);
  }
  return { turns: turn, input, output, stopReason };
}
