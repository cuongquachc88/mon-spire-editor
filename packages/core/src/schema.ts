import { z } from "zod";

export const SCHEMA_VERSION = 1;

export const RectSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

export const FrameSchema = z.object({
  id: z.string(),
  name: z.string(),
  rect: RectSchema,
  pivot: z.object({ x: z.number(), y: z.number() }).default({ x: 0.5, y: 0.5 }),
});

export const SpriteSheetSchema = z.object({
  id: z.string(),
  image: z.string(), // relative path to PNG
  frameWidth: z.number().int().positive().optional(),
  frameHeight: z.number().int().positive().optional(),
  margin: z.number().int().nonnegative().default(0),
  spacing: z.number().int().nonnegative().default(0),
  frames: z.array(FrameSchema).default([]),
});

export const AnimationSchema = z.object({
  id: z.string(),
  name: z.string(),
  sheetId: z.string(),
  frames: z.array(z.object({ frameId: z.string(), durationMs: z.number().int().positive() })),
  loop: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
});

export const TileDefSchema = z.object({
  frameId: z.string(),
  collision: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  /** Autotile group, e.g. "grass". Tiles that share a terrain are chosen between by `mask`. */
  terrain: z.string().optional(),
  /** Which neighbours are the same terrain, as bits: N=1, E=2, S=4, W=8 (so 15 = surrounded, 0 = alone). */
  mask: z.number().int().min(0).max(15).optional(),
});

export const TilesetSchema = z.object({
  id: z.string(),
  name: z.string(),
  sheetId: z.string(),
  tiles: z.array(TileDefSchema).default([]),
});

export const EntitySchema = z.object({
  id: z.string(),
  type: z.string(),
  x: z.number(),
  y: z.number(),
  props: z.record(z.unknown()).default({}),
});

const LayerBase = { id: z.string(), name: z.string(), visible: z.boolean().default(true), locked: z.boolean().default(false) };

export const TileLayerSchema = z.object({
  ...LayerBase,
  kind: z.literal("tile"),
  tilesetId: z.string(),
  // Row-major, length = width*height. 0 = empty, n = tiles[n-1].
  data: z.array(z.number().int().nonnegative()),
});

export const ObjectLayerSchema = z.object({
  ...LayerBase,
  kind: z.literal("object"),
  entities: z.array(EntitySchema).default([]),
});

export const CollisionLayerSchema = z.object({
  ...LayerBase,
  kind: z.literal("collision"),
  data: z.array(z.number().int().min(0).max(1)),
});

export const LayerSchema = z.discriminatedUnion("kind", [TileLayerSchema, ObjectLayerSchema, CollisionLayerSchema]);

export const MapSchema = z
  .object({
    version: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
    id: z.string(),
    name: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    tileSize: z.number().int().positive(),
    layers: z.array(LayerSchema),
  })
  .superRefine((m, ctx) => {
    const n = m.width * m.height;
    m.layers.forEach((l, i) => {
      if ((l.kind === "tile" || l.kind === "collision") && l.data.length !== n) {
        ctx.addIssue({
          code: "custom",
          path: ["layers", i, "data"],
          message: `layer "${l.name}" has ${l.data.length} cells, expected ${n}`,
        });
      }
    });
  });

export const ProjectSchema = z.object({
  version: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  name: z.string(),
  tileSize: z.number().int().positive().default(16),
  sheets: z.array(z.string()).default([]), // ids; files at sheets/<id>.json
  animations: z.array(z.string()).default([]),
  tilesets: z.array(z.string()).default([]),
  maps: z.array(z.string()).default([]),
});

export type Rect = z.infer<typeof RectSchema>;
export type Frame = z.infer<typeof FrameSchema>;
export type SpriteSheet = z.infer<typeof SpriteSheetSchema>;
export type Animation = z.infer<typeof AnimationSchema>;
export type Tileset = z.infer<typeof TilesetSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type MapData = z.infer<typeof MapSchema>;
export type Project = z.infer<typeof ProjectSchema>;
