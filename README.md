# Mon Spire Editor

Sprite asset manager, pixel editor and tile-map editor, plus an MCP server so an AI can build the same
project from the outside. Everything works on a plain folder of JSON + PNG files, so projects diff and
merge in git and the editor and the MCP server can be used at the same time.

```
packages/
  core/        data model (zod), ProjectStore, undo/redo commands, drawing helpers  — no UI, no Node APIs
  editor/      React + Vite UI; wrapped by Tauri for the desktop app (src-tauri/)
  mcp-server/  MCP server (stdio) built on core
projects/demo  sample project
```

## Run it

```bash
pnpm install
pnpm test                         # core + mcp-server unit tests
MSE_PROJECT=$PWD/projects/demo pnpm dev     # browser editor on http://localhost:5173
pnpm desktop                      # Tauri desktop app (needs Rust); pick a project folder on first launch
pnpm desktop:build                # packaged app
```

In the browser the editor reads/writes the folder given by `MSE_PROJECT` through a small dev-server
plugin (`packages/editor/server/project-fs.ts`, confined to that folder). The desktop app talks to the
disk directly via Tauri's fs plugin, limited to the folder you choose.

## Editor

| Tab | What you can do |
|---|---|
| Assets | import PNG sheets, slice by grid (margin/spacing), build tilesets (collision, tags, terrain), build and preview animations |
| Pixel | draw by hand: pencil, eraser, line, rect (Shift = outline), fill, picker, brush size, palette, undo/redo; frame grid overlay; new image or edit a sheet |
| Map | tile/collision/object layers (visibility, lock, reorder), brush/eraser/line/rect/fill/picker, entities with JSON props, wheel zoom, space/right-drag pan, undo/redo |

Keys: `B` brush/pencil, `E` eraser, `L` line, `R` rect, `G` fill, `I` picker, `N` entity (map), `Ctrl/⌘+Z` undo,
`Ctrl/⌘+Shift+Z` or `Ctrl+Y` redo. Edits auto-save after 300 ms.

Changes made on disk (by the MCP server, git, another tool) are picked up by a file watcher and reloaded.
A document with unsaved edits is never overwritten by an external change.

## MCP server

`.mcp.json` registers it for Claude Code. Manually: `pnpm --filter @mse/mcp-server start <project-folder>`
(or set `MSE_PROJECT`).

| Tool | Purpose |
|---|---|
| `project_info`, `project_validate` | overview; check every reference in the project |
| `sprite_import`, `sprite_slice`, `sheet_get` | PNG → sheet → frames |
| `tileset_create`, `tile_set_properties` | tileset from frames; collision / tags |
| `animation_create` | frames + fps or per-frame durations |
| `map_create`, `map_get`, `map_set_tiles`, `map_fill`, `layer_add`, `entity_place` | build maps (batched edits) |
| `map_validate`, `map_render_preview` | verify, and *look at* the result (returns a PNG) |
| `export_tiled` | write `export/tiled/<map>.tmj` + `.tsj` for Tiled / engines with Tiled loaders |

## Project format

```
project.json            index: ids of sheets / animations / tilesets / maps
assets/*.png            art
sheets/<id>.json        image path, grid settings, frames {id, rect, pivot}
tilesets/<id>.json      tiles[] → frameId, collision, tags, terrain (reserved for autotile)
animations/<id>.json    frames[] {frameId, durationMs}, loop, tags
maps/<id>.json          width, height, tileSize, layers[]; tile number n = tilesets.tiles[n-1], 0 = empty
```

Schemas live in `packages/core/src/schema.ts` and are validated on every read and write.

## Known limits

- No autotile yet (the `terrain` field is reserved so it can be added without migrating files).
- Tiled export (TMJ/TSJ) is one-way; there is no Tiled import.
- Editor and MCP writing the same file at the same moment is last-writer-wins at whole-file level.
- Re-slicing a sheet replaces frame ids; run `project_validate` afterwards.
- Deleting a sheet/tileset/animation leaves its PNG on disk by design.
