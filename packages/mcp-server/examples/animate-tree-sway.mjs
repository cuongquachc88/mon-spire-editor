// Example: derive a 4-frame sway animation from a drawn tree using only MCP tools.
//   SHEET=tree_sway SHEET_W=224 node examples/draw-tree.mjs <project> <out>   # draws frame 0 at x=0..47
//   node examples/animate-tree-sway.mjs <project> <out>                      # builds frames 1..3, slices, animates
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync } from "node:fs";
const [proj, outDir] = process.argv.slice(2);
const c = new Client({ name: "sway", version: "0" });
await c.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/index.ts", proj] }));
const call = async (name, args) => { const r = await c.callTool({ name, arguments: args }); if (r.isError) throw new Error(`${name}: ${r.content[0].text}`); return r.content[0]; };

const FW = 56, FH = 64, SHEET = "tree_sway";
// 1) centre the tree in frame 0: copy it 4px right, then clear the 4 leftover columns
const ops = [
  { op: "copy", x: 0, y: 0, w: 48, h: FH, dx: 4, dy: 0 },
  { op: "rect", x: 0, y: 0, w: 4, h: FH, color: "transparent" },
];
// 2) frames 1..3: shear rows sideways. The top moves most, the trunk base stays planted.
const AMP = 3;
const profile = (y) => Math.pow(Math.max(0, Math.min(1, (56 - y) / 56)), 1.6);
[Math.PI / 2, Math.PI, (3 * Math.PI) / 2].forEach((phase, i) => {
  const k = i + 1;
  const rowShift = Array.from({ length: FH }, (_, y) => AMP * Math.sin(phase) * profile(y));
  ops.push({ op: "copy", x: 0, y: 0, w: FW, h: FH, dx: k * FW, dy: 0, rowShift });
});
console.log((await call("sprite_draw", { sheetId: SHEET, ops })).text);
console.log((await call("sprite_slice", { sheetId: SHEET, frameWidth: FW, frameHeight: FH })).text);
console.log((await call("animation_create", { id: "tree_sway", name: "Tree sway", sheetId: SHEET, frameIds: [0, 1, 2, 3].map((n) => `${SHEET}_${n}`), fps: 6 })).text);
const prev = await call("sprite_preview", { sheetId: SHEET, scale: 4 });
writeFileSync(`${outDir}/tree_sway-frames.png`, Buffer.from(prev.data, "base64"));
await c.close();
