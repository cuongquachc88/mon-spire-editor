// Example: put animated trees on a map. Entities are anchored bottom-centre at (x, y) in map pixels.
//   node examples/place-animated-trees.mjs <project> <out>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync } from "node:fs";
const [proj, outDir] = process.argv.slice(2);
const c = new Client({ name: "place-anim", version: "0" });
await c.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/index.ts", proj] }));
const call = async (name, args) => { const r = await c.callTool({ name, arguments: args }); if (r.isError) throw new Error(`${name}: ${r.content[0].text}`); return r.content[0]; };
console.log((await call("layer_add", { mapId: "town", layerId: "scenery", name: "Animated scenery", kind: "object" })).text);
for (const [id, x, y] of [["tree_a", 40, 175], ["tree_b", 72, 229], ["tree_c", 264, 229]])
  console.log((await call("entity_place", { mapId: "town", layerId: "scenery", entityId: id, type: "tree", x, y, props: { animation: "tree_sway" } })).text);
console.log((await call("project_validate", {})).text.replace(/\s+/g, " "));
const img = await call("map_render_preview", { id: "town", scale: 3 });
writeFileSync(`${outDir}/town-animated.png`, Buffer.from(img.data, "base64"));
console.log((await call("export_atlas", { sheetId: "tree_sway" })).text.replace(/\s+/g, " "));
await c.close();
