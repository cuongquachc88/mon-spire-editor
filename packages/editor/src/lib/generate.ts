import { RequestSchema, type SpriteSpec } from "@mse/core";
import { useGen } from "../state/gen";
import { store, useProject } from "../state/project";
import { loadKey, loadSettings, runAgent, type AgentResult } from "./agent";

const iso = () => new Date().toISOString();

async function setStatus(id: string, patch: { status: "done" | "failed"; note?: string; resultSheetId?: string }) {
  const r = await store.loadRequest(id);
  await store.saveRequest({ ...r, ...patch, updatedAt: iso() });
}

/**
 * Create a request, let the in-app agent draw it, and leave the request in a truthful final state
 * (done only if the sheet really exists). Never throws: problems end up on the request and in the log.
 */
export async function generateSprite(spec: SpriteSpec, prompt: string): Promise<void> {
  const gen = useGen.getState();
  if (gen.running) return;
  const key = await loadKey();
  if (!key) {
    gen.push("fail", "Add an API key first.");
    return;
  }
  const settings = loadSettings();
  const id = `req-${Date.now().toString(36)}`;
  const abort = new AbortController();
  try {
    await store.saveRequest(RequestSchema.parse({ id, createdAt: iso(), updatedAt: iso(), status: "in_progress", spec, prompt, note: "Being drawn in the app" }));
    await useProject.getState().load();
    gen.begin(id, spec.sheetId, abort, settings.maxTurns);
    gen.push("info", `Using ${settings.model}.`);

    let result: AgentResult | undefined;
    try {
      result = await runAgent({
        prompt,
        requestId: id,
        key,
        settings,
        signal: abort.signal,
        onEvent: (e) => {
          const g = useGen.getState();
          if (e.type === "turn") g.patch({ turn: e.n });
          else if (e.type === "usage") g.patch({ input: e.input, output: e.output });
          else if (e.type === "text") g.push("text", e.text);
          else if (e.type === "tool") g.push("tool", `${e.name}: ${e.summary}`);
          else if (e.type === "result") {
            if (e.image) g.patch({ image: e.image });
            g.push(e.ok ? "ok" : "fail", `${e.name}: ${e.text}`);
          }
        },
      });
    } catch (e) {
      const stopped = (e as Error).name === "AbortError";
      const msg = stopped ? "Stopped." : e instanceof Error ? e.message : String(e);
      useGen.getState().push("fail", msg);
      await setStatus(id, { status: "failed", note: msg });
      return;
    }

    const project = await store.loadProject();
    const current = await store.loadRequest(id);
    if (current.status === "done") return; // the model completed it itself
    if (project.sheets.includes(spec.sheetId)) {
      await setStatus(id, { status: "done", resultSheetId: spec.sheetId, note: "Drawn in the app" });
      useGen.getState().push("info", "Done.");
    } else {
      const note = result.stopReason === "tool_use" ? `Ran out of turns (${result.turns}) before the sprite existed. Try again, or raise the turn limit.` : "The model finished without creating the sprite.";
      await setStatus(id, { status: "failed", note });
      useGen.getState().push("fail", note);
    }
  } catch (e) {
    useGen.getState().push("fail", e instanceof Error ? e.message : String(e));
  } finally {
    useGen.getState().end();
    await useProject.getState().load();
  }
}
