import { PNG } from "pngjs";
import type { Animation, MapData, SpriteSheet, Tileset } from "@mse/core";

export interface RenderInput {
  map: MapData;
  tilesets: Map<string, Tileset>;
  /** Decoded sheet images by sheet id. Missing sheets fall back to flat colors. */
  sheets: Map<string, { sheet: SpriteSheet; png: PNG }>;
  /** Animations by id; entities with props.animation draw that animation's first frame, anchored bottom-centre. */
  animations?: Map<string, Animation>;
  scale?: number;
}

// Deterministic fallback color per tile index so layouts are readable without art.
function fallbackColor(v: number): [number, number, number] {
  const h = (v * 137.508) % 360;
  const c = 0.55;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const m = 0.3;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function renderMapPng({ map, tilesets, sheets, animations, scale = 2 }: RenderInput): Buffer {
  const ts = map.tileSize;
  const out = new PNG({ width: map.width * ts * scale, height: map.height * ts * scale });
  // Background
  for (let i = 0; i < out.data.length; i += 4) out.data.set([32, 32, 36, 255], i);

  // Alpha-blend over what is already drawn, so soft shadows and semi-transparent art look right.
  const put = (px: number, py: number, rgba: [number, number, number, number]) => {
    const a = rgba[3] / 255;
    if (a === 0) return;
    for (let dy = 0; dy < scale; dy++)
      for (let dx = 0; dx < scale; dx++) {
        const o = ((py * scale + dy) * out.width + (px * scale + dx)) * 4;
        out.data[o] = Math.round(rgba[0] * a + out.data[o]! * (1 - a));
        out.data[o + 1] = Math.round(rgba[1] * a + out.data[o + 1]! * (1 - a));
        out.data[o + 2] = Math.round(rgba[2] * a + out.data[o + 2]! * (1 - a));
        out.data[o + 3] = 255;
      }
  };

  for (const layer of map.layers) {
    if (!layer.visible) continue;

    if (layer.kind === "tile") {
      const tileset = tilesets.get(layer.tilesetId);
      const sheetEntry = tileset ? sheets.get(tileset.sheetId) : undefined;
      for (let i = 0; i < layer.data.length; i++) {
        const v = layer.data[i]!;
        if (v === 0) continue;
        const ox = (i % map.width) * ts;
        const oy = Math.floor(i / map.width) * ts;
        const frame = sheetEntry && tileset?.tiles[v - 1]
          ? sheetEntry.sheet.frames.find((f) => f.id === tileset.tiles[v - 1]!.frameId)
          : undefined;
        for (let y = 0; y < ts; y++)
          for (let x = 0; x < ts; x++) {
            if (frame && sheetEntry) {
              const sx = frame.rect.x + Math.min(x, frame.rect.w - 1);
              const sy = frame.rect.y + Math.min(y, frame.rect.h - 1);
              const o = (sy * sheetEntry.png.width + sx) * 4;
              const d = sheetEntry.png.data;
              put(ox + x, oy + y, [d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!]);
            } else {
              const [r, g, b] = fallbackColor(v);
              put(ox + x, oy + y, [r, g, b, 255]);
            }
          }
      }
    } else if (layer.kind === "collision") {
      for (let i = 0; i < layer.data.length; i++) {
        if (!layer.data[i]) continue;
        const ox = (i % map.width) * ts;
        const oy = Math.floor(i / map.width) * ts;
        for (let k = 0; k < ts; k++) {
          put(ox + k, oy + k, [255, 60, 60, 255]);
          put(ox + k, oy + ts - 1 - k, [255, 60, 60, 255]);
        }
      }
    } else {
      for (const e of layer.entities) {
        const cx = Math.round(e.x);
        const cy = Math.round(e.y);
        const anim = typeof e.props.animation === "string" ? animations?.get(e.props.animation) : undefined;
        const entry = anim ? sheets.get(anim.sheetId) : undefined;
        const frame = entry && anim?.frames[0] ? entry.sheet.frames.find((f) => f.id === anim.frames[0]!.frameId) : undefined;
        if (frame && entry) {
          for (let y = 0; y < frame.rect.h; y++)
            for (let x = 0; x < frame.rect.w; x++) {
              const o = ((frame.rect.y + y) * entry.png.width + frame.rect.x + x) * 4;
              const d = entry.png.data;
              put(cx - Math.floor(frame.rect.w / 2) + x, cy - frame.rect.h + y, [d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!]);
            }
        }
        for (let d = -3; d <= 3; d++) {
          put(cx + d, cy, [255, 255, 0, 255]);
          put(cx, cy + d, [255, 255, 0, 255]);
        }
      }
    }
  }

  // Grid lines
  for (let gx = 0; gx <= map.width; gx++)
    for (let y = 0; y < map.height * ts; y++) {
      const x = Math.min(gx * ts, map.width * ts - 1);
      const o = ((y * scale) * out.width + x * scale) * 4;
      out.data[o] = out.data[o]! * 0.7;
      out.data[o + 1] = out.data[o + 1]! * 0.7;
      out.data[o + 2] = out.data[o + 2]! * 0.7;
    }
  for (let gy = 0; gy <= map.height; gy++)
    for (let x = 0; x < map.width * ts; x++) {
      const y = Math.min(gy * ts, map.height * ts - 1);
      const o = ((y * scale) * out.width + x * scale) * 4;
      out.data[o] = out.data[o]! * 0.7;
      out.data[o + 1] = out.data[o + 1]! * 0.7;
      out.data[o + 2] = out.data[o + 2]! * 0.7;
    }

  return PNG.sync.write(out);
}
