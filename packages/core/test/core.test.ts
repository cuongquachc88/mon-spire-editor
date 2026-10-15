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
