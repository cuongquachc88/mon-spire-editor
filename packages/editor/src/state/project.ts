import { create } from "zustand";
import {
  ProjectStore,
  type Animation,
  type MapData,
  type PixelImage,
  type Project,
  type SpriteRequest,
  type SpriteSheet,
  type Tileset,
  type FileSystemAdapter,
} from "@mse/core";
import { HttpFs, watchProject } from "../lib/http-fs";
import { TauriFs, watchTauri } from "../lib/tauri-fs";
import { decodePng } from "../lib/image";

/**
 * Remembers what we last wrote to each file so the watcher can tell our own echo from a real outside edit.
 * A time window alone is not enough: Claude may change the same file a moment after we saved it.
 */
const lastWrite = new Map<string, { at: number; sig: number; binary: boolean }>();
const ECHO_WINDOW_MS = 5000;

function fnv(data: string | Uint8Array): number {
  let h = 0x811c9dc5;
  if (typeof data === "string") for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data.charCodeAt(i), 0x01000193);
  else for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i]!, 0x01000193);
  return h >>> 0;
}

/** True when the file on disk is exactly what we wrote a moment ago (so there is nothing new to load). */
export async function isOwnEcho(path: string): Promise<boolean> {
  const w = lastWrite.get(path);
  if (!w || Date.now() - w.at > ECHO_WINDOW_MS || !backend) return false;
  try {
    const abs = backend.root === "." ? path : `${backend.root}/${path}`;
    const now = w.binary ? await backend.inner.readBinary(abs) : await backend.inner.readText(abs);
    return fnv(now) === w.sig;
  } catch {
    return false; // deleted or unreadable: that is a real change
  }
}

export interface Backend {
  inner: FileSystemAdapter;
  /** "." for the dev server (paths are project-relative); an absolute folder for the desktop app. */
  root: string;
  watch(onChange: (relPath: string) => void): Promise<() => void>;
}

const slash = (p: string) => p.replace(/\\/g, "/");

/** Resolves project-relative paths, normalizes watcher paths and tracks our own writes. */
class TrackingFs implements FileSystemAdapter {
  constructor(
    private inner: FileSystemAdapter,
    private root: string,
  ) {}

  rel(path: string) {
    let p = slash(path);
    if (this.root !== "." && p.startsWith(this.root + "/")) p = p.slice(this.root.length + 1);
    return p.replace(/^\.\//, "");
  }
  private abs(path: string) {
    const p = slash(path);
    return this.root === "." || p.startsWith("/") || /^[a-z]:\//i.test(p) ? path : `${this.root}/${p}`;
  }
  private mark(path: string, data: string | Uint8Array) {
    lastWrite.set(this.rel(path), { at: Date.now(), sig: fnv(data), binary: typeof data !== "string" });
  }

  readText = (p: string) => this.inner.readText(this.abs(p));
  readBinary = (p: string) => this.inner.readBinary(this.abs(p));
  exists = (p: string) => this.inner.exists(this.abs(p));
  remove = (p: string) => this.inner.remove(this.abs(p));
  async writeText(p: string, c: string) {
    this.mark(p, c);
    await this.inner.writeText(this.abs(p), c);
  }
  async writeBinary(p: string, d: Uint8Array) {
    this.mark(p, d);
    await this.inner.writeBinary(this.abs(p), d);
  }
}

export const httpBackend = (): Backend => ({
  inner: new HttpFs(),
  root: ".",
  watch: async (cb) => watchProject(cb),
});

export const tauriBackend = (root: string): Backend => {
  const r = slash(root).replace(/\/$/, "");
  return {
    inner: new TauriFs(),
    root: r,
    watch: async (cb) => {
      const unwatch = await watchTauri(r, (abs) => cb(slash(abs).startsWith(r + "/") ? slash(abs).slice(r.length + 1) : slash(abs)));
      return () => unwatch();
    },
  };
};

let backend: Backend | undefined;
/** Absolute project folder in the desktop app; "." (unknown) in the browser dev server. */
export const projectRoot = () => backend?.root;
export let fs: FileSystemAdapter;
export let store: ProjectStore;

interface ProjectState {
  status: "none" | "loading" | "ready" | "error";
  error?: string;
  project?: Project;
  sheets: Record<string, SpriteSheet>;
  tilesets: Record<string, Tileset>;
  maps: Record<string, MapData>;
  animations: Record<string, Animation>;
  requests: Record<string, SpriteRequest>;
  images: Record<string, PixelImage>;
  /** Bumped when files change on disk, so open documents know to reload. */
  externalRev: number;
  lastExternalPath?: string;
  load(): Promise<void>;
  /** Switch to another project/backend and load it. */
  open(b: Backend): Promise<void>;
  refreshImage(sheetId: string): Promise<void>;
}

async function loadAll(ids: string[], load: (id: string) => Promise<any>) {
  const out: Record<string, any> = {};
  // A broken file must not take the whole project down; skip it and keep going.
  await Promise.all(
    ids.map(async (id) => {
      try {
        out[id] = await load(id);
      } catch (e) {
        console.warn(`Skipping ${id}:`, e);
      }
    }),
  );
  return out;
}

export const useProject = create<ProjectState>((set, get) => ({
  status: "none",
  sheets: {},
  tilesets: {},
  maps: {},
  animations: {},
  requests: {},
  images: {},
  externalRev: 0,

  async open(b) {
    backend = b;
    const tracking = new TrackingFs(b.inner, b.root);
    fs = tracking;
    store = new ProjectStore(tracking, b.root);
    set({ status: "loading", sheets: {}, tilesets: {}, maps: {}, animations: {}, requests: {}, images: {}, lastExternalPath: undefined });
    await get().load();
    await startWatching();
  },

  async load() {
    if (!backend) return;
    try {
      const project = await store.loadProject();
      const [sheets, tilesets, maps, animations, requests] = await Promise.all([
        loadAll(project.sheets, (id) => store.loadSheet(id)),
        loadAll(project.tilesets, (id) => store.loadTileset(id)),
        loadAll(project.maps, (id) => store.loadMap(id)),
        loadAll(project.animations, (id) => store.loadAnimation(id)),
        loadAll(project.requests, (id) => store.loadRequest(id)),
      ]);
      const images: Record<string, PixelImage> = {};
      await Promise.all(
        Object.values(sheets as Record<string, SpriteSheet>).map(async (s) => {
          try {
            images[s.id] = await decodePng(await fs.readBinary(s.image));
          } catch {
            /* missing art: views fall back to placeholders */
          }
        }),
      );
      set({ status: "ready", error: undefined, project, sheets, tilesets, maps, animations, requests, images });
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  },

  async refreshImage(sheetId) {
    const sheet = get().sheets[sheetId];
    if (!sheet) return;
    const img = await decodePng(await fs.readBinary(sheet.image));
    set((s) => ({ images: { ...s.images, [sheetId]: img } }));
  },
}));

let stop: (() => void) | undefined;
let reloadTimer: ReturnType<typeof setTimeout> | undefined;

/** Starts the watcher for the current backend: external changes reload the project and bump `externalRev`. */
async function startWatching() {
  stop?.();
  const mine = backend;
  const unsub = await mine!.watch(async (path) => {
    if (backend !== mine || (await isOwnEcho(path))) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      await useProject.getState().load();
      useProject.setState((s) => ({ externalRev: s.externalRev + 1, lastExternalPath: path }));
    }, 150);
  });
  stop = unsub;
}
