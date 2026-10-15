import { describe, expect, it } from "vitest";
import { buildSpritePrompt, MemoryFs, ProjectStore, slugify, SpriteSpecSchema, type SpriteRequest } from "../src";

const spec = (over: object = {}) => SpriteSpecSchema.parse({ subject: "a red slime", width: 16, height: 16, sheetId: "slime", ...over });

describe("buildSpritePrompt", () => {
  it("states size, style, palette limit, light and the tool workflow for a single sprite", () => {
    const p = buildSpritePrompt(spec());
    expect(p).toContain("Draw a world prop: a red slime");
    expect(p).toContain("16x16 pixels");
    expect(p).toContain("at most 16 colours");
    expect(p).toContain("light comes from the top-left");
    expect(p).toContain('sprite_create id "slime" width 16 height 16');
    expect(p).toContain("sprite_preview");
    expect(p).not.toContain("animation_create"); // one frame: no animation steps
    expect(p).toContain('request_complete');
  });

  it("adds frame layout, copy/rowShift guidance and animation steps for multi-frame sprites", () => {
    const p = buildSpritePrompt(spec({ frames: 4, motion: "bounces up and down", width: 24, height: 20 }));
    expect(p).toContain("4 frames side by side (96x20 sheet)");
    expect(p).toContain("sprite_create id \"slime\" width 96 height 20");
    expect(p).toContain("Animation: bounces up and down");
    expect(p).toContain("frames 1..3");
    expect(p).toContain("sprite_slice with frameWidth 24 and frameHeight 20");
    expect(p).toContain('animation_create id "slime"');
  });

  it("uses an exact palette when given and mentions notes", () => {
    const p = buildSpritePrompt(spec({ palette: ["#ff0000", "#220000"], notes: "wears a tiny crown" }));
    expect(p).toContain("exactly this palette (add nothing else): #ff0000, #220000");
    expect(p).not.toContain("at most");
    expect(p).toContain("wears a tiny crown");
  });
});

describe("SpriteSpecSchema", () => {
  it("rejects an empty subject, a bad sheet id and non-hex palette entries with clear messages", () => {
    expect(SpriteSpecSchema.safeParse({ subject: " ", width: 16, height: 16, sheetId: "x" }).success).toBe(false);
    expect(SpriteSpecSchema.safeParse({ subject: "a", width: 16, height: 16, sheetId: "bad id" }).success).toBe(false);
    expect(SpriteSpecSchema.safeParse({ subject: "a", width: 16, height: 16, sheetId: "x", palette: ["red"] }).success).toBe(false);
  });
});

describe("slugify", () => {
  it("makes safe ids", () => {
    expect(slugify("Red Slime!")).toBe("red-slime");
    expect(slugify("Cây táo")).toBe("cay-tao");
    expect(slugify("!!!")).toBe("sprite");
    expect(slugify("a friendly green slime with two eyes")).toBe("a-friendly-green-slime-with-two"); // cut at 32 chars, no trailing dash
  });
});

describe("requests in the project store", () => {
  it("saves, registers, reloads and removes a request", async () => {
    const store = new ProjectStore(new MemoryFs(), "/p");
    await store.init("demo");
    const now = new Date().toISOString();
    const req: SpriteRequest = { id: "r1", createdAt: now, updatedAt: now, status: "pending", spec: spec(), prompt: buildSpritePrompt(spec()) };
    await store.saveRequest(req);
    expect((await store.loadProject()).requests).toEqual(["r1"]);
    expect((await store.loadRequest("r1")).status).toBe("pending");
    await store.remove("requests", "r1");
    expect((await store.loadProject()).requests).toEqual([]);
  });

  it("loads projects written before requests existed", async () => {
    const fs = new MemoryFs();
    await fs.writeText("/p/project.json", JSON.stringify({ version: 1, name: "old", tileSize: 16, sheets: [], animations: [], tilesets: [], maps: [] }));
    expect((await new ProjectStore(fs, "/p").loadProject()).requests).toEqual([]);
  });
});
