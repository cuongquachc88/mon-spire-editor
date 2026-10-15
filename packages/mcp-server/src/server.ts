import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PNG } from "pngjs";
import { z } from "zod";
import {
  History,
  MapSchema,
  exportTiled,
  buildSpritePrompt,
  slugify,
  SpriteSpecSchema,
  type SpriteRequest,
  exportAtlas,
  planAutotile,
  stampCells,
  applyDrawOps,
  createImage,
  imageToRows,
  type Animation,
  type DrawOp,
  type PixelImage,
  SetTilesCommand,
  sliceGrid,
  type FileSystemAdapter,
  type MapData,
  type ProjectStore,
  type SpriteSheet,
  type Tileset,
} from "@mse/core";
import { renderMapPng } from "./render";
import { validateAssets, validateMap } from "./validate";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });

export function createServer(store: ProjectStore, fs: FileSystemAdapter) {
  const server = new McpServer({ name: "mon-spire-editor", version: "0.0.1" });

  const cellIndex = (map: MapData, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
      throw new Error(`(${x},${y}) is outside the ${map.width}x${map.height} map`);
    }
    return y * map.width + x;
  };

  const loadTilesets = async (map: MapData) => {
    const out = new Map<string, Tileset>();
    for (const l of map.layers) {
      if (l.kind === "tile" && !out.has(l.tilesetId)) {
        try {
          out.set(l.tilesetId, await store.loadTileset(l.tilesetId));
        } catch {
          /* reported by validate */
        }
      }
    }
    return out;
  };

  // Wraps a handler so thrown errors (bad ids, out-of-range cells, schema failures) reach the model as tool errors.
  const safe =
    <A>(fn: (args: A) => Promise<ReturnType<typeof text>>) =>
    async (args: A) => {
      try {
        return await fn(args);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    };

  server.registerTool(
    "project_info",
    { description: "Summarize the open project: name, tile size, and the ids of all sheets, animations, tilesets and maps." },
    safe(async () => text(await store.loadProject())),
  );

  server.registerTool(
    "map_create",
    {
      description: "Create an empty map with one tile layer named 'ground'. Fails if the id already exists.",
      inputSchema: {
        id: z.string().regex(/^[a-z0-9_-]+$/i),
        name: z.string(),
        width: z.number().int().min(1).max(512),
        height: z.number().int().min(1).max(512),
        tilesetId: z.string().describe("Tileset used by the initial layer"),
        tileSize: z.number().int().positive().optional().describe("Defaults to the project tile size"),
      },
    },
    safe(async ({ id, name, width, height, tilesetId, tileSize }) => {
      const project = await store.loadProject();
      if (project.maps.includes(id)) throw new Error(`Map "${id}" already exists`);
      const map = MapSchema.parse({
        id,
        name,
        width,
        height,
        tileSize: tileSize ?? project.tileSize,
        layers: [{ id: "ground", name: "Ground", kind: "tile", tilesetId, data: new Array(width * height).fill(0) }],
      });
      await store.saveMap(map);
      return text(`Created map "${id}" (${width}x${height}).`);
    }),
  );

  server.registerTool(
    "map_get",
    {
      description:
        "Read a map. Tile layers are returned as an array of rows (strings of space-separated tile ids) so the grid is easy to read. Pass layerId to limit output.",
      inputSchema: { id: z.string(), layerId: z.string().optional() },
    },
    safe(async ({ id, layerId }) => {
      const map = await store.loadMap(id);
      const layers = map.layers
        .filter((l) => !layerId || l.id === layerId)
        .map((l) => {
          if (l.kind === "object") return l;
          const rows: string[] = [];
          for (let y = 0; y < map.height; y++) rows.push(l.data.slice(y * map.width, (y + 1) * map.width).join(" "));
          const { data: _data, ...rest } = l;
          return { ...rest, rows };
        });
      if (layerId && layers.length === 0) throw new Error(`No layer "${layerId}" in map "${id}"`);
      return text({ id: map.id, name: map.name, width: map.width, height: map.height, tileSize: map.tileSize, layers });
    }),
  );

  server.registerTool(
    "map_set_tiles",
    {
      description: "Set individual cells on a tile or collision layer in one batch (one undo step). Value 0 clears a cell.",
      inputSchema: {
        mapId: z.string(),
        layerId: z.string(),
        cells: z.array(z.object({ x: z.number().int(), y: z.number().int(), value: z.number().int().min(0) })).min(1).max(5000),
      },
    },
    safe(async ({ mapId, layerId, cells }) => {
      const map = await store.loadMap(mapId);
      const cmd = new SetTilesCommand(layerId, cells.map((c) => ({ index: cellIndex(map, c.x, c.y), value: c.value })));
      new History(map).execute(cmd);
      await store.saveMap(map);
      return text(`Set ${cells.length} cell(s) on "${layerId}".`);
    }),
  );

  server.registerTool(
    "map_fill",
    {
      description: "Fill a rectangle (inclusive x,y, size w,h) on a tile or collision layer with one value. Use value 0 to erase.",
      inputSchema: {
        mapId: z.string(),
        layerId: z.string(),
        x: z.number().int(),
        y: z.number().int(),
        w: z.number().int().min(1),
        h: z.number().int().min(1),
        value: z.number().int().min(0),
      },
    },
    safe(async ({ mapId, layerId, x, y, w, h, value }) => {
      const map = await store.loadMap(mapId);
      const cells: { index: number; value: number }[] = [];
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) cells.push({ index: cellIndex(map, xx, yy), value });
      new History(map).execute(new SetTilesCommand(layerId, cells));
      await store.saveMap(map);
      return text(`Filled ${w}x${h} at (${x},${y}) on "${layerId}" with ${value}.`);
    }),
  );

  server.registerTool(
    "layer_add",
    {
      description: "Add a layer to a map. kind 'tile' needs tilesetId. New layers are appended on top.",
      inputSchema: {
        mapId: z.string(),
        layerId: z.string(),
        name: z.string(),
        kind: z.enum(["tile", "object", "collision"]),
        tilesetId: z.string().optional(),
      },
    },
    safe(async ({ mapId, layerId, name, kind, tilesetId }) => {
      const map = await store.loadMap(mapId);
      if (map.layers.some((l) => l.id === layerId)) throw new Error(`Layer "${layerId}" already exists`);
      const n = map.width * map.height;
      if (kind === "tile") {
        if (!tilesetId) throw new Error("tilesetId is required for tile layers");
        map.layers.push({ id: layerId, name, kind, tilesetId, visible: true, locked: false, data: new Array(n).fill(0) });
      } else if (kind === "collision") {
        map.layers.push({ id: layerId, name, kind, visible: true, locked: false, data: new Array(n).fill(0) });
      } else {
        map.layers.push({ id: layerId, name, kind, visible: true, locked: false, entities: [] });
      }
      await store.saveMap(map);
      return text(`Added ${kind} layer "${layerId}".`);
    }),
  );

  server.registerTool(
    "entity_place",
    {
      description: "Place an entity on an object layer at pixel coordinates. Replaces an entity with the same id.",
      inputSchema: {
        mapId: z.string(),
        layerId: z.string(),
        entityId: z.string(),
        type: z.string(),
        x: z.number(),
        y: z.number(),
        props: z.record(z.unknown()).optional(),
      },
    },
    safe(async ({ mapId, layerId, entityId, type, x, y, props }) => {
      const map = await store.loadMap(mapId);
      const layer = map.layers.find((l) => l.id === layerId);
      if (!layer || layer.kind !== "object") throw new Error(`No object layer "${layerId}"`);
      layer.entities = layer.entities.filter((e) => e.id !== entityId);
      layer.entities.push({ id: entityId, type, x, y, props: props ?? {} });
      await store.saveMap(map);
      return text(`Placed "${entityId}" (${type}) at (${x},${y}).`);
    }),
  );

  server.registerTool(
    "map_validate",
    {
      description: "Check a map for broken tileset references, tile ids beyond the tileset, duplicate ids and out-of-bounds entities.",
      inputSchema: { id: z.string() },
    },
    safe(async ({ id }) => {
      const map = await store.loadMap(id);
      const problems = validateMap(map, await loadTilesets(map));
      return text(problems.length ? { ok: false, problems } : { ok: true, problems: [] });
    }),
  );

  server.registerTool(
    "map_render_preview",
    {
      description:
        "Render the map to a PNG so you can look at the result. Uses real tile art when the tileset's sheet image exists, otherwise flat colors per tile id. Red X = collision, yellow cross = entity.",
      inputSchema: { id: z.string(), scale: z.number().int().min(1).max(8).optional() },
    },
    async ({ id, scale }) => {
      try {
        const map = await store.loadMap(id);
        const tilesets = await loadTilesets(map);
        const sheets = new Map<string, { sheet: SpriteSheet; png: PNG }>();
        for (const ts of tilesets.values()) {
          if (sheets.has(ts.sheetId)) continue;
          try {
            const sheet = await store.loadSheet(ts.sheetId);
            const bytes = await fs.readBinary(`${store.root}/${sheet.image}`);
            sheets.set(ts.sheetId, { sheet, png: PNG.sync.read(Buffer.from(bytes)) });
          } catch {
            /* fall back to flat colors for this sheet */
          }
        }
        // entities that point at an animation: load that animation's sheet too
        const animations = new Map<string, Animation>();
        for (const l of map.layers) {
          if (l.kind !== "object") continue;
          for (const e of l.entities) {
            const id = e.props.animation;
            if (typeof id !== "string" || animations.has(id)) continue;
            try {
              const a = await store.loadAnimation(id);
              animations.set(id, a);
              if (!sheets.has(a.sheetId)) {
                const sh = await store.loadSheet(a.sheetId);
                sheets.set(sh.id, { sheet: sh, png: PNG.sync.read(Buffer.from(await fs.readBinary(`${store.root}/${sh.image}`))) });
              }
            } catch {
              /* a dangling animation id is reported by project_validate; the preview just skips the sprite */
            }
          }
        }
        const png = renderMapPng({ map, tilesets, sheets, animations, scale: scale ?? 2 });
        return { content: [{ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" }] };
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "sprite_import",
    {
      description:
        "Import a PNG from an absolute path on disk into the project (copied to assets/<id>.png) and register it as a sprite sheet with no frames. Follow with sprite_slice.",
      inputSchema: { id: z.string().regex(/^[a-z0-9_-]+$/i), sourcePath: z.string().describe("Absolute path to a PNG file") },
    },
    safe(async ({ id, sourcePath }) => {
      if ((await store.loadProject()).sheets.includes(id)) throw new Error(`Sheet "${id}" already exists`);
      const bytes = await fs.readBinary(sourcePath);
      const png = PNG.sync.read(Buffer.from(bytes)); // throws on non-PNG
      await fs.writeBinary(`${store.root}/assets/${id}.png`, bytes);
      await store.saveSheet({ id, image: `assets/${id}.png`, margin: 0, spacing: 0, frames: [] });
      return text(`Imported "${id}" (${png.width}x${png.height}).`);
    }),
  );

  server.registerTool(
    "sprite_slice",
    {
      description:
        "Cut a sheet into a regular grid of frames (ids '<sheetId>_<n>', row-major from 0). Replaces existing frames, so tilesets/animations that reference old frame ids must be re-checked with map_validate.",
      inputSchema: {
        sheetId: z.string(),
        frameWidth: z.number().int().min(1),
        frameHeight: z.number().int().min(1),
        margin: z.number().int().min(0).optional(),
        spacing: z.number().int().min(0).optional(),
      },
    },
    safe(async ({ sheetId, frameWidth, frameHeight, margin, spacing }) => {
      const sheet = await store.loadSheet(sheetId);
      const png = PNG.sync.read(Buffer.from(await fs.readBinary(`${store.root}/${sheet.image}`)));
      const frames = sliceGrid({
        imageWidth: png.width,
        imageHeight: png.height,
        frameWidth,
        frameHeight,
        margin,
        spacing,
        idPrefix: sheetId,
      });
      if (frames.length === 0) throw new Error(`${frameWidth}x${frameHeight} frames do not fit in ${png.width}x${png.height}`);
      await store.saveSheet({ ...sheet, frameWidth, frameHeight, margin: margin ?? 0, spacing: spacing ?? 0, frames });
      return text(`Sliced "${sheetId}" into ${frames.length} frames (${frames[0]!.id} .. ${frames[frames.length - 1]!.id}).`);
    }),
  );

  server.registerTool(
    "sheet_get",
    {
      description: "Read a sprite sheet: image path, grid settings and its frames (id, rect).",
      inputSchema: { id: z.string() },
    },
    safe(async ({ id }) => {
      const s = await store.loadSheet(id);
      return text({ ...s, frames: s.frames.map((f) => ({ id: f.id, name: f.name, rect: f.rect })) });
    }),
  );

  server.registerTool(
    "sheet_delete",
    {
      description:
        "Delete a sprite sheet, the animations built from it, and (unless deleteImage is false) its PNG. Refuses while a tileset uses the sheet; delete that first.",
      inputSchema: {
        id: z.string(),
        deleteImage: z.boolean().optional().describe("Also delete assets/<id>.png (default true)"),
      },
    },
    safe(async ({ id, deleteImage }) => {
      const r = await store.removeSheet(id, { deleteImage });
      return text(
        `Deleted sheet "${id}"` +
          (r.animations.length ? ` and animation(s) ${r.animations.join(", ")}` : "") +
          (r.imageDeleted ? " and its PNG." : "."),
      );
    }),
  );

  server.registerTool(
    "tileset_create",
    {
      description:
        "Create a tileset from a sheet. Tile number n in map layers is tiles[n-1]. Defaults to every frame in order; pass frameIds to pick and order them.",
      inputSchema: {
        id: z.string().regex(/^[a-z0-9_-]+$/i),
        name: z.string(),
        sheetId: z.string(),
        frameIds: z.array(z.string()).optional(),
        collisionFrameIds: z.array(z.string()).optional().describe("Frames whose tiles block movement"),
      },
    },
    safe(async ({ id, name, sheetId, frameIds, collisionFrameIds }) => {
      if ((await store.loadProject()).tilesets.includes(id)) throw new Error(`Tileset "${id}" already exists`);
      const sheet = await store.loadSheet(sheetId);
      const known = new Set(sheet.frames.map((f) => f.id));
      const ids = frameIds ?? sheet.frames.map((f) => f.id);
      if (ids.length === 0) throw new Error(`Sheet "${sheetId}" has no frames; run sprite_slice first`);
      const missing = [...ids, ...(collisionFrameIds ?? [])].filter((f) => !known.has(f));
      if (missing.length) throw new Error(`Unknown frame(s) in "${sheetId}": ${[...new Set(missing)].join(", ")}`);
      const solid = new Set(collisionFrameIds);
      await store.saveTileset({
        id,
        name,
        sheetId,
        tiles: ids.map((frameId) => ({ frameId, collision: solid.has(frameId), tags: [] })),
      });
      return text(`Created tileset "${id}" with ${ids.length} tiles (tile numbers 1..${ids.length}).`);
    }),
  );

  server.registerTool(
    "tile_set_properties",
    {
      description: "Set collision and/or tags on one tile of a tileset (tile is the 1-based number used in maps).",
      inputSchema: {
        tilesetId: z.string(),
        tile: z.number().int().min(1),
        collision: z.boolean().optional(),
        tags: z.array(z.string()).optional(),
        terrain: z.string().optional().describe("Autotile group name; empty string clears it"),
        mask: z.number().int().min(0).max(15).optional().describe("N=1,E=2,S=4,W=8: which neighbours are the same terrain"),
      },
    },
    safe(async ({ tilesetId, tile, collision, tags, terrain, mask }) => {
      const ts = await store.loadTileset(tilesetId);
      const t = ts.tiles[tile - 1];
      if (!t) throw new Error(`Tileset "${tilesetId}" has ${ts.tiles.length} tiles; no tile ${tile}`);
      if (collision !== undefined) t.collision = collision;
      if (tags !== undefined) t.tags = tags;
      if (terrain !== undefined) t.terrain = terrain || undefined;
      if (mask !== undefined) t.mask = mask;
      await store.saveTileset(ts);
      return text(`Updated tile ${tile}: ${JSON.stringify(t)}`);
    }),
  );

  server.registerTool(
    "animation_create",
    {
      description:
        "Create an animation from frames of a sheet. Give frameIds plus fps for uniform timing, or frames with per-frame durationMs.",
      inputSchema: {
        id: z.string().regex(/^[a-z0-9_-]+$/i),
        name: z.string(),
        sheetId: z.string(),
        frameIds: z.array(z.string()).min(1).optional(),
        fps: z.number().min(1).max(120).optional(),
        frames: z.array(z.object({ frameId: z.string(), durationMs: z.number().int().min(1) })).min(1).optional(),
        loop: z.boolean().optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    safe(async ({ id, name, sheetId, frameIds, fps, frames, loop, tags }) => {
      if ((await store.loadProject()).animations.includes(id)) throw new Error(`Animation "${id}" already exists`);
      if (!frames && !frameIds) throw new Error("Provide either frames or frameIds");
      const steps = frames ?? frameIds!.map((frameId) => ({ frameId, durationMs: Math.round(1000 / (fps ?? 8)) }));
      const known = new Set((await store.loadSheet(sheetId)).frames.map((f) => f.id));
      const missing = steps.filter((s) => !known.has(s.frameId)).map((s) => s.frameId);
      if (missing.length) throw new Error(`Unknown frame(s) in "${sheetId}": ${[...new Set(missing)].join(", ")}`);
      await store.saveAnimation({ id, name, sheetId, frames: steps, loop: loop ?? true, tags: tags ?? [] });
      return text(`Created animation "${id}" with ${steps.length} frames.`);
    }),
  );

  server.registerTool(
    "export_tiled",
    {
      description:
        "Export a map for the Tiled editor / engines with Tiled loaders: writes export/tiled/<mapId>.tmj plus one .tsj per tileset used. Collision layers become rectangle objects. Fails if a tile uses a missing frame or image.",
      inputSchema: { mapId: z.string() },
    },
    safe(async ({ mapId }) => {
      const map = await store.loadMap(mapId);
      const tilesets = await loadTilesets(map);
      const sheets = new Map<string, SpriteSheet>();
      const sizes = new Map<string, { width: number; height: number }>();
      for (const ts of tilesets.values()) {
        if (sheets.has(ts.sheetId)) continue;
        const sheet = await store.loadSheet(ts.sheetId);
        sheets.set(sheet.id, sheet);
        try {
          const png = PNG.sync.read(Buffer.from(await fs.readBinary(`${store.root}/${sheet.image}`)));
          sizes.set(sheet.id, { width: png.width, height: png.height });
        } catch {
          /* exportTiled reports the missing image by sheet id */
        }
      }
      const out = exportTiled(map, tilesets, sheets, sizes);
      const dir = `${store.root}/export/tiled`;
      const files = [`export/tiled/${map.id}.tmj`];
      await fs.writeText(`${dir}/${map.id}.tmj`, JSON.stringify(out.map, null, 2) + "\n");
      for (const t of out.tilesets) {
        await fs.writeText(`${dir}/${t.file}`, JSON.stringify(t.json, null, 2) + "\n");
        files.push(`export/tiled/${t.file}`);
      }
      return text({ written: files });
    }),
  );

  // ---- pixel drawing -------------------------------------------------------------------------
  const decode = (bytes: Uint8Array): PixelImage => {
    const png = PNG.sync.read(Buffer.from(bytes));
    const img = createImage(png.width, png.height);
    img.data.set(new Uint32Array(png.data.buffer, png.data.byteOffset, png.width * png.height));
    return img;
  };
  const encode = (img: PixelImage) => {
    const png = new PNG({ width: img.width, height: img.height });
    new Uint32Array(png.data.buffer, png.data.byteOffset, img.data.length).set(img.data);
    return PNG.sync.write(png);
  };
  const preview = (img: PixelImage, scale: number) => {
    // Nearest-neighbour upscale on a checkerboard so transparent areas are visible.
    const out = new PNG({ width: img.width * scale, height: img.height * scale });
    for (let y = 0; y < out.height; y++)
      for (let x = 0; x < out.width; x++) {
        const sx = Math.floor(x / scale), sy = Math.floor(y / scale);
        const c = img.data[sy * img.width + sx]!;
        const a = c >>> 24;
        const bg = (sx + sy) % 2 ? 58 : 44;
        const o = (y * out.width + x) * 4;
        const mix = (v: number, base: number) => Math.round((v * a + base * (255 - a)) / 255);
        out.data[o] = mix(c & 255, bg);
        out.data[o + 1] = mix((c >>> 8) & 255, bg);
        out.data[o + 2] = mix((c >>> 16) & 255, bg);
        out.data[o + 3] = 255;
      }
    return { type: "image" as const, data: PNG.sync.write(out).toString("base64"), mimeType: "image/png" };
  };
  const loadSheetImage = async (id: string) => {
    const sheet = await store.loadSheet(id);
    return { sheet, img: decode(await fs.readBinary(`${store.root}/${sheet.image}`)) };
  };

  server.registerTool(
    "sprite_create",
    {
      description:
        "Create a new blank (transparent) pixel image and register it as a sprite sheet with no frames. Then draw with sprite_draw and look with sprite_preview. Slice with sprite_slice when done.",
      inputSchema: {
        id: z.string().regex(/^[a-z0-9_-]+$/i),
        width: z.number().int().min(1).max(512),
        height: z.number().int().min(1).max(512),
      },
    },
    safe(async ({ id, width, height }) => {
      if ((await store.loadProject()).sheets.includes(id)) throw new Error(`Sheet "${id}" already exists`);
      await fs.writeBinary(`${store.root}/assets/${id}.png`, encode(createImage(width, height)));
      await store.saveSheet({ id, image: `assets/${id}.png`, margin: 0, spacing: 0, frames: [] });
      return text(`Created blank ${width}x${height} image "${id}". Coordinates start at (0,0) top-left.`);
    }),
  );

  const colorField = z.string().describe('"#rgb", "#rrggbb", "#rrggbbaa" or "transparent"');
  const pt = z.object({ x: z.number().int(), y: z.number().int() });
  const drawOp = z.discriminatedUnion("op", [
    z.object({ op: z.literal("clear") }),
    z.object({ op: z.literal("pixels"), points: z.array(pt).min(1).max(4096), color: colorField }),
    z.object({ op: z.literal("rect"), x: z.number().int(), y: z.number().int(), w: z.number().int().min(1), h: z.number().int().min(1), color: colorField, filled: z.boolean().optional() }),
    z.object({ op: z.literal("line"), x1: z.number().int(), y1: z.number().int(), x2: z.number().int(), y2: z.number().int(), color: colorField }),
    z.object({ op: z.literal("ellipse"), cx: z.number(), cy: z.number(), rx: z.number().positive(), ry: z.number().positive(), color: colorField, filled: z.boolean().optional() }),
    z.object({ op: z.literal("fill"), x: z.number().int(), y: z.number().int(), color: colorField }),
    z.object({
      op: z.literal("copy"),
      x: z.number().int(), y: z.number().int(), w: z.number().int().min(1), h: z.number().int().min(1),
      dx: z.number().int(), dy: z.number().int(),
      rowShift: z.array(z.number()).optional().describe("Per source row, shift sideways by N pixels (shear). Length h. Positive = right."),
      flipX: z.boolean().optional(), flipY: z.boolean().optional(),
      keepDest: z.boolean().optional().describe("Do not clear the destination first (default clears it)"),
    }),
    z.object({
      op: z.literal("rows"),
      x: z.number().int(),
      y: z.number().int(),
      rows: z.array(z.string()).min(1).max(512),
      legend: z.record(colorField).describe("One-character keys. Characters not in the legend are left untouched, so '.' can mean 'skip'."),
    }),
  ]);

  server.registerTool(
    "sprite_draw",
    {
      description:
        "Draw on a sprite sheet's image with a batch of ops applied in order: clear, pixels, rect, line, ellipse (cx,cy is the centre in pixel units; add 0.5 to centre on a pixel), fill (flood), and rows (ASCII art + legend - the best way to place detailed pixels). Later ops paint over earlier ones, so draw big shapes first and details last. To make animation frames, lay frames side by side in one sheet and use copy with rowShift to derive each frame from frame 0 (e.g. a sine of the row height for a sway). Saves the PNG and returns how many pixels changed; use sprite_preview to look at the result.",
      inputSchema: { sheetId: z.string(), ops: z.array(drawOp).min(1).max(500) },
    },
    safe(async ({ sheetId, ops }) => {
      const { sheet, img } = await loadSheetImage(sheetId);
      const changed = applyDrawOps(img, ops as DrawOp[]); // throws on a bad color before anything is saved
      await fs.writeBinary(`${store.root}/${sheet.image}`, encode(img));
      return text(`Applied ${ops.length} op(s); ${changed} pixel(s) changed on "${sheetId}" (${img.width}x${img.height}).`);
    }),
  );

  server.registerTool(
    "sprite_get",
    {
      description:
        "Read pixels as text: ASCII rows plus a legend (symbol -> color, '.' = transparent). Use it to inspect or to copy a region. Optionally limit to a region.",
      inputSchema: {
        sheetId: z.string(),
        region: z.object({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().min(1), h: z.number().int().min(1) }).optional(),
      },
    },
    safe(async ({ sheetId, region }) => {
      const { img } = await loadSheetImage(sheetId);
      return text({ width: img.width, height: img.height, ...imageToRows(img, region) });
    }),
  );

  server.registerTool(
    "sprite_preview",
    {
      description: "Render a sprite sheet image enlarged (nearest-neighbour) on a checkerboard so you can look at your drawing. Call it after drawing to judge and refine.",
      inputSchema: { sheetId: z.string(), scale: z.number().int().min(1).max(32).optional() },
    },
    async ({ sheetId, scale }) => {
      try {
        const { img } = await loadSheetImage(sheetId);
        const s = scale ?? Math.max(1, Math.min(16, Math.floor(512 / Math.max(img.width, img.height))));
        return { content: [preview(img, s)] };
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "tileset_define_terrain",
    {
      description:
        "Mark tiles of a tileset as one autotile terrain in a single call. Each entry gives the 1-based tile number and its mask (N=1, E=2, S=4, W=8 = neighbours of the same terrain; 15 = fully surrounded, 0 = isolated). Then use map_autotile to paint with it. A full set has 16 tiles (one per mask); missing masks fall back to mask 15.",
      inputSchema: {
        tilesetId: z.string(),
        terrain: z.string().min(1),
        tiles: z.array(z.object({ tile: z.number().int().min(1), mask: z.number().int().min(0).max(15) })).min(1),
      },
    },
    safe(async ({ tilesetId, terrain, tiles }) => {
      const ts = await store.loadTileset(tilesetId);
      for (const { tile, mask } of tiles) {
        const t = ts.tiles[tile - 1];
        if (!t) throw new Error(`Tileset "${tilesetId}" has ${ts.tiles.length} tiles; no tile ${tile}`);
        t.terrain = terrain;
        t.mask = mask;
      }
      await store.saveTileset(ts);
      const have = new Set(ts.tiles.filter((t) => t.terrain === terrain).map((t) => t.mask));
      const missing = Array.from({ length: 16 }, (_, m) => m).filter((m) => !have.has(m));
      return text(`Terrain "${terrain}": ${tiles.length} tile(s) set.` + (missing.length ? ` Masks without a tile (will fall back): ${missing.join(", ")}.` : " All 16 masks covered."));
    }),
  );

  server.registerTool(
    "map_autotile",
    {
      description:
        "Paint (or erase) an autotile terrain on a tile layer. You give the cells; edges, corners and neighbours are re-fitted automatically using the tileset's terrain masks (see tileset_define_terrain). Set erase=true to remove the terrain from those cells.",
      inputSchema: {
        mapId: z.string(),
        layerId: z.string(),
        terrain: z.string().describe("Terrain name defined in the layer's tileset"),
        cells: z.array(z.object({ x: z.number().int(), y: z.number().int() })).min(1).max(5000),
        erase: z.boolean().optional(),
      },
    },
    safe(async ({ mapId, layerId, terrain, cells, erase }) => {
      const map = await store.loadMap(mapId);
      const layer = map.layers.find((l) => l.id === layerId);
      if (!layer || layer.kind !== "tile") throw new Error(`No tile layer "${layerId}"`);
      const ts = await store.loadTileset(layer.tilesetId);
      const changes = planAutotile(layer.data, map.width, map.height, ts, erase ? null : terrain, cells.map((c) => cellIndex(map, c.x, c.y)));
      if (erase && !ts.tiles.some((t) => t.terrain === terrain)) throw new Error(`Tileset "${ts.id}" has no tiles with terrain "${terrain}"`);
      new History(map).execute(new SetTilesCommand(layerId, changes));
      await store.saveMap(map);
      return text(`${erase ? "Erased" : "Painted"} ${cells.length} cell(s) of "${terrain}"; ${changes.length} tile(s) changed including neighbours.`);
    }),
  );

  server.registerTool(
    "map_stamp",
    {
      description:
        "Place a block of tile numbers with its top-left at (x,y). rows is a 2D array of tile numbers; 0 leaves that cell untouched, so shapes need not be rectangles. Ideal for multi-tile objects like the 3x4 tiles of a tree sliced from one sprite (row-major tile numbers). Cells outside the map are clipped.",
      inputSchema: {
        mapId: z.string(),
        layerId: z.string(),
        x: z.number().int(),
        y: z.number().int(),
        rows: z.array(z.array(z.number().int().min(0))).min(1).max(256),
      },
    },
    safe(async ({ mapId, layerId, x, y, rows }) => {
      const map = await store.loadMap(mapId);
      const cells = stampCells(map.width, map.height, x, y, rows);
      if (!cells.length) throw new Error("Nothing to place: the stamp is empty or entirely outside the map");
      new History(map).execute(new SetTilesCommand(layerId, cells));
      await store.saveMap(map);
      return text(`Stamped ${cells.length} cell(s) at (${x},${y}) on "${layerId}".`);
    }),
  );

  server.registerTool(
    "export_atlas",
    {
      description:
        "Export a sprite sheet as an engine-ready atlas: export/atlas/<sheetId>.json (JSON-hash frames + meta, plus an `animations` block for this sheet's animations) and a copy of the PNG. Works with Phaser, PixiJS and similar loaders.",
      inputSchema: { sheetId: z.string() },
    },
    safe(async ({ sheetId }) => {
      const { sheet, img } = await loadSheetImage(sheetId);
      const project = await store.loadProject();
      const anims = (await Promise.all(project.animations.map((id) => store.loadAnimation(id).catch(() => undefined)))).filter((a): a is NonNullable<typeof a> => !!a);
      const png = `${sheetId}.png`;
      const atlas = exportAtlas(sheet, { width: img.width, height: img.height }, anims, png);
      await fs.writeText(`${store.root}/export/atlas/${sheetId}.json`, JSON.stringify(atlas, null, 2) + "\n");
      await fs.writeBinary(`${store.root}/export/atlas/${png}`, await fs.readBinary(`${store.root}/${sheet.image}`));
      return text({ written: [`export/atlas/${sheetId}.json`, `export/atlas/${png}`], frames: sheet.frames.length, animations: Object.keys(atlas.animations) });
    }),
  );

  // ---- sprite requests: the in-app prompt builder queues work, Claude picks it up here ----------
  const nowIso = () => new Date().toISOString();
  const listRequests = async () => {
    const project = await store.loadProject();
    const out: SpriteRequest[] = [];
    for (const id of project.requests) {
      try {
        out.push(await store.loadRequest(id));
      } catch {
        /* an unreadable request file is skipped here; project_validate-style tools report broken files */
      }
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  };
  const summary = (r: SpriteRequest) => ({
    id: r.id,
    status: r.status,
    subject: r.spec.subject,
    sheetId: r.spec.sheetId,
    size: `${r.spec.width}x${r.spec.height}`,
    frames: r.spec.frames,
    createdAt: r.createdAt,
    ...(r.resultSheetId ? { resultSheetId: r.resultSheetId } : {}),
    ...(r.note ? { note: r.note } : {}),
  });

  server.registerTool(
    "request_list",
    {
      description:
        "List sprite requests the user queued from the editor's prompt builder (oldest first). Check this when asked to 'do the pending requests'.",
      inputSchema: { status: z.enum(["pending", "in_progress", "done", "failed"]).optional() },
    },
    safe(async ({ status }) => text((await listRequests()).filter((r) => !status || r.status === status).map(summary))),
  );

  server.registerTool(
    "request_claim",
    {
      description:
        "Take the oldest pending sprite request (or a specific id) and mark it in progress. Returns the full prompt and spec: follow that prompt, then call request_complete. Says so if nothing is pending.",
      inputSchema: { id: z.string().optional() },
    },
    safe(async ({ id }) => {
      const all = await listRequests();
      const r = id ? all.find((x) => x.id === id) : all.find((x) => x.status === "pending");
      if (id && !r) throw new Error(`No request "${id}"`);
      if (!r) return text("No pending requests.");
      if (r.status === "done") throw new Error(`Request "${r.id}" is already done (sheet "${r.resultSheetId}")`);
      await store.saveRequest({ ...r, status: "in_progress", updatedAt: nowIso() });
      return text({ id: r.id, sheetId: r.spec.sheetId, spec: r.spec, prompt: r.prompt });
    }),
  );

  server.registerTool(
    "request_complete",
    {
      description: "Mark a sprite request done once its sheet exists. The editor shows it as finished and links to the result.",
      inputSchema: { id: z.string(), sheetId: z.string().optional().describe("Defaults to the sheet id in the request"), note: z.string().optional() },
    },
    safe(async ({ id, sheetId, note }) => {
      const r = (await listRequests()).find((x) => x.id === id);
      if (!r) throw new Error(`No request "${id}"`);
      const sheet = sheetId ?? r.spec.sheetId;
      if (!(await store.loadProject()).sheets.includes(sheet)) throw new Error(`Sheet "${sheet}" does not exist yet; create and draw it first`);
      await store.saveRequest({ ...r, status: "done", resultSheetId: sheet, note, updatedAt: nowIso() });
      return text(`Request "${id}" done: sheet "${sheet}".`);
    }),
  );

  server.registerTool(
    "request_fail",
    {
      description: "Mark a sprite request as failed with a reason the user can read (for example: the subject is unclear).",
      inputSchema: { id: z.string(), reason: z.string().min(1) },
    },
    safe(async ({ id, reason }) => {
      const r = (await listRequests()).find((x) => x.id === id);
      if (!r) throw new Error(`No request "${id}"`);
      await store.saveRequest({ ...r, status: "failed", note: reason, updatedAt: nowIso() });
      return text(`Request "${id}" marked failed.`);
    }),
  );

  server.registerPrompt(
    "draw_sprite",
    {
      title: "Draw a sprite",
      description: "A complete brief for drawing one sprite (or a short animation) with this editor's tools.",
      argsSchema: {
        subject: z.string().describe("What to draw, e.g. 'a red slime with a tiny crown'"),
        size: z.string().optional().describe("Pixels per frame, '32' or '32x24' (default 32)"),
        frames: z.string().optional().describe("Number of animation frames, 1-16 (default 1)"),
        style: z.string().optional().describe("nes, gameboy, snes or modern (default snes)"),
        sheet_id: z.string().optional().describe("Id for the new sheet (default made from the subject)"),
      },
    },
    ({ subject, size, frames, style, sheet_id }) => {
      const [w, h] = (size ?? "32").toLowerCase().split("x").map((n) => parseInt(n, 10));
      const parsed = SpriteSpecSchema.safeParse({
        subject,
        width: w || 32,
        height: h || w || 32,
        frames: frames ? parseInt(frames, 10) : 1,
        style: style ?? "snes",
        sheetId: sheet_id ?? slugify(subject),
      });
      const text = parsed.success ? buildSpritePrompt(parsed.data) : `Could not build the brief: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
    },
  );

  server.registerPrompt(
    "do_pending_requests",
    { title: "Do the queued sprite requests", description: "Work through every sprite request queued in the editor's prompt builder." },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "Call request_list with status pending. For each one: call request_claim, follow the returned prompt exactly (draw, preview, refine), then call request_complete. If a request cannot be done, call request_fail with a reason. Tell me what you made when you are finished.",
          },
        },
      ],
    }),
  );

  server.registerTool(
    "project_validate",
    {
      description:
        "Check the whole project: every tileset and animation must reference an existing sheet and frame, and every map must pass map_validate. Run after sprite_slice, which replaces frame ids.",
    },
    safe(async () => {
      const project = await store.loadProject();
      const load = async <T,>(ids: string[], fn: (id: string) => Promise<T>, kind: string, problems: string[]) => {
        const out: T[] = [];
        for (const id of ids) {
          try {
            out.push(await fn(id));
          } catch (e) {
            problems.push(`${kind} "${id}": ${e instanceof Error ? e.message : e}`);
          }
        }
        return out;
      };
      const problems: string[] = [];
      const sheets = await load(project.sheets, (id) => store.loadSheet(id), "sheet", problems);
      const tilesets = await load(project.tilesets, (id) => store.loadTileset(id), "tileset", problems);
      const animations = await load(project.animations, (id) => store.loadAnimation(id), "animation", problems);
      const maps = await load(project.maps, (id) => store.loadMap(id), "map", problems);
      problems.push(...validateAssets(new Map(sheets.map((s) => [s.id, s])), tilesets, animations));
      const tsMap = new Map(tilesets.map((t) => [t.id, t]));
      for (const m of maps) problems.push(...validateMap(m, tsMap).map((p) => `map "${m.id}": ${p}`));
      return text(problems.length ? { ok: false, problems } : { ok: true, problems: [] });
    }),
  );

  return server;
}
