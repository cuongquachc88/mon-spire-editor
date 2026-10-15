import type { FileSystemAdapter } from "@mse/core";

const url = (path: string) => `/api/fs?path=${encodeURIComponent(path)}`;

async function ok(res: Response, path: string) {
  if (!res.ok) throw new Error(res.status === 404 ? `ENOENT: ${path}` : `${res.status} ${await res.text()}`);
  return res;
}

/** Talks to the dev/desktop file server. Paths are relative to the project root. */
export class HttpFs implements FileSystemAdapter {
  async readText(path: string) {
    return (await ok(await fetch(url(path)), path)).text();
  }
  async readBinary(path: string) {
    return new Uint8Array(await (await ok(await fetch(url(path)), path)).arrayBuffer());
  }
  async exists(path: string) {
    return (await fetch(url(path), { method: "HEAD" })).ok;
  }
  async remove(path: string) {
    await ok(await fetch(url(path), { method: "DELETE" }), path);
  }
  async writeText(path: string, content: string) {
    await ok(await fetch(url(path), { method: "PUT", body: content }), path);
  }
  async writeBinary(path: string, data: Uint8Array) {
    await ok(await fetch(url(path), { method: "PUT", body: data as BodyInit }), path);
  }
}

/** Subscribes to change notifications; returns an unsubscribe function. */
export function watchProject(onChange: (path: string) => void) {
  const es = new EventSource("/api/watch");
  es.onmessage = (e) => onChange(e.data);
  return () => es.close();
}
