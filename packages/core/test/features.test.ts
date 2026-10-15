import { describe, expect, it } from "vitest";
import { applyDrawOps, createImage, exportAtlas, imageToRows, planAutotile, stampCells, type Animation, type SpriteSheet, type Tileset } from "../src";

// A 16-tile "blob" set: tile n+1 has mask n, plus one unrelated tile (17) with no terrain.
const blob: Tileset = {
  id: "g",
  name: "g",
  sheetId: "s",
  tiles: [
    ...Array.from({ length: 16 }, (_, m) => ({ frameId: `f${m}`, collision: false, tags: [], terrain: "grass", mask: m })),
    { frameId: "x", collision: false, tags: [] },
  ],
};

const apply = (data: number[], changes: { index: number; value: number }[]) => changes.forEach((c) => (data[c.index] = c.value));

describe("planAutotile", () => {
  it("picks edge tiles for a horizontal run: W-only, E+W, E-only", () => {
    const data = new Array(5 * 3).fill(0);
    apply(data, planAutotile(data, 5, 3, blob, "grass", [6, 7, 8])); // row 1, x=1..3
    expect([data[6], data[7], data[8]]).toEqual([2 /*E*/ + 1, 2 + 8 + 1 /*E+W*/, 8 + 1 /*W*/]);
  });

  it("re-fits neighbours when a cell is added next to an existing one", () => {
    const data = new Array(3 * 3).fill(0);
    apply(data, planAutotile(data, 3, 3, blob, "grass", [4])); // centre alone -> mask 0
    expect(data[4]).toBe(1);
    apply(data, planAutotile(data, 3, 3, blob, "grass", [5])); // add east neighbour
    expect([data[4], data[5]]).toEqual([2 + 1 /*E*/, 8 + 1 /*W*/]);
  });

  it("erasing clears the cell and re-fits what is left", () => {
    const data = new Array(3 * 1).fill(0);
    apply(data, planAutotile(data, 3, 1, blob, "grass", [0, 1, 2]));
    apply(data, planAutotile(data, 3, 1, blob, null, [1]));
    expect(data).toEqual([1, 0, 1]); // both ends are now isolated (mask 0)
  });

  it("does not connect different terrains and leaves non-terrain tiles alone", () => {
    const data = [17, 0, 0];
    apply(data, planAutotile(data, 3, 1, blob, "grass", [1]));
    expect(data).toEqual([17, 1, 0]); // tile 17 has no terrain so it is neither connected nor rewritten
  });

  it("falls back to mask 15, then to any tile of the terrain, when a mask is missing", () => {
    const sparse: Tileset = { ...blob, tiles: [{ frameId: "a", collision: false, tags: [], terrain: "t", mask: 15 }, { frameId: "b", collision: false, tags: [], terrain: "t" }] };
    const data = [0, 0, 0];
    apply(data, planAutotile(data, 3, 1, sparse, "t", [0, 1, 2]));
    expect(data).toEqual([1, 1, 1]);
  });

  it("rejects an unknown terrain with a clear message", () => {
    expect(() => planAutotile([0], 1, 1, blob, "lava", [0])).toThrow('no tiles with terrain "lava"');
  });
});

describe("stampCells", () => {
  it("places a block, skips zeros and clips at the map edge", () => {
    expect(stampCells(3, 2, 1, 0, [[5, 0], [6, 7]])).toEqual([{ index: 1, value: 5 }, { index: 3 + 1, value: 6 }, { index: 3 + 2, value: 7 }]);
    expect(stampCells(3, 2, 2, 1, [[1, 2], [3, 4]])).toEqual([{ index: 5, value: 1 }]);
  });
});

describe("copy op", () => {
  it("copies a region, shears rows, and clips to the destination rectangle", () => {
    const img = createImage(8, 2);
    applyDrawOps(img, [
      { op: "rect", x: 0, y: 0, w: 3, h: 2, color: "#f00" },
      { op: "copy", x: 0, y: 0, w: 3, h: 2, dx: 4, dy: 0, rowShift: [1, -1] },
    ]);
    // row 0 shifted right by 1 inside the 3-wide window (4..6): pixels at 5,6; row 1 shifted left: pixels at 4,5
    expect(imageToRows(img).rows).toEqual(["aaa..aa.", "aaa.aa.."]);
  });

  it("flips horizontally and does not smear when source and destination overlap", () => {
    const img = createImage(4, 1);
    applyDrawOps(img, [{ op: "pixels", points: [{ x: 0, y: 0 }], color: "#f00" }, { op: "pixels", points: [{ x: 1, y: 0 }], color: "#0f0" }]);
    applyDrawOps(img, [{ op: "copy", x: 0, y: 0, w: 2, h: 1, dx: 0, dy: 0, flipX: true }]);
    // symbols are numbered by first appearance, so check colours: green is now the left pixel
    expect(imageToRows(img)).toMatchObject({ rows: ["ab.."], legend: { a: "#00ff00", b: "#ff0000" } });
  });

  it("flips vertically", () => {
    const img = createImage(1, 3);
    applyDrawOps(img, [{ op: "pixels", points: [{ x: 0, y: 0 }], color: "#f00" }, { op: "copy", x: 0, y: 0, w: 1, h: 3, dx: 0, dy: 0, flipY: true }]);
    expect(imageToRows(img).rows).toEqual([".", ".", "a"]);
  });
});

describe("exportAtlas", () => {
  const sheet: SpriteSheet = { id: "hero", image: "assets/hero.png", margin: 0, spacing: 0, frames: [0, 1].map((n) => ({ id: `hero_${n}`, name: `idle_${n}`, rect: { x: n * 16, y: 0, w: 16, h: 16 }, pivot: { x: 0.5, y: 1 } })) };
  const anim: Animation = { id: "idle", name: "Idle", sheetId: "hero", frames: [{ frameId: "hero_0", durationMs: 100 }, { frameId: "hero_1", durationMs: 300 }], loop: true, tags: [] };

  it("writes JSON-hash frames, meta and animations by frame name", () => {
    const a: any = exportAtlas(sheet, { width: 32, height: 16 }, [anim]);
    expect(a.frames.idle_1.frame).toEqual({ x: 16, y: 0, w: 16, h: 16 });
    expect(a.meta).toMatchObject({ image: "hero.png", size: { w: 32, h: 16 } });
    expect(a.animations.idle).toEqual({ frames: ["idle_0", "idle_1"], durations: [100, 300], frameRate: 5, repeat: -1 });
  });

  it("rejects duplicate frame names and dangling animation frames", () => {
    const dup = { ...sheet, frames: sheet.frames.map((f) => ({ ...f, name: "same" })) };
    expect(() => exportAtlas(dup, { width: 32, height: 16 })).toThrow("Duplicate frame name");
    expect(() => exportAtlas(sheet, { width: 32, height: 16 }, [{ ...anim, frames: [{ frameId: "gone", durationMs: 50 }] }])).toThrow('missing frame "gone"');
  });
});
