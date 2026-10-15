import { describe, expect, it } from "vitest";
import { History, MapSchema, MemoryFs, ProjectStore, SetTilesCommand, sliceGrid, type MapData } from "../src";

const makeMap = (): MapData =>
  MapSchema.parse({
    id: "town",
    name: "Town",
    width: 4,
    height: 3,
    tileSize: 16,
    layers: [{ id: "ground", name: "Ground", kind: "tile", tilesetId: "ts", data: new Array(12).fill(0) }],
  });

describe("schema", () => {
  it("rejects a layer whose size does not match the map", () => {
    const bad = { ...makeMap(), width: 5 };
    expect(MapSchema.safeParse(bad).success).toBe(false);
  });
});

describe("ProjectStore", () => {
  it("round-trips a map and registers it in project.json", async () => {
    const store = new ProjectStore(new MemoryFs(), "/p");
    await store.init("demo");
    await store.saveMap(makeMap());
    expect((await store.loadProject()).maps).toEqual(["town"]);
    expect(await store.loadMap("town")).toEqual(makeMap());
  });

  it("removes an asset and unregisters it", async () => {
    const fs = new MemoryFs();
    const store = new ProjectStore(fs, "/p");
    await store.init("demo");
    await store.saveMap(makeMap());
    await store.remove("maps", "town");
    expect((await store.loadProject()).maps).toEqual([]);
    expect(await fs.exists("/p/maps/town.json")).toBe(false);
  });

  it("reports the file path on invalid data", async () => {
    const fs = new MemoryFs();
    const store = new ProjectStore(fs, "/p");
    await store.init("demo");
    await fs.writeText("/p/maps/x.json", JSON.stringify({ id: "x" }));
    await expect(store.loadMap("x")).rejects.toThrow("/p/maps/x.json");
  });
});

describe("sliceGrid", () => {
  it("cuts a plain grid row-major", () => {
    const f = sliceGrid({ imageWidth: 32, imageHeight: 16, frameWidth: 16, frameHeight: 16, idPrefix: "t" });
    expect(f.map((x) => [x.id, x.rect.x, x.rect.y])).toEqual([["t_0", 0, 0], ["t_1", 16, 0]]);
  });

  it("honors margin and spacing and ignores partial cells", () => {
    // 1px margin, 2px spacing, 8px frames: x = 1, 11, 21 fit in 33px; a 4th would need 31+8=39 > 32
    const f = sliceGrid({ imageWidth: 33, imageHeight: 10, frameWidth: 8, frameHeight: 8, margin: 1, spacing: 2, idPrefix: "t" });
    expect(f.map((x) => x.rect.x)).toEqual([1, 11, 21]);
  });
});

describe("History", () => {
  it("undoes and redoes tile edits", () => {
    const map = makeMap();
    const h = new History(map);
    h.execute(new SetTilesCommand("ground", [{ index: 0, value: 3 }, { index: 5, value: 2 }]));
    expect(map.layers[0]).toMatchObject({ data: expect.arrayContaining([3, 2]) });
    h.undo();
    expect((map.layers[0] as any).data.every((v: number) => v === 0)).toBe(true);
    h.redo();
    expect((map.layers[0] as any).data[0]).toBe(3);
  });

  it("merges segments with the same key into one undo step", () => {
    const map = makeMap();
    const h = new History(map);
    h.execute(new SetTilesCommand("ground", [{ index: 0, value: 1 }], "k"));
    h.execute(new SetTilesCommand("ground", [{ index: 1, value: 1 }, { index: 0, value: 2 }], "k"));
    h.execute(new SetTilesCommand("ground", [{ index: 2, value: 1 }], "other"));
    h.undo();
    expect((map.layers[0] as any).data.slice(0, 3)).toEqual([2, 1, 0]);
    h.undo();
    expect((map.layers[0] as any).data.slice(0, 3)).toEqual([0, 0, 0]);
    expect(h.canUndo).toBe(false);
    h.redo(); // the merged stroke must redo, not become a no-op
    expect((map.layers[0] as any).data.slice(0, 3)).toEqual([2, 1, 0]);
  });

  it("clears redo after a new edit", () => {
    const h = new History(makeMap());
    h.execute(new SetTilesCommand("ground", [{ index: 0, value: 1 }]));
    h.undo();
    h.execute(new SetTilesCommand("ground", [{ index: 1, value: 1 }]));
    expect(h.canRedo).toBe(false);
  });
});

describe("deleting a sheet", () => {
  async function setup() {
    const fs = new MemoryFs();
    const store = new ProjectStore(fs, "/p");
    await store.init("demo");
    await fs.writeBinary("/p/assets/a.png", new Uint8Array([1]));
    await store.saveSheet({ id: "a", image: "assets/a.png", margin: 0, spacing: 0, frames: [] });
    await store.saveAnimation({ id: "walk", name: "Walk", sheetId: "a", frames: [{ frameId: "x", durationMs: 100 }], loop: true, tags: [] });
    return { fs, store };
  }

  it("reports what a deletion would touch", async () => {
    const { store } = await setup();
    await store.saveTileset({ id: "ts", name: "T", sheetId: "a", tiles: [] });
    expect(await store.sheetUsage("a")).toEqual({ tilesets: ["ts"], animations: ["walk"] });
  });

  it("removes the sheet, its animations and its PNG, and unregisters them", async () => {
    const { fs, store } = await setup();
    expect(await store.removeSheet("a")).toEqual({ animations: ["walk"], imageDeleted: true });
    const project = await store.loadProject();
    expect([project.sheets, project.animations]).toEqual([[], []]);
    expect(await fs.exists("/p/assets/a.png")).toBe(false);
    expect(await fs.exists("/p/sheets/a.json")).toBe(false);
  });

  it("refuses while a tileset uses the sheet and changes nothing", async () => {
    const { fs, store } = await setup();
    await store.saveTileset({ id: "ts", name: "T", sheetId: "a", tiles: [] });
    await expect(store.removeSheet("a")).rejects.toThrow("used by tileset ts");
    expect((await store.loadProject()).sheets).toEqual(["a"]);
    expect(await fs.exists("/p/assets/a.png")).toBe(true);
    expect((await store.loadProject()).animations).toEqual(["walk"]);
  });

  it("keeps the PNG when asked to, or when another sheet shares the file", async () => {
    const keep = await setup();
    expect((await keep.store.removeSheet("a", { deleteImage: false })).imageDeleted).toBe(false);
    expect(await keep.fs.exists("/p/assets/a.png")).toBe(true);

    const shared = await setup();
    await shared.store.saveSheet({ id: "b", image: "assets/a.png", margin: 0, spacing: 0, frames: [] });
    expect((await shared.store.removeSheet("a")).imageDeleted).toBe(false);
    expect(await shared.fs.exists("/p/assets/a.png")).toBe(true);
  });
});
