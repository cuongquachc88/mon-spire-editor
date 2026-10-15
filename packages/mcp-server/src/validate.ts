import type { Animation, MapData, SpriteSheet, Tileset } from "@mse/core";

/** Returns human-readable problems; empty array means the map is consistent. */
export function validateMap(map: MapData, tilesets: Map<string, Tileset>): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const layer of map.layers) {
    if (ids.has(layer.id)) problems.push(`duplicate layer id "${layer.id}"`);
    ids.add(layer.id);

    if (layer.kind === "tile") {
      const ts = tilesets.get(layer.tilesetId);
      if (!ts) {
        problems.push(`layer "${layer.id}": tileset "${layer.tilesetId}" not found`);
        continue;
      }
      const bad = layer.data.findIndex((v) => v > ts.tiles.length);
      if (bad >= 0) {
        problems.push(
          `layer "${layer.id}": cell (${bad % map.width},${Math.floor(bad / map.width)}) uses tile ${layer.data[bad]} but tileset has ${ts.tiles.length}`,
        );
      }
    } else if (layer.kind === "object") {
      const seen = new Set<string>();
      for (const e of layer.entities) {
        if (seen.has(e.id)) problems.push(`layer "${layer.id}": duplicate entity id "${e.id}"`);
        seen.add(e.id);
        if (e.x < 0 || e.y < 0 || e.x >= map.width * map.tileSize || e.y >= map.height * map.tileSize) {
          problems.push(`layer "${layer.id}": entity "${e.id}" at (${e.x},${e.y}) is outside the map`);
        }
      }
    }
  }
  return problems;
}

/** Checks that tilesets and animations only reference sheets/frames that exist (e.g. after re-slicing a sheet). */
export function validateAssets(sheets: Map<string, SpriteSheet>, tilesets: Iterable<Tileset>, animations: Iterable<Animation>): string[] {
  const problems: string[] = [];
  const frames = (sheetId: string) => new Set(sheets.get(sheetId)?.frames.map((f) => f.id));
  for (const t of tilesets) {
    if (!sheets.has(t.sheetId)) {
      problems.push(`tileset "${t.id}": sheet "${t.sheetId}" not found`);
      continue;
    }
    const known = frames(t.sheetId);
    t.tiles.forEach((tile, i) => known.has(tile.frameId) || problems.push(`tileset "${t.id}": tile ${i + 1} uses missing frame "${tile.frameId}"`));
  }
  for (const a of animations) {
    if (!sheets.has(a.sheetId)) {
      problems.push(`animation "${a.id}": sheet "${a.sheetId}" not found`);
      continue;
    }
    const known = frames(a.sheetId);
    a.frames.forEach((f, i) => known.has(f.frameId) || problems.push(`animation "${a.id}": step ${i + 1} uses missing frame "${f.frameId}"`));
  }
  return problems;
}
