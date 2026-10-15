import type { z } from "zod";
import type { FileSystemAdapter } from "./fs";
import {
  AnimationSchema,
  MapSchema,
  ProjectSchema,
  SpriteSheetSchema,
  TilesetSchema,
  type Animation,
  type MapData,
  type Project,
  type SpriteSheet,
  type Tileset,
} from "./schema";

async function readJson<T extends z.ZodTypeAny>(fs: FileSystemAdapter, path: string, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(JSON.parse(await fs.readText(path)));
  if (!parsed.success) {
    throw new Error(`Invalid ${path}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

// Stable formatting keeps git diffs small.
const writeJson = (fs: FileSystemAdapter, path: string, value: unknown) =>
  fs.writeText(path, JSON.stringify(value, null, 2) + "\n");

/** Reads/writes a project folder: project.json, sheets/, animations/, tilesets/, maps/. */
export class ProjectStore {
  constructor(
    private fs: FileSystemAdapter,
    readonly root: string,
  ) {}

  private p(...parts: string[]) {
    return [this.root, ...parts].join("/");
  }

  async init(name: string, tileSize = 16): Promise<Project> {
    const project = ProjectSchema.parse({ name, tileSize });
    await this.saveProject(project);
    return project;
  }

  loadProject = () => readJson(this.fs, this.p("project.json"), ProjectSchema);
  saveProject = (v: Project) => writeJson(this.fs, this.p("project.json"), ProjectSchema.parse(v));

  loadSheet = (id: string) => readJson(this.fs, this.p("sheets", `${id}.json`), SpriteSheetSchema);
  loadAnimation = (id: string) => readJson(this.fs, this.p("animations", `${id}.json`), AnimationSchema);
  loadTileset = (id: string) => readJson(this.fs, this.p("tilesets", `${id}.json`), TilesetSchema);
  loadMap = (id: string) => readJson(this.fs, this.p("maps", `${id}.json`), MapSchema);

  saveSheet = (v: SpriteSheet) => this.saveAsset("sheets", "sheets", SpriteSheetSchema.parse(v));
  saveAnimation = (v: Animation) => this.saveAsset("animations", "animations", AnimationSchema.parse(v));
  saveTileset = (v: Tileset) => this.saveAsset("tilesets", "tilesets", TilesetSchema.parse(v));
  saveMap = (v: MapData) => this.saveAsset("maps", "maps", MapSchema.parse(v));

  private async saveAsset(dir: string, key: "sheets" | "animations" | "tilesets" | "maps", v: { id: string }) {
    await writeJson(this.fs, this.p(dir, `${v.id}.json`), v);
    const project = await this.loadProject();
    if (!project[key].includes(v.id)) {
      project[key].push(v.id);
      await this.saveProject(project);
    }
  }

  /**
   * Delete an asset's JSON and unregister it. Art files are left on disk (they may be shared or hand-made).
   * Callers are responsible for checking references first.
   */
  async remove(kind: "sheets" | "animations" | "tilesets" | "maps", id: string) {
    await this.fs.remove(this.p(kind, `${id}.json`));
    const project = await this.loadProject();
    project[kind] = project[kind].filter((x) => x !== id);
    await this.saveProject(project);
  }
}
