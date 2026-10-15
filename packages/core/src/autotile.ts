import type { Tileset } from "./schema";

export const N = 1, E = 2, S = 4, W = 8;

export interface CellChange {
  index: number;
  value: number;
}

/**
 * Plan the tile changes for painting (or erasing) a terrain, Tiled/LDtk style: every painted cell and its four
 * neighbours get re-picked so edges and corners line up. Pure: returns changes, does not touch `data`.
 *
 * - `terrain` null erases the painted cells (value 0) and re-fits their neighbours.
 * - For each affected cell of terrain T the tile is the one with terrain T and the matching 4-bit mask;
 *   if the tileset lacks that exact mask it falls back to mask 15, then any tile of T, then leaves the cell alone.
 */
export function planAutotile(
  data: readonly number[],
  width: number,
  height: number,
  tileset: Tileset,
  terrain: string | null,
  painted: readonly number[],
): CellChange[] {
  const terrainOf = (v: number) => (v > 0 ? tileset.tiles[v - 1]?.terrain : undefined);
  const lookup = new Map<string, number>(); // "terrain:mask" -> tile number (first one wins)
  const anyOf = new Map<string, number>();
  tileset.tiles.forEach((t, i) => {
    if (!t.terrain) return;
    if (t.mask !== undefined && !lookup.has(`${t.terrain}:${t.mask}`)) lookup.set(`${t.terrain}:${t.mask}`, i + 1);
    if (!anyOf.has(t.terrain)) anyOf.set(t.terrain, i + 1);
  });
  if (terrain && !anyOf.has(terrain)) throw new Error(`Tileset "${tileset.id}" has no tiles with terrain "${terrain}"`);

  // working view of which terrain each cell will have after painting
  const terr = new Map<number, string | undefined>();
  const terrAt = (i: number) => (terr.has(i) ? terr.get(i) : terrainOf(data[i]!));
  for (const i of painted) terr.set(i, terrain ?? undefined);

  const affected = new Set<number>();
  for (const i of painted) {
    const x = i % width, y = Math.floor(i / width);
    affected.add(i);
    if (y > 0) affected.add(i - width);
    if (y < height - 1) affected.add(i + width);
    if (x > 0) affected.add(i - 1);
    if (x < width - 1) affected.add(i + 1);
  }

  const out: CellChange[] = [];
  for (const i of affected) {
    const t = terrAt(i);
    let value: number | undefined;
    if (!t) {
      if (painted.includes(i)) value = 0; // erased
    } else {
      const x = i % width, y = Math.floor(i / width);
      const same = (nx: number, ny: number) => nx >= 0 && ny >= 0 && nx < width && ny < height && terrAt(ny * width + nx) === t;
      const mask = (same(x, y - 1) ? N : 0) | (same(x + 1, y) ? E : 0) | (same(x, y + 1) ? S : 0) | (same(x - 1, y) ? W : 0);
      value = lookup.get(`${t}:${mask}`) ?? lookup.get(`${t}:15`) ?? anyOf.get(t);
    }
    if (value !== undefined && value !== data[i]) out.push({ index: i, value });
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Cells for a rectangular stamp of tile numbers; 0 entries are skipped so shapes can be non-rectangular. */
export function stampCells(width: number, height: number, x: number, y: number, rows: readonly (readonly number[])[]): CellChange[] {
  const out: CellChange[] = [];
  rows.forEach((row, dy) =>
    row.forEach((value, dx) => {
      const cx = x + dx, cy = y + dy;
      if (value && cx >= 0 && cy >= 0 && cx < width && cy < height) out.push({ index: cy * width + cx, value });
    }),
  );
  return out;
}
