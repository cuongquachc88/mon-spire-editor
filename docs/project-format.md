# Project format

A project is a folder. Everything the editor and the MCP server know lives in it as JSON and PNG files, so it diffs and merges in git
and can be edited by hand. The schemas are in [`packages/core/src/schema.ts`](../packages/core/src/schema.ts) (zod); every file is validated
when it is read and when it is written, and a bad file is reported with its path and the field that is wrong.

```
my-project/
  project.json          index of everything below
  assets/*.png          the art (any folder is fine; sheets point at their PNG)
  sheets/<id>.json      one sprite sheet: image path, grid settings, frames
  animations/<id>.json  frame sequences over a sheet
  tilesets/<id>.json    tiles built from a sheet's frames
  maps/<id>.json        tile, collision and object layers
  requests/<id>.json    sprite requests from the Create tab
  export/               written by the exporters (tiled/, atlas/)
```

Files are written with two-space indentation and a final newline, so diffs stay small. Ids are letters, digits, `-` and `_`.
A file that exists but is not listed in `project.json` is ignored; `project.json` is the index. Older projects without a
`requests` list still load.

## `project.json`

```json
{
  "version": 1,
  "name": "demo",
  "tileSize": 16,
  "sheets": ["terrain", "tree"],
  "animations": ["tree_sway"],
  "tilesets": ["ground", "trees"],
  "maps": ["town"],
  "requests": []
}
```

`tileSize` is the default size for new maps. The lists hold ids; each id is the name of a file in the matching folder.

## Sheets: `sheets/<id>.json`

```json
{
  "id": "terrain",
  "image": "assets/terrain.png",
  "frameWidth": 16, "frameHeight": 16, "margin": 0, "spacing": 0,
  "frames": [
    { "id": "terrain_0", "name": "terrain_0", "rect": { "x": 0, "y": 0, "w": 16, "h": 16 }, "pivot": { "x": 0.5, "y": 0.5 } }
  ]
}
```

- `image` is relative to the project folder.
- `frames` come from slicing (`<sheet>_<n>`, row-major from 0) or are written by hand. `rect` is in image pixels. `pivot` is a fraction
  of the frame (0.5, 0.5 is the centre) and is carried into the atlas export.
- `frameWidth`, `frameHeight`, `margin` and `spacing` record the last grid slice.
- Slicing again **replaces** the frame list, so tilesets and animations that mention old frame ids break. `project_validate` finds them.

## Animations: `animations/<id>.json`

```json
{
  "id": "tree_sway", "name": "Tree sway", "sheetId": "tree_sway",
  "frames": [ { "frameId": "tree_sway_0", "durationMs": 167 }, { "frameId": "tree_sway_1", "durationMs": 167 } ],
  "loop": true,
  "tags": []
}
```

Each step names a frame of the sheet and how long it shows. `animation_create` with `fps` fills `durationMs` as `round(1000 / fps)`.

## Tilesets: `tilesets/<id>.json`

```json
{
  "id": "ground", "name": "Ground", "sheetId": "terrain",
  "tiles": [
    { "frameId": "terrain_0", "collision": false, "tags": [], "terrain": "grass", "mask": 15 },
    { "frameId": "terrain_1", "collision": true,  "tags": ["wall"] }
  ]
}
```

- **Tile numbers are positions.** Tile *n* in a map is `tiles[n-1]`, and `0` means empty. Removing a tile from the middle would
  renumber everything after it, so the editor never does that silently.
- `collision` marks tiles that block movement; `tags` are free text for your game.
- `terrain` and `mask` drive the autotile brush. `mask` is the set of neighbours that are the same terrain, as bits:
  **N = 1, E = 2, S = 4, W = 8**. `15` means all four sides, `0` means none. A full terrain has 16 tiles, one per mask; a missing
  mask falls back to `15`, then to any tile of that terrain.

## Maps: `maps/<id>.json`

```json
{
  "version": 1, "id": "town", "name": "Town",
  "width": 20, "height": 15, "tileSize": 16,
  "layers": [
    { "id": "ground", "name": "Ground", "kind": "tile", "visible": true, "locked": false, "tilesetId": "ground", "data": [1, 1, 1, "…300 numbers"] },
    { "id": "walls",  "name": "Walls",  "kind": "collision", "visible": true, "locked": false, "data": [0, 1, 0, "…300 numbers of 0 or 1"] },
    { "id": "scenery", "name": "Scenery", "kind": "object", "visible": true, "locked": false,
      "entities": [ { "id": "tree_a", "type": "tree", "x": 40, "y": 175, "props": { "animation": "tree_sway" } } ] }
  ]
}
```

- Layers are listed **bottom to top**; the editor shows them top first.
- `tile` and `collision` layers hold `width × height` numbers in **row-major** order (index = `y * width + x`). A layer whose length
  is wrong makes the whole map invalid, with the layer named in the error.
- `tile` values are tile numbers of the layer's tileset. Different tile layers may use different tilesets.
- `object` layers hold entities. `x` and `y` are in **map pixels** (not cells). `type` and `props` are yours to define, with
  one reserved prop: `props.animation` names an animation, which the editor plays and the previews draw, anchored at the
  entity's **bottom centre**.

## Requests: `requests/<id>.json`

Written by the Create tab (*Queue for MCP client* or *Generate now*) and updated by `request_claim`, `request_complete` and `request_fail`.

```json
{
  "id": "req-mv9igfbj", "status": "done",
  "createdAt": "2026-10-15T12:00:00.000Z", "updatedAt": "2026-10-15T12:01:10.000Z",
  "spec": { "subject": "a friendly green slime", "width": 24, "height": 24, "frames": 4, "style": "snes", "colors": 16, "sheetId": "slime" },
  "prompt": "Draw a creature or monster: …",
  "resultSheetId": "slime",
  "note": "green blob"
}
```

`spec` is shown shortened: it also holds the kind, motion, palette, outline, shading, view, light and notes chosen in the form.
`status` is `pending`, `in_progress`, `done` or `failed`. The app only marks a request `done` when the result sheet exists.

## Exports

| Command | Files |
|---|---|
| `export_tiled` / **Export Tiled** in the Map tab | `export/tiled/<map>.tmj` and one `<tileset>.tsj` per tileset used. Tiles are sub-rectangles of the sheet PNG (so tilesets that are not a regular grid still export); collision layers become rectangle objects; entities become point objects with typed properties. |
| `export_atlas` / **Export atlas** in the Assets tab | `export/atlas/<sheet>.json` (frames in the JSON-hash layout, `meta`, and an `animations` block) and a copy of `<sheet>.png`. |
