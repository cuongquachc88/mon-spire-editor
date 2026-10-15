import type { PixelImage, SpriteSheet, Tileset } from "@mse/core";
import { toImageData } from "./image";

export interface TileArt {
  canvas: HTMLCanvasElement;
  url: string;
}

/** Crop each tile's frame out of the sheet image. Index i is tile number i+1; null if art is missing. */
export function buildTileArt(tileset: Tileset | undefined, sheet: SpriteSheet | undefined, image: PixelImage | undefined): (TileArt | null)[] {
  if (!tileset) return [];
  return tileset.tiles.map((t) => {
    const frame = sheet?.frames.find((f) => f.id === t.frameId);
    if (!frame || !image) return null;
    const { x, y, w, h } = frame.rect;
    if (x < 0 || y < 0 || x + w > image.width || y + h > image.height) return null;
    const crop: PixelImage = { width: w, height: h, data: new Uint32Array(w * h) };
    for (let row = 0; row < h; row++) {
      const from = (y + row) * image.width + x;
      crop.data.set(image.data.subarray(from, from + w), row * w);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.putImageData(toImageData(crop), 0, 0);
    return { canvas, url: canvas.toDataURL() };
  });
}

/** Stable placeholder color for tiles without art, matching the MCP preview renderer's idea. */
export function placeholderColor(n: number) {
  return `hsl(${(n * 137.5) % 360} 55% 45%)`;
}

/** Crop every frame of a sheet; keyed by frame id. Frames outside the image are skipped. */
export function buildFrameArt(sheet: SpriteSheet | undefined, image: PixelImage | undefined): Map<string, TileArt> {
  const out = new Map<string, TileArt>();
  if (!sheet || !image) return out;
  const fake: Tileset = {
    id: "",
    name: "",
    sheetId: sheet.id,
    tiles: sheet.frames.map((f) => ({ frameId: f.id, collision: false, tags: [] })),
  };
  buildTileArt(fake, sheet, image).forEach((a, i) => a && out.set(sheet.frames[i]!.id, a));
  return out;
}
