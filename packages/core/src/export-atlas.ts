import type { Animation, SpriteSheet } from "./schema";

/**
 * Sprite atlas in the "JSON hash" layout that Phaser, PixiJS and many engine importers read:
 * { frames: { name: { frame: {x,y,w,h}, ... } }, meta: { image, size, ... } }.
 * Animations are added under a top-level `animations` key ({ id: { frames: [names], frameRate, repeat } });
 * loaders that don't know it ignore it.
 */
export function exportAtlas(sheet: SpriteSheet, imageSize: { width: number; height: number }, animations: Animation[] = [], imageFile = sheet.image.split("/").pop()!) {
  const frames: Record<string, unknown> = {};
  const nameOf = new Map<string, string>();
  for (const f of sheet.frames) {
    if (nameOf.has(f.id) || frames[f.name]) throw new Error(`Duplicate frame name "${f.name}" in sheet "${sheet.id}"`);
    nameOf.set(f.id, f.name);
    frames[f.name] = {
      frame: { x: f.rect.x, y: f.rect.y, w: f.rect.w, h: f.rect.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: f.rect.w, h: f.rect.h },
      sourceSize: { w: f.rect.w, h: f.rect.h },
      pivot: f.pivot,
    };
  }
  const anims: Record<string, unknown> = {};
  for (const a of animations.filter((a) => a.sheetId === sheet.id)) {
    const names = a.frames.map((s) => {
      const n = nameOf.get(s.frameId);
      if (!n) throw new Error(`Animation "${a.id}" uses missing frame "${s.frameId}"`);
      return n;
    });
    const avg = a.frames.reduce((t, s) => t + s.durationMs, 0) / a.frames.length;
    anims[a.id] = { frames: names, durations: a.frames.map((s) => s.durationMs), frameRate: Math.round((1000 / avg) * 100) / 100, repeat: a.loop ? -1 : 0 };
  }
  return {
    frames,
    animations: anims,
    meta: { app: "mon-spire-editor", version: "1", image: imageFile, format: "RGBA8888", size: { w: imageSize.width, h: imageSize.height }, scale: "1" },
  };
}
