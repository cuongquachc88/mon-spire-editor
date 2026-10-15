import type { FileSystemAdapter } from "@mse/core";
import { exists, mkdir, readFile, readTextFile, remove, watch, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const parent = (p: string) => p.slice(0, Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")));

/** Native file access for the desktop app. Paths are absolute (the project root is prefixed by the caller). */
export class TauriFs implements FileSystemAdapter {
  readText = (path: string) => readTextFile(path);
  readBinary = (path: string) => readFile(path);
  exists = (path: string) => exists(path);
  remove = (path: string) => remove(path).catch((e) => {
    if (isMissing(e)) return;
    throw e;
  });

  async writeText(path: string, content: string) {
    await mkdir(parent(path), { recursive: true });
    await writeTextFile(path, content);
  }
  async writeBinary(path: string, data: Uint8Array) {
    await mkdir(parent(path), { recursive: true });
    await writeFile(path, data);
  }
}

// remove() of a missing file is a no-op on every other adapter; match that.
const isMissing = (e: unknown) => /no such file|not found|os error 2/i.test(String(e));

/** Watch a folder recursively; callback gets absolute paths. Returns an unsubscribe function. */
export async function watchTauri(root: string, onChange: (absPath: string) => void) {
  return watch(root, (ev) => ev.paths.forEach(onChange), { recursive: true, delayMs: 100 });
}
