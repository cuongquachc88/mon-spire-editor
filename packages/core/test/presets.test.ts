import { describe, expect, it } from "vitest";
import { PALETTES, STYLE_PACKS, SUBJECT_CATEGORIES, SUBJECT_PRESETS, SpriteSpecSchema, buildSpritePrompt, findStylePack, findSubjectPreset } from "../src";

describe("subject presets", () => {
  it("has many presets, in every category, with unique ids and labels", () => {
    expect(SUBJECT_PRESETS.length).toBeGreaterThanOrEqual(40);
    for (const c of SUBJECT_CATEGORIES) expect(SUBJECT_PRESETS.filter((x) => x.category === c).length, c).toBeGreaterThanOrEqual(4);
    expect(new Set(SUBJECT_PRESETS.map((x) => x.id)).size).toBe(SUBJECT_PRESETS.length);
    expect(new Set(SUBJECT_PRESETS.map((x) => x.label)).size).toBe(SUBJECT_PRESETS.length);
  });

  it("every preset builds a valid request and a prompt that mentions its size", () => {
    for (const pr of SUBJECT_PRESETS) {
      const r = SpriteSpecSchema.safeParse({ style: "snes", ...pr.spec, sheetId: pr.id });
      expect(r.success, `${pr.id}: ${!r.success ? r.error.issues[0]?.message : ""}`).toBe(true);
      if (r.success) {
        const prompt = buildSpritePrompt(r.data);
        expect(prompt).toContain(`${r.data.width}x${r.data.height} pixels`);
        expect(prompt, pr.id).toContain(pr.spec.subject!);
      }
    }
  });

  it("animated presets say what moves, and single-frame ones do not claim frames", () => {
    for (const pr of SUBJECT_PRESETS) {
      if ((pr.spec.frames ?? 1) > 1) expect(pr.spec.motion?.length ?? 0, `${pr.id} needs a motion description`).toBeGreaterThan(8);
      else expect(pr.spec.motion ?? "", pr.id).toBe("");
    }
  });

  it("finds a preset by id or by label, ignoring case", () => {
    expect(findSubjectPreset("hero-walk")?.spec.frames).toBe(6);
    expect(findSubjectPreset("Treasure Chest")?.id).toBe("chest");
    expect(findSubjectPreset("nope")).toBeUndefined();
  });
});

describe("style packs and palettes", () => {
  it("every pack is valid on top of a sprite and fixed palettes are well-formed hex", () => {
    for (const pack of STYLE_PACKS) {
      const r = SpriteSpecSchema.safeParse({ subject: "x", width: 16, height: 16, sheetId: "x", ...pack.spec });
      expect(r.success, `${pack.id}`).toBe(true);
    }
    for (const [name, list] of Object.entries(PALETTES)) {
      expect(list.every((c) => /^#[0-9a-f]{6}$/.test(c)), name).toBe(true);
      expect(new Set(list).size, `${name} has duplicates`).toBe(list.length);
    }
    expect(PALETTES.pico8).toHaveLength(16);
    expect(PALETTES.gameboy).toHaveLength(4);
    expect(PALETTES.sweetie16).toHaveLength(16);
  });

  it("a fixed-palette pack makes the prompt demand exactly those colours", () => {
    const pack = findStylePack("pico8")!;
    const prompt = buildSpritePrompt(SpriteSpecSchema.parse({ subject: "a coin", width: 16, height: 16, sheetId: "coin", ...pack.spec }));
    expect(prompt).toContain("exactly this palette (add nothing else): #000000, #1d2b53");
    expect(prompt).not.toContain("at most");
  });
});
