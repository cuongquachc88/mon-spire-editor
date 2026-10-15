import { createImage, type PixelImage } from "@mse/core";

/** Decode PNG bytes to packed pixels (no premultiplication loss: drawn on a transparent canvas). */
export async function decodePng(bytes: Uint8Array): Promise<PixelImage> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const img = createImage(bitmap.width, bitmap.height);
  img.data.set(new Uint32Array(data.buffer, data.byteOffset, bitmap.width * bitmap.height));
  bitmap.close();
  return img;
}

export async function encodePng(img: PixelImage): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d")!;
  const copy = new Uint8ClampedArray(img.data.length * 4);
  new Uint32Array(copy.buffer).set(img.data);
  ctx.putImageData(new ImageData(copy, img.width, img.height), 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
}

export function toImageData(img: PixelImage): ImageData {
  const copy = new Uint8ClampedArray(img.data.length * 4);
  new Uint32Array(copy.buffer).set(img.data);
  return new ImageData(copy, img.width, img.height);
}

export const toCssColor = (c: number) => `rgba(${c & 255},${(c >>> 8) & 255},${(c >>> 16) & 255},${(c >>> 24) / 255})`;

export function hexToPacked(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (((255 << 24) | ((n & 255) << 16) | (n & 0xff00) | (n >> 16)) >>> 0);
}
export function packedToHex(c: number): string {
  const h = (v: number) => v.toString(16).padStart(2, "0");
  return `#${h(c & 255)}${h((c >>> 8) & 255)}${h((c >>> 16) & 255)}`;
}
