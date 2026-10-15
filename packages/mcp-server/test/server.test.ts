import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { MemoryFs, ProjectStore, SpriteSpecSchema, buildSpritePrompt } from "@mse/core";
import { createServer } from "../src/server";

let client: Client;
let store: ProjectStore;
let memfs: MemoryFs;

async function call(name: string, args: Record<string, unknown> = {}) {
  const res: any = await client.callTool({ name, arguments: args });
  return { isError: !!res.isError, text: res.content[0].type === "text" ? res.content[0].text : "", raw: res };
}

beforeEach(async () => {
  const fs = (memfs = new MemoryFs());
  store = new ProjectStore(fs, "/p");
  await store.init("demo", 16);
  await store.saveSheet({ id: "terrain", image: "terrain.png", margin: 0, spacing: 0, frames: [] });
  await store.saveTileset({
    id: "ground",
    name: "Ground",
    sheetId: "terrain",
    tiles: [
      { frameId: "a", collision: false, tags: [] },
      { frameId: "b", collision: true, tags: [] },
    ],
  });
  const server = createServer(store, fs);
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

describe("map tools", () => {
  it("creates a map, fills and edits cells, and reads it back as rows", async () => {
    expect((await call("map_create", { id: "town", name: "Town", width: 4, height: 3, tilesetId: "ground" })).isError).toBe(false);
    await call("map_fill", { mapId: "town", layerId: "ground", x: 0, y: 0, w: 4, h: 3, value: 1 });
    await call("map_set_tiles", { mapId: "town", layerId: "ground", cells: [{ x: 1, y: 1, value: 2 }] });

    const got = JSON.parse((await call("map_get", { id: "town" })).text);
    expect(got.layers[0].rows).toEqual(["1 1 1 1", "1 2 1 1", "1 1 1 1"]);
  });

  it("returns a tool error instead of throwing for out-of-range cells", async () => {
    await call("map_create", { id: "town", name: "Town", width: 2, height: 2, tilesetId: "ground" });
    const r = await call("map_set_tiles", { mapId: "town", layerId: "ground", cells: [{ x: 5, y: 0, value: 1 }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("outside");
  });

  it("does not partially apply a batch that contains a bad cell", async () => {
    await call("map_create", { id: "town", name: "Town", width: 2, height: 2, tilesetId: "ground" });
    await call("map_set_tiles", {
      mapId: "town",
      layerId: "ground",
      cells: [{ x: 0, y: 0, value: 1 }, { x: 9, y: 9, value: 1 }],
    });
    expect((await store.loadMap("town")).layers[0]).toMatchObject({ data: [0, 0, 0, 0] });
  });

  it("refuses to overwrite an existing map", async () => {
    await call("map_create", { id: "town", name: "Town", width: 2, height: 2, tilesetId: "ground" });
    expect((await call("map_create", { id: "town", name: "Again", width: 2, height: 2, tilesetId: "ground" })).isError).toBe(true);
  });

  it("validate flags tile ids beyond the tileset and entities out of bounds", async () => {
    await call("map_create", { id: "town", name: "Town", width: 2, height: 2, tilesetId: "ground" });
    await call("map_set_tiles", { mapId: "town", layerId: "ground", cells: [{ x: 0, y: 0, value: 7 }] });
    await call("layer_add", { mapId: "town", layerId: "npcs", name: "NPCs", kind: "object" });
    await call("entity_place", { mapId: "town", layerId: "npcs", entityId: "bob", type: "npc", x: 500, y: 0 });

    const v = JSON.parse((await call("map_validate", { id: "town" })).text);
    expect(v.ok).toBe(false);
    expect(v.problems).toHaveLength(2);
  });

  it("renders a PNG preview even when the sheet image is missing", async () => {
    await call("map_create", { id: "town", name: "Town", width: 4, height: 4, tilesetId: "ground" });
    await call("map_fill", { mapId: "town", layerId: "ground", x: 0, y: 0, w: 4, h: 4, value: 1 });
    const r = await call("map_render_preview", { id: "town", scale: 1 });
    expect(r.raw.content[0].type).toBe("image");
    const png = Buffer.from(r.raw.content[0].data, "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });
});

// 32x16 sheet: left 16x16 tile solid red, right 16x16 tile solid blue.
function twoTilePng() {
  const png = new PNG({ width: 32, height: 16 });
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 32; x++) png.data.set(x < 16 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 32 + x) * 4);
  return new Uint8Array(PNG.sync.write(png));
}

describe("sprite pipeline", () => {
  it("imports, slices, builds a tileset and renders the real art", async () => {
    await memfs.writeBinary("/src/art.png", twoTilePng());
    expect((await call("sprite_import", { id: "art", sourcePath: "/src/art.png" })).isError).toBe(false);
    expect((await call("sprite_slice", { sheetId: "art", frameWidth: 16, frameHeight: 16 })).text).toContain("2 frames");
    expect((await call("tileset_create", { id: "art-ts", name: "Art", sheetId: "art", collisionFrameIds: ["art_1"] })).isError).toBe(false);
    expect((await store.loadTileset("art-ts")).tiles.map((t) => t.collision)).toEqual([false, true]);

    await call("map_create", { id: "m", name: "M", width: 2, height: 1, tilesetId: "art-ts" });
    await call("map_set_tiles", { mapId: "m", layerId: "ground", cells: [{ x: 0, y: 0, value: 1 }, { x: 1, y: 0, value: 2 }] });

    const r = await call("map_render_preview", { id: "m", scale: 1 });
    const out = PNG.sync.read(Buffer.from(r.raw.content[0].data, "base64"));
    const px = (x: number, y: number) => [...out.data.subarray((y * out.width + x) * 4, (y * out.width + x) * 4 + 3)];
    expect(px(8, 8)).toEqual([255, 0, 0]);
    expect(px(24, 8)).toEqual([0, 0, 255]);
  });

  it("rejects non-PNG input, unknown frames, and slices that do not fit", async () => {
    await memfs.writeBinary("/src/bad.png", new Uint8Array([1, 2, 3]));
    expect((await call("sprite_import", { id: "bad", sourcePath: "/src/bad.png" })).isError).toBe(true);

    await memfs.writeBinary("/src/art.png", twoTilePng());
    await call("sprite_import", { id: "art", sourcePath: "/src/art.png" });
    expect((await call("sprite_slice", { sheetId: "art", frameWidth: 64, frameHeight: 64 })).isError).toBe(true);
    await call("sprite_slice", { sheetId: "art", frameWidth: 16, frameHeight: 16 });
    expect((await call("animation_create", { id: "a", name: "A", sheetId: "art", frameIds: ["art_9"] })).text).toContain("art_9");
  });

  it("creates an animation with uniform fps timing", async () => {
    await memfs.writeBinary("/src/art.png", twoTilePng());
    await call("sprite_import", { id: "art", sourcePath: "/src/art.png" });
    await call("sprite_slice", { sheetId: "art", frameWidth: 16, frameHeight: 16 });
    await call("animation_create", { id: "walk", name: "Walk", sheetId: "art", frameIds: ["art_0", "art_1"], fps: 10 });
    expect((await store.loadAnimation("walk")).frames).toEqual([
      { frameId: "art_0", durationMs: 100 },
      { frameId: "art_1", durationMs: 100 },
    ]);
  });

  it("project_validate catches references broken by re-slicing", async () => {
    await memfs.writeBinary("/src/art.png", twoTilePng());
    await call("sprite_import", { id: "art", sourcePath: "/src/art.png" });
    await call("sprite_slice", { sheetId: "art", frameWidth: 16, frameHeight: 16 });
    await call("tileset_create", { id: "art-ts", name: "Art", sheetId: "art" });
    await call("animation_create", { id: "walk", name: "Walk", sheetId: "art", frameIds: ["art_0", "art_1"] });
    // The shared fixture's own "ground" tileset points at frames that don't exist; that is a real finding, so only look at ours.
    const before = JSON.parse((await call("project_validate")).text);
    expect(before.problems.filter((p: string) => /art/.test(p))).toEqual([]);
    expect(before.problems.join("\n")).toContain('tileset "ground"');

    await call("sprite_slice", { sheetId: "art", frameWidth: 32, frameHeight: 16 }); // 1 frame now: art_1 vanishes
    const v = JSON.parse((await call("project_validate")).text);
    expect(v.ok).toBe(false);
    expect(v.problems.join("\n")).toContain('tileset "art-ts": tile 2 uses missing frame "art_1"');
    expect(v.problems.join("\n")).toContain('animation "walk": step 2 uses missing frame "art_1"');
  });

  it("export_tiled writes a tmj and tsj that reference the real image size", async () => {
    await memfs.writeBinary("/src/art.png", twoTilePng());
    await call("sprite_import", { id: "art", sourcePath: "/src/art.png" });
    await call("sprite_slice", { sheetId: "art", frameWidth: 16, frameHeight: 16 });
    await call("tileset_create", { id: "art-ts", name: "Art", sheetId: "art", collisionFrameIds: ["art_1"] });
    await call("map_create", { id: "m", name: "M", width: 2, height: 1, tilesetId: "art-ts" });
    await call("map_set_tiles", { mapId: "m", layerId: "ground", cells: [{ x: 0, y: 0, value: 2 }] });

    const r = await call("export_tiled", { mapId: "m" });
    expect(JSON.parse(r.text).written).toEqual(["export/tiled/m.tmj", "export/tiled/art-ts.tsj"]);
    const tmj = JSON.parse(await memfs.readText("/p/export/tiled/m.tmj"));
    expect(tmj.layers[0].data).toEqual([2, 0]);
    const tsj = JSON.parse(await memfs.readText("/p/export/tiled/art-ts.tsj"));
    expect(tsj.tiles[1]).toMatchObject({ imagewidth: 32, imageheight: 16, x: 16 });

    expect((await call("export_tiled", { mapId: "nope" })).isError).toBe(true);
  });
});

describe("pixel drawing tools", () => {
  it("creates, draws with shapes + rows, and reads back as text", async () => {
    expect((await call("sprite_create", { id: "gem", width: 6, height: 4 })).isError).toBe(false);
    const d = await call("sprite_draw", {
      sheetId: "gem",
      ops: [
        { op: "rect", x: 0, y: 0, w: 6, h: 1, color: "#333" },
        // '.' is not in the legend, so it leaves the pixel alone
        { op: "rows", x: 1, y: 1, rows: [".rr.", "rGGr"], legend: { r: "#f00", G: "#0f0" } },
      ],
    });
    expect(d.text).toContain("12 pixel(s) changed"); // 6 (rect) + 2 + 4 (rows)
    const got = JSON.parse((await call("sprite_get", { sheetId: "gem" })).text);
    expect(got.rows).toEqual(["aaaaaa", "..bb..", ".bccb.", "......"]);
    expect(got.legend).toEqual({ ".": "transparent", a: "#333333", b: "#ff0000", c: "#00ff00" });
  });

  it("a bad color fails the whole batch and leaves the image untouched", async () => {
    await call("sprite_create", { id: "gem", width: 3, height: 1 });
    const r = await call("sprite_draw", {
      sheetId: "gem",
      ops: [{ op: "pixels", points: [{ x: 0, y: 0 }], color: "#fff" }, { op: "pixels", points: [{ x: 1, y: 0 }], color: "banana" }],
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Bad color "banana"');
    expect(JSON.parse((await call("sprite_get", { sheetId: "gem" })).text).rows).toEqual(["..."]);
  });

  it("previews as an enlarged PNG and rejects duplicate ids", async () => {
    await call("sprite_create", { id: "gem", width: 4, height: 4 });
    const p = await call("sprite_preview", { sheetId: "gem", scale: 3 });
    const png = PNG.sync.read(Buffer.from(p.raw.content[0].data, "base64"));
    expect([png.width, png.height]).toEqual([12, 12]);
    expect((await call("sprite_create", { id: "gem", width: 4, height: 4 })).isError).toBe(true);
  });

  it("supports the full draw -> slice -> tileset -> map chain", async () => {
    await call("sprite_create", { id: "t", width: 32, height: 16 });
    await call("sprite_draw", { sheetId: "t", ops: [{ op: "rect", x: 0, y: 0, w: 16, h: 16, color: "#0a0" }, { op: "rect", x: 16, y: 0, w: 16, h: 16, color: "#a00" }] });
    await call("sprite_slice", { sheetId: "t", frameWidth: 16, frameHeight: 16 });
    await call("tileset_create", { id: "t-ts", name: "T", sheetId: "t" });
    await call("map_create", { id: "m", name: "M", width: 2, height: 1, tilesetId: "t-ts" });
    await call("map_set_tiles", { mapId: "m", layerId: "ground", cells: [{ x: 0, y: 0, value: 1 }, { x: 1, y: 0, value: 2 }] });
    const out = PNG.sync.read(Buffer.from((await call("map_render_preview", { id: "m", scale: 1 })).raw.content[0].data, "base64"));
    const px = (x: number, y: number) => [...out.data.subarray((y * out.width + x) * 4, (y * out.width + x) * 4 + 3)];
    expect(px(8, 8)).toEqual([0, 170, 0]);
    expect(px(24, 8)).toEqual([170, 0, 0]);
  });

  it("map preview blends semi-transparent pixels instead of painting them solid", async () => {
    await call("sprite_create", { id: "sh", width: 16, height: 16 });
    await call("sprite_draw", { sheetId: "sh", ops: [{ op: "rect", x: 0, y: 0, w: 16, h: 16, color: "#00000080" }] });
    await call("sprite_slice", { sheetId: "sh", frameWidth: 16, frameHeight: 16 });
    await call("tileset_create", { id: "sh-ts", name: "S", sheetId: "sh" });
    await call("map_create", { id: "m", name: "M", width: 1, height: 1, tilesetId: "sh-ts" });
    await call("map_set_tiles", { mapId: "m", layerId: "ground", cells: [{ x: 0, y: 0, value: 1 }] });
    const out = PNG.sync.read(Buffer.from((await call("map_render_preview", { id: "m", scale: 1 })).raw.content[0].data, "base64"));
    // background is (32,32,36); 50% black over it is ~ (16,16,18), not pure black
    expect(out.data[(8 * out.width + 8) * 4]).toBeGreaterThan(10);
    expect(out.data[(8 * out.width + 8) * 4]).toBeLessThan(24);
  });
});

describe("market-inspired tools", () => {
  async function terrainSetup() {
    // 16-tile blob set: tile n+1 has mask n
    await call("sprite_create", { id: "tr", width: 64, height: 16 });
    await call("sprite_slice", { sheetId: "tr", frameWidth: 4, frameHeight: 16 });
    await call("tileset_create", { id: "tr-ts", name: "T", sheetId: "tr" });
    await call("tileset_define_terrain", { tilesetId: "tr-ts", terrain: "grass", tiles: Array.from({ length: 16 }, (_, m) => ({ tile: m + 1, mask: m })) });
    await call("map_create", { id: "m", name: "M", width: 5, height: 3, tilesetId: "tr-ts" });
  }

  it("map_autotile picks edge tiles and re-fits neighbours; erase restores isolation", async () => {
    await terrainSetup();
    const r = await call("map_autotile", { mapId: "m", layerId: "ground", terrain: "grass", cells: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }] });
    expect(r.isError).toBe(false);
    expect((await store.loadMap("m")).layers[0]).toMatchObject({ data: [0, 0, 0, 0, 0, 0, 3, 11, 9, 0, 0, 0, 0, 0, 0] });
    await call("map_autotile", { mapId: "m", layerId: "ground", terrain: "grass", erase: true, cells: [{ x: 2, y: 1 }] });
    expect((await store.loadMap("m")).layers[0]).toMatchObject({ data: [0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0] });
  });

  it("map_autotile explains an unknown terrain", async () => {
    await terrainSetup();
    const r = await call("map_autotile", { mapId: "m", layerId: "ground", terrain: "lava", cells: [{ x: 0, y: 0 }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('terrain "lava"');
  });

  it("map_stamp places a block, skipping zeros; an out-of-map stamp is an error", async () => {
    await terrainSetup();
    await call("map_stamp", { mapId: "m", layerId: "ground", x: 1, y: 0, rows: [[5, 0], [6, 7]] });
    expect((await store.loadMap("m")).layers[0]).toMatchObject({ data: [0, 5, 0, 0, 0, 0, 6, 7, 0, 0, 0, 0, 0, 0, 0] });
    expect((await call("map_stamp", { mapId: "m", layerId: "ground", x: 50, y: 50, rows: [[1]] })).isError).toBe(true);
  });

  it("sprite_draw copy + rowShift derives a swayed frame", async () => {
    await call("sprite_create", { id: "sway", width: 8, height: 2 });
    await call("sprite_draw", { sheetId: "sway", ops: [
      { op: "rect", x: 1, y: 0, w: 2, h: 2, color: "#0a0" },
      // copy the 4x2 block to x=4; row 0 is pushed right by one pixel, row 1 stays
      { op: "copy", x: 0, y: 0, w: 4, h: 2, dx: 4, dy: 0, rowShift: [1, 0] },
    ] });
    expect(JSON.parse((await call("sprite_get", { sheetId: "sway" })).text).rows).toEqual([".aa...aa", ".aa..aa."]);
  });

  it("export_atlas writes frames, animations and a copy of the PNG", async () => {
    await call("sprite_create", { id: "hero", width: 32, height: 16 });
    await call("sprite_slice", { sheetId: "hero", frameWidth: 16, frameHeight: 16 });
    await call("animation_create", { id: "idle", name: "Idle", sheetId: "hero", frameIds: ["hero_0", "hero_1"], fps: 4 });
    const r = await call("export_atlas", { sheetId: "hero" });
    expect(JSON.parse(r.text)).toMatchObject({ written: ["export/atlas/hero.json", "export/atlas/hero.png"], frames: 2, animations: ["idle"] });
    const atlas = JSON.parse(await memfs.readText("/p/export/atlas/hero.json"));
    expect(atlas.frames.hero_1.frame).toEqual({ x: 16, y: 0, w: 16, h: 16 });
    expect(atlas.animations.idle).toMatchObject({ frames: ["hero_0", "hero_1"], frameRate: 4, repeat: -1 });
    expect(await memfs.exists("/p/export/atlas/hero.png")).toBe(true);
  });

  it("map preview draws an entity's animation (first frame, bottom-centre anchored)", async () => {
    await call("sprite_create", { id: "blob", width: 16, height: 16 });
    await call("sprite_draw", { sheetId: "blob", ops: [{ op: "rect", x: 0, y: 0, w: 16, h: 16, color: "#ff00ff" }] });
    await call("sprite_slice", { sheetId: "blob", frameWidth: 16, frameHeight: 16 });
    await call("animation_create", { id: "blob-idle", name: "B", sheetId: "blob", frameIds: ["blob_0"] });
    await call("map_create", { id: "m", name: "M", width: 3, height: 3, tilesetId: "ground" });
    await call("layer_add", { mapId: "m", layerId: "fx", name: "FX", kind: "object" });
    await call("entity_place", { mapId: "m", layerId: "fx", entityId: "b1", type: "blob", x: 24, y: 32, props: { animation: "blob-idle" } });
    const out = PNG.sync.read(Buffer.from((await call("map_render_preview", { id: "m", scale: 1 })).raw.content[0].data, "base64"));
    const px = (x: number, y: number) => [...out.data.subarray((y * out.width + x) * 4, (y * out.width + x) * 4 + 3)];
    expect(px(24, 24)).toEqual([255, 0, 255]); // sprite spans x 16..31, y 16..31 (bottom-centre at 24,32)
    expect(px(8, 8)).not.toEqual([255, 0, 255]);
  });
});

describe("sprite requests and prompts", () => {
  const spec = { subject: "a red slime", kind: "creature", width: 16, height: 16, frames: 1, style: "snes", sheetId: "slime" };
  async function queue(id: string, over: object = {}) {
    const now = new Date(Date.now() + queue.n++).toISOString();
    const parsed = SpriteSpecSchema.parse({ ...spec, ...over });
    await store.saveRequest({ id, createdAt: now, updatedAt: now, status: "pending", spec: parsed, prompt: buildSpritePrompt(parsed) });
  }
  queue.n = 0;

  it("lists requests oldest first and claims the oldest pending one with its full prompt", async () => {
    await queue("r1", { sheetId: "first" });
    await queue("r2", { sheetId: "second" });
    expect(JSON.parse((await call("request_list")).text).map((r: any) => r.id)).toEqual(["r1", "r2"]);
    const claimed = JSON.parse((await call("request_claim")).text);
    expect(claimed.id).toBe("r1");
    expect(claimed.prompt).toContain('sprite_create id "first"');
    expect((await store.loadRequest("r1")).status).toBe("in_progress");
    expect(JSON.parse((await call("request_claim")).text).id).toBe("r2"); // r1 is taken, so the next one
    expect((await call("request_claim")).text).toBe("No pending requests.");
  });

  it("complete needs the sheet to exist; then the request is done and linked to its result", async () => {
    await queue("r1");
    await call("request_claim");
    const early = await call("request_complete", { id: "r1" });
    expect(early.isError).toBe(true);
    expect(early.text).toContain('Sheet "slime" does not exist yet');
    await call("sprite_create", { id: "slime", width: 16, height: 16 });
    expect((await call("request_complete", { id: "r1", note: "green blob" })).isError).toBe(false);
    expect(await store.loadRequest("r1")).toMatchObject({ status: "done", resultSheetId: "slime", note: "green blob" });
    expect((await call("request_claim", { id: "r1" })).isError).toBe(true); // finished work cannot be re-claimed
  });

  it("fail records a readable reason", async () => {
    await queue("r1");
    await call("request_fail", { id: "r1", reason: "The subject is too vague" });
    expect(await store.loadRequest("r1")).toMatchObject({ status: "failed", note: "The subject is too vague" });
    expect((await call("request_fail", { id: "nope", reason: "x" })).isError).toBe(true);
  });

  it("offers draw_sprite and do_pending_requests as MCP prompts", async () => {
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toEqual(expect.arrayContaining(["draw_sprite", "do_pending_requests"]));
    const got = await client.getPrompt({ name: "draw_sprite", arguments: { subject: "Cây táo", size: "24x32", frames: "3" } });
    const text = (got.messages[0]!.content as { text: string }).text;
    expect(text).toContain("24x32 pixels per frame, 3 frames");
    expect(text).toContain('sprite_create id "cay-tao"');
    // presets and style packs
    const walk = await client.getPrompt({ name: "draw_sprite", arguments: { preset: "hero-walk", style_pack: "pico8" } });
    const wt = (walk.messages[0]!.content as { text: string }).text;
    expect(wt).toContain("6 frames side by side (192x32 sheet)");
    expect(wt).toContain("walk cycle");
    expect(wt).toContain("exactly this palette (add nothing else): #000000");
    expect(wt).toContain('sprite_create id "hero-walk"');
    const over = await client.getPrompt({ name: "draw_sprite", arguments: { preset: "slime", subject: "a blue slime", frames: "2" } });
    expect((over.messages[0]!.content as { text: string }).text).toContain("a blue slime");
    for (const args of [{ preset: "nope" }, { subject: "x", style_pack: "nope" }, {}] as Record<string, string>[]) {
      const r = await client.getPrompt({ name: "draw_sprite", arguments: args });
      expect((r.messages[0]!.content as { text: string }).text).toMatch(/Unknown|Tell me what to draw/);
    }
    const bad = await client.getPrompt({ name: "draw_sprite", arguments: { subject: "x", size: "9999" } });
    expect((bad.messages[0]!.content as { text: string }).text).toContain("Could not build the brief");
  });
});

describe("sheet_delete", () => {
  it("deletes a sheet with its animations and PNG", async () => {
    await call("sprite_create", { id: "tmp", width: 32, height: 16 });
    await call("sprite_slice", { sheetId: "tmp", frameWidth: 16, frameHeight: 16 });
    await call("animation_create", { id: "tmp-anim", name: "T", sheetId: "tmp", frameIds: ["tmp_0", "tmp_1"] });
    const r = await call("sheet_delete", { id: "tmp" });
    expect(r.text).toBe('Deleted sheet "tmp" and animation(s) tmp-anim and its PNG.');
    expect(await memfs.exists("/p/assets/tmp.png")).toBe(false);
    expect((await store.loadProject()).animations).toEqual([]);
  });

  it("is refused while a tileset uses the sheet, leaving everything in place", async () => {
    const r = await call("sheet_delete", { id: "terrain" }); // the fixture's "ground" tileset uses it
    expect(r.isError).toBe(true);
    expect(r.text).toContain("used by tileset ground");
    expect((await store.loadProject()).sheets).toContain("terrain");
  });

  it("reports an unknown sheet instead of crashing", async () => {
    expect((await call("sheet_delete", { id: "ghost" })).isError).toBe(true);
  });
});
