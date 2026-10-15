import { describe, expect, it } from "vitest";
import { exportTiled, MapSchema, type SpriteSheet, type Tileset } from "../src";

const sheet: SpriteSheet = {
  id: "sh",
  image: "assets/sh.png",
  margin: 0,
  spacing: 0,
  frames: [0, 1].map((n) => ({ id: `f${n}`, name: `f${n}`, rect: { x: n * 16, y: 0, w: 16, h: 16 }, pivot: { x: 0.5, y: 0.5 } })),
};
const ts: Tileset = {
  id: "ground",
  name: "Ground",
  sheetId: "sh",
  tiles: [
    { frameId: "f0", collision: false, tags: [] },
    { frameId: "f1", collision: true, tags: ["wall"] },
  ],
};
const sizes = new Map([["sh", { width: 32, height: 16 }]]);

const map = MapSchema.parse({
  id: "m",
  name: "M",
  width: 4,
  height: 2,
  tileSize: 16,
  layers: [
    { id: "g", name: "G", kind: "tile", tilesetId: "ground", data: [1, 2, 0, 2, 0, 0, 1, 1] },
    { id: "c", name: "C", kind: "collision", data: [0, 1, 1, 0, 1, 0, 0, 0] },
    { id: "o", name: "O", kind: "object", entities: [{ id: "bob", type: "npc", x: 8, y: 8, props: { hp: 3, name: "Bob", flags: [1] } }] },
  ],
});

describe("exportTiled", () => {
  const out = exportTiled(map, new Map([["ground", ts]]), new Map([["sh", sheet]]), sizes);
  const layers = out.map.layers as any[];

  it("maps tile numbers to gids (0 stays empty)", () => {
    expect(layers[0].type).toBe("tilelayer");
    expect(layers[0].data).toEqual([1, 2, 0, 2, 0, 0, 1, 1]); // firstgid 1 + (n-1)
    expect((out.map.tilesets as any[])[0]).toEqual({ firstgid: 1, source: "ground.tsj" });
  });

  it("writes sub-rectangle tiles with real image size and properties", () => {
    const tiles = (out.tilesets[0]!.json as any).tiles;
    expect(tiles[1]).toMatchObject({ id: 1, x: 16, width: 16, imagewidth: 32, imageheight: 16, image: "../../assets/sh.png" });
    expect(tiles[1].properties).toEqual([{ name: "collision", type: "bool", value: true }, { name: "tags", type: "string", value: "wall" }]);
    expect(tiles[0].properties).toBeUndefined();
  });

  it("merges collision runs into rectangles", () => {
    const rects = layers[1].objects.map((o: any) => [o.x, o.y, o.width, o.height]);
    expect(rects).toEqual([[16, 0, 32, 16], [0, 16, 16, 16]]);
  });

  it("exports entities as typed point objects with unique ids across layers", () => {
    const o = layers[2].objects[0];
    expect(o).toMatchObject({ name: "bob", type: "npc", x: 8, y: 8, point: true });
    expect(o.properties).toEqual([
      { name: "hp", type: "int", value: 3 },
      { name: "name", type: "string", value: "Bob" },
      { name: "flags", type: "string", value: "[1]" },
    ]);
    const ids = layers.flatMap((l) => (l.objects ?? []).map((x: any) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.map.nextobjectid).toBe(ids.length + 1);
  });

  it("fails clearly on a missing frame or image", () => {
    const broken = { ...ts, tiles: [{ frameId: "nope", collision: false, tags: [] }] };
    expect(() => exportTiled(map, new Map([["ground", broken]]), new Map([["sh", sheet]]), sizes)).toThrow('missing frame "nope"');
    expect(() => exportTiled(map, new Map([["ground", ts]]), new Map([["sh", sheet]]), new Map())).toThrow("missing or unreadable");
  });
});
