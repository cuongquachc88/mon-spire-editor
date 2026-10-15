import type { Command } from "./commands";

/** Packed pixels: 0xAABBGGRR as a little-endian Uint32 view of RGBA bytes. */
export interface PixelImage {
  width: number;
  height: number;
  data: Uint32Array;
}

export const rgba = (r: number, g: number, b: number, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
export const unpack = (c: number) => ({ r: c & 255, g: (c >>> 8) & 255, b: (c >>> 16) & 255, a: c >>> 24 });

export const createImage = (width: number, height: number): PixelImage => ({
  width,
  height,
  data: new Uint32Array(width * height),
});

export type Point = { x: number; y: number };

/** Bresenham line, inclusive of both ends. */
export function lineCells(a: Point, b: Point): Point[] {
  const out: Point[] = [];
  let { x, y } = a;
  const dx = Math.abs(b.x - x);
  const dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1;
  const sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push({ x, y });
    if (x === b.x && y === b.y) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Rectangle between two corners (any order). */
export function rectCells(a: Point, b: Point, filled: boolean): Point[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const out: Point[] = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) if (filled || x === x0 || x === x1 || y === y0 || y === y1) out.push({ x, y });
  return out;
}

/** 4-connected flood fill; returns the cell indices that share the start cell's value. */
export function floodCells(width: number, height: number, get: (index: number) => number, start: Point): number[] {
  if (start.x < 0 || start.y < 0 || start.x >= width || start.y >= height) return [];
  const target = get(start.y * width + start.x);
  const seen = new Uint8Array(width * height);
  const out: number[] = [];
  const stack = [start.y * width + start.x];
  seen[stack[0]!] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    out.push(i);
    const x = i % width, y = (i - x) / width;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (!seen[ni] && get(ni) === target) {
        seen[ni] = 1;
        stack.push(ni);
      }
    }
  }
  return out;
}

/** Writes pixels; keeps only changed cells so undo is a small delta. Consecutive strokes can merge. */
export class SetPixelsCommand implements Command<PixelImage> {
  private patches: { index: number; before: number; after: number }[] = [];
  private applied = false;

  constructor(
    readonly label: string,
    private cells: { index: number; value: number }[],
    private mergeKey?: string,
  ) {}

  apply(img: PixelImage) {
    this.patches = [];
    for (const { index, value } of this.cells) {
      const before = img.data[index];
      if (before === undefined) continue; // ignore off-canvas
      if (before === value) continue;
      img.data[index] = value;
      this.patches.push({ index, before, after: value });
    }
    this.applied = true;
  }

  revert(img: PixelImage) {
    for (let i = this.patches.length - 1; i >= 0; i--) img.data[this.patches[i]!.index] = this.patches[i]!.before;
  }

  get isEmpty() {
    return this.applied && this.patches.length === 0;
  }

  merge(next: Command<PixelImage>): Command<PixelImage> | null {
    if (!(next instanceof SetPixelsCommand) || !this.mergeKey || next.mergeKey !== this.mergeKey) return null;
    // `next` has already been applied; fold its patches in, keeping the oldest `before` per cell.
    const merged = new SetPixelsCommand(this.label, [], this.mergeKey);
    const first = new Map<number, { before: number; after: number }>();
    for (const p of [...this.patches, ...next.patches]) {
      const prev = first.get(p.index);
      first.set(p.index, { before: prev?.before ?? p.before, after: p.after });
    }
    merged.patches = [...first].map(([index, v]) => ({ index, ...v })).filter((p) => p.before !== p.after);
    // Redo re-runs apply(), so the merged command needs the final values as its cells.
    merged.cells = merged.patches.map((p) => ({ index: p.index, value: p.after }));
    merged.applied = true;
    return merged;
  }
}
