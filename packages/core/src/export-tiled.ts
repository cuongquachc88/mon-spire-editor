import type { MapData, SpriteSheet, Tileset } from "./schema";

type TiledProp = { name: string; type: "string" | "int" | "float" | "bool"; value: string | number | boolean };

const prop = (name: string, v: unknown): TiledProp => {
  if (typeof v === "boolean") return { name, type: "bool", value: v };
  if (typeof v === "number") return { name, type: Number.isInteger(v) ? "int" : "float", value: v };
  return { name, type: "string", value: typeof v === "string" ? v : JSON.stringify(v) };
};

export interface TiledExport {
  /** Contents of <map.id>.tmj */
  map: Record<string, unknown>;
  /** One .tsj per tileset used by the map, file name `<tileset.id>.tsj`. */
  tilesets: { file: string; json: Record<string, unknown> }[];
}

/**
 * Convert a map to Tiled's JSON format (TMJ/TSJ, Tiled 1.9+).
 * Tilesets become "collection of images" tilesets whose tiles are sub-rectangles of the sheet PNG, so
 * tilesets whose tiles are not a regular grid still export. Collision layers become rectangle objects.
 * `imageSizes` gives each sheet image's pixel size (Tiled needs it for sub-rectangle tiles).
 * `imageBase` is prefixed to each sheet's project-relative image path (default: files are written two
 * folders below the project root, e.g. export/tiled/).
 */
export function exportTiled(
  map: MapData,
  tilesets: Map<string, Tileset>,
  sheets: Map<string, SpriteSheet>,
  imageSizes: Map<string, { width: number; height: number }>,
  imageBase = "../../",
): TiledExport {
  const firstGid = new Map<string, number>();
  const tsjs: TiledExport["tilesets"] = [];
  let nextGid = 1;

  const use = (id: string) => {
    if (firstGid.has(id)) return firstGid.get(id)!;
    const ts = tilesets.get(id);
    if (!ts) throw new Error(`Tileset "${id}" not found`);
    const sheet = sheets.get(ts.sheetId);
    if (!sheet) throw new Error(`Sheet "${ts.sheetId}" (tileset "${id}") not found`);
    const size = imageSizes.get(sheet.id);
    if (!size) throw new Error(`Image for sheet "${sheet.id}" is missing or unreadable`);
    const frames = new Map(sheet.frames.map((f) => [f.id, f]));
    const tiles = ts.tiles.map((t, i) => {
      const f = frames.get(t.frameId);
      if (!f) throw new Error(`Tileset "${id}" tile ${i + 1} uses missing frame "${t.frameId}"`);
      const properties: TiledProp[] = [];
      if (t.collision) properties.push(prop("collision", true));
      if (t.tags.length) properties.push(prop("tags", t.tags.join(",")));
      if (t.terrain) properties.push(prop("terrain", t.terrain));
      return {
        id: i,
        image: imageBase + sheet.image,
        x: f.rect.x,
        y: f.rect.y,
        width: f.rect.w,
        height: f.rect.h,
        imagewidth: size.width,
        imageheight: size.height,
        ...(properties.length ? { properties } : {}),
      };
    });
    firstGid.set(id, nextGid);
    nextGid += ts.tiles.length;
    tsjs.push({
      file: `${id}.tsj`,
      json: {
        type: "tileset",
        version: "1.10",
        tiledversion: "1.10.2",
        name: ts.name,
        tilewidth: map.tileSize,
        tileheight: map.tileSize,
        tilecount: tiles.length,
        columns: 0,
        grid: { orientation: "orthogonal", width: 1, height: 1 },
        tiles,
      },
    });
    return firstGid.get(id)!;
  };

  let nextObjectId = 1;
  const layers = map.layers.map((l, i) => {
    const base = { id: i + 1, name: l.name, visible: l.visible, opacity: 1, x: 0, y: 0 };
    if (l.kind === "tile") {
      const gid0 = use(l.tilesetId);
      return {
        ...base,
        type: "tilelayer",
        width: map.width,
        height: map.height,
        data: l.data.map((v) => (v === 0 ? 0 : gid0 + v - 1)),
      };
    }
    if (l.kind === "collision") {
      // Merge horizontal runs so a wall is one rectangle, not one per cell.
      const objects: Record<string, unknown>[] = [];
      for (let y = 0; y < map.height; y++) {
        let x = 0;
        while (x < map.width) {
          if (!l.data[y * map.width + x]) {
            x++;
            continue;
          }
          const start = x;
          while (x < map.width && l.data[y * map.width + x]) x++;
          objects.push({
            id: nextObjectId++,
            name: "",
            type: "collision",
            x: start * map.tileSize,
            y: y * map.tileSize,
            width: (x - start) * map.tileSize,
            height: map.tileSize,
            rotation: 0,
            visible: true,
          });
        }
      }
      return { ...base, type: "objectgroup", draworder: "topdown", objects };
    }
    return {
      ...base,
      type: "objectgroup",
      draworder: "topdown",
      objects: l.entities.map((e) => ({
        id: nextObjectId++,
        name: e.id,
        type: e.type,
        x: e.x,
        y: e.y,
        width: 0,
        height: 0,
        point: true,
        rotation: 0,
        visible: true,
        properties: Object.entries(e.props).map(([k, v]) => prop(k, v)),
      })),
    };
  });

  return {
    map: {
      type: "map",
      version: "1.10",
      tiledversion: "1.10.2",
      orientation: "orthogonal",
      renderorder: "right-down",
      infinite: false,
      width: map.width,
      height: map.height,
      tilewidth: map.tileSize,
      tileheight: map.tileSize,
      nextlayerid: layers.length + 1,
      nextobjectid: nextObjectId,
      layers,
      tilesets: [...firstGid].map(([id, gid]) => ({ firstgid: gid, source: `${id}.tsj` })),
    },
    tilesets: tsjs,
  };
}
