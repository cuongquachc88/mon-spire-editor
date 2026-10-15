# Market notes and roadmap

A short scan of similar tools, what Mon Spire Editor borrowed from them, and what is left. The scan was a handful of web searches
on 2026-10-15, not a full review: it records what those pages said, and where a tool is described as lacking something that
means "I did not find it", not "it does not exist". Sources are at the end.

## Similar tools

| Tool | What it is | Features worth noting |
|---|---|---|
| **Aseprite** | Commercial editor for animated sprites and pixel art | Layers and frames as separate concepts, onion skinning, timeline with real-time preview, customizable palette, RGBA / grayscale / indexed colour (up to 256 colours), a tiled mode for patterns and textures |
| **Pixelorama** | Free, open-source pixel-art tool made with Godot | Sprites, tiles and animations; desktop and web |
| **LDtk** | Open-source 2D level editor from the director of Dead Cells | Auto-layer rules with optional groups per level ("biomes"), tags, entity references (a button that points at a door), a world view that arranges levels freely or in a grid |
| **Tiled** | Long-standing open-source map editor | Terrain brush and Wang sets for edges and corners, automapping rules (run manually or while drawing), reusable object templates |
| **Aseprite MCP servers** | Several community MCP servers for Aseprite | One lists 104 tools in 17 categories, working by generating Lua scripts and running Aseprite in batch mode; another drives a running editor |
| **Pixelsmith** | An MCP server for pixel art | An agent creates a sprite, draws, animates (keyframes or procedural styles) and exports GIF, APNG or a packed sheet, and sees a PNG preview after every step |

## Where this app is different

- **One project for pixel art, maps and AI**, rather than a drawing tool, a map tool and a separate AI integration.
- **The MCP server is built into the app** and works on the project that is open, so a client and a person edit the same folder
  and each sees the other's changes. The Aseprite servers above work by scripting or driving a separate program.
- **The agent looks at its work.** `sprite_preview` and `map_render_preview` return images, as Pixelsmith does.
- **A prompt builder with a request queue**, usable with any MCP client at no cost, and an optional in-app generator when you add your own API key.

## What was borrowed, and where it stands

| Idea | From | Status |
|---|---|---|
| Autotile terrain brush | Tiled, LDtk | Done: 4-neighbour mask, 16 tiles per terrain (`map_autotile`, Terrain tool) |
| Multi-tile stamps | Tiled | Done: Shift-click a block in the palette; `map_stamp` |
| Mirror drawing, flip, tiled preview | Aseprite | Done in the Pixel tab |
| Animation preview, frame tags on tiles | Aseprite, LDtk | Done: animations play in the Assets tab and on the map; tiles carry tags |
| Sprite atlas and Tiled export | Aseprite, Tiled | Done: `export_atlas`, `export_tiled` |
| An agent that previews after each step | Pixelsmith | Done, for both sprites and maps |
| Large tool surface for drawing | Aseprite MCP | Partly: 30 tools; drawing is ops-based (`rect`, `ellipse`, `rows`, `copy`, ...) |

## Roadmap

Ordered by how much a user would notice, with the reason. None of this is promised.

### Next

1. **Undo for MCP edits.** Take a snapshot before each tool call that writes, and offer *Undo last MCP action* in the top bar. Today the editor's
   undo does not cover changes made from outside, which is the main thing that makes handing over control feel risky.
2. **Onion skinning and a frame timeline in the Pixel tab.** Aseprite's strongest idea for animation. Today frames are edited as regions of one sheet.
3. **Palette tools.** Extract a palette from an image, draw locked to a palette, swap colours. The prompt builder already knows the PICO-8, Game Boy and Sweetie-16 palettes.
4. **Selection, move and rotate** in the Pixel tab.
5. **GIF and APNG export** of an animation, and an animation preview image from MCP, so a client can judge motion and not only frames.

### Later

- **MCP transforms**: `sprite_flip`, `sprite_rotate`, `sprite_outline`, `sprite_palette_swap`, so models do not hand-draw what a function can compute.
- **Typed entity definitions and references** (LDtk): declare an entity type with fields once, point one entity at another.
- **Rule-based auto-layers** (LDtk) and the 47-tile blob set for autotile, including diagonal corners.
- **A world view** for arranging several maps.
- **Prefabs** (Tiled object templates): a saved group of tiles and entities placed in one step.
- **MCP resources** (project summary, schemas) so a client can read context without calling a tool, and an optional access token for the HTTP endpoint.
- **Import** from Aseprite and Tiled files.
- **Packaged-app automation**: a passing desktop end-to-end test of Restart/Stop/Start, the Keychain and the generator (the current script is a stub; see `e2e/desktop.py`).
- **Windows and Linux builds**, which the shell is written for but which have not been built or run.

## Sources

- Aseprite: <https://mintlify.com/aseprite/aseprite/introduction>, and the comparison at <https://www.saashub.com/compare-aseprite-vs-pixelorama>
- Pixelorama: <https://www.saashub.com/compare-aseprite-vs-pixelorama>
- LDtk: <https://ldtk.io>, <https://deepnight.itch.io/ldtk/devlog/243249/090-biomes-tags>, <https://gamefromscratch.com/ldtk-1-5-released/>
- Tiled terrain and Wang sets: <https://doc.mapeditor.org/manual/terrain/>; object templates: <https://mapeditor.org/2018/01/03/tiled-1-1-0-released.html>
- Aseprite MCP servers: <https://glama.ai/mcp/servers/diivi/aseprite-mcp>, <https://cdn.jsdelivr.net/gh/diivi/aseprite-mcp@main/README.md>
- Pixelsmith: <https://images.glama.ai/mcp/servers/liamlz11/pixelsmith>
