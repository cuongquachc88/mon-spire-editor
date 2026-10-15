import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync } from "node:fs";
// Example: how an AI agent (or you) can draw a detailed sprite through MCP tools only.
//   node examples/draw-tree.mjs <project-folder> <output-folder>
// Draws a 48x64 apple tree into sheet $SHEET (default "tree"; created with width $SHEET_W, default 48) and saves a preview PNG.
const SHEET = process.env.SHEET ?? "tree";
const SHEET_W = Number(process.env.SHEET_W ?? 48);
const [proj, outDir] = process.argv.slice(2);
const c = new Client({ name: "tree", version: "0" });
await c.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/index.ts", proj] }));
const call = async (name, args) => {
  const r = await c.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
  return r.content[0];
};
const W = 48, H = 64;
try { await call("sprite_create", { id: SHEET, width: SHEET_W, height: H }); } catch { /* sheet already exists: we redraw it */ }
const inside = (x, y, [cx, cy, rx, ry]) => ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1;
const any = (x, y, list) => list.some((e) => inside(x, y, e));
const grow = (list, d) => list.map(([cx, cy, rx, ry]) => [cx, cy, rx + d, ry + d]);
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return (h ^ (h >>> 16)) / 4294967296; };
const shift = (l, dx, dy) => l.map(([cx, cy, rx, ry]) => [cx + dx, cy + dy, rx, ry]);
const pts = (pred) => { const p = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pred(x, y)) p.push({ x, y }); return p; };
const ell = (e, color, filled = true) => ({ op: "ellipse", cx: e[0], cy: e[1], rx: e[2], ry: e[3], color, filled });

const dark = [[24, 22, 20, 15], [11, 31, 10, 8], [37, 31, 10, 8], [24, 9, 13, 8], [9, 20, 8, 7], [39, 20, 8, 7], [15, 8, 8, 6], [33, 8, 8, 6], [24, 36, 14, 5]];
const mid = [[22, 20, 16, 11], [10, 29, 7, 5], [36, 28, 7, 5], [23, 8, 9, 5], [9, 19, 5, 4], [14, 8, 5, 3]];
const light = [[19, 14, 10, 7], [9, 27, 4, 3], [32, 23, 5, 3], [20, 6, 5, 3]];



const ops = [
  { op: "clear" },
  // soft ground shadow
  { op: "ellipse", cx: 24, cy: 59, rx: 17, ry: 4, color: "#10200f55" },
  // trunk: base + lit left edge + shaded right edge
  { op: "rect", x: 20, y: 34, w: 8, h: 24, color: "#6b4423" },
  { op: "rect", x: 20, y: 34, w: 2, h: 24, color: "#8a5a2e" },
  { op: "rect", x: 26, y: 34, w: 2, h: 24, color: "#4a2f17" },
  // roots flaring out
  { op: "line", x1: 20, y1: 55, x2: 15, y2: 59, color: "#6b4423" },
  { op: "line", x1: 21, y1: 55, x2: 17, y2: 59, color: "#4a2f17" },
  { op: "line", x1: 27, y1: 55, x2: 32, y2: 59, color: "#4a2f17" },
  { op: "line", x1: 26, y1: 56, x2: 30, y2: 59, color: "#6b4423" },
  { op: "rect", x: 19, y: 57, w: 10, h: 2, color: "#4a2f17" },
  // bark texture
  { op: "pixels", color: "#3a2412", points: [[22,38],[22,39],[25,42],[25,43],[23,46],[23,47],[22,51],[26,49],[24,53],[25,54]].map(([x, y]) => ({ x, y })) },
  { op: "pixels", color: "#a0693a", points: [[20,40],[20,44],[21,48],[20,52]].map(([x, y]) => ({ x, y })) },
  // branches reaching into the canopy
  { op: "line", x1: 22, y1: 36, x2: 14, y2: 29, color: "#4a2f17" },
  { op: "line", x1: 26, y1: 36, x2: 34, y2: 28, color: "#4a2f17" },
  // canopy: outline silhouette, then dark body
  ...grow(dark, 1).map((e) => ell(e, "#0e2a14")),
  ...dark.map((e) => ell(e, "#1e5a2b")),
  // mid tone with a checker dither on its rim for a soft transition
  ...mid.map((e) => ell(e, "#2f8a3e")),
  { op: "pixels", color: "#2f8a3e", points: pts((x, y) => (x + y) % 2 === 0 && any(x, y, grow(mid, 2)) && !any(x, y, mid) && any(x, y, dark)) },
  // light tone + dither
  ...light.map((e) => ell(e, "#52b84f")),
  { op: "pixels", color: "#52b84f", points: pts((x, y) => (x + y) % 2 === 0 && any(x, y, grow(light, 2)) && !any(x, y, light) && any(x, y, mid)) },
  // leaf-edge notches on the lower rim of the canopy so it doesn't read as a smooth blob
  { op: "pixels", color: "#143f1e", points: pts((x, y) => any(x, y, dark) && !any(x, y, grow(mid, 3)) && hash(x, y) < 0.22) },
  { op: "pixels", color: "#0e2a14", points: pts((x, y) => any(x, y, dark) && !any(x, y, grow(dark, -2)) && y > 24 && hash(x + 7, y) < 0.3) },
  { op: "pixels", color: "#256f33", points: pts((x, y) => any(x, y, mid) && !any(x, y, shift(mid, -2, -2)) && !any(x, y, light)) },
  { op: "pixels", color: "#8ae062", points: pts((x, y) => any(x, y, light) && !any(x + 1, y + 1, light)) },
  // highlight sparkles of leaves in the lit area
  { op: "rows", x: 14, y: 9, rows: ["..h..", ".hhh.", "h.h.h"], legend: { h: "#9be86f" } },
  { op: "rows", x: 24, y: 13, rows: [".h.", "hhh"], legend: { h: "#9be86f" } },
  { op: "rows", x: 11, y: 18, rows: ["h.h", ".h."], legend: { h: "#9be86f" } },
  { op: "rows", x: 28, y: 18, rows: ["..h", ".hh", "h.."], legend: { h: "#7fd35c" } },
  { op: "rows", x: 6, y: 25, rows: [".h.", "hhh"], legend: { h: "#7fd35c" } },
  { op: "rows", x: 21, y: 4, rows: ["hh", ".h"], legend: { h: "#9be86f" } },
  { op: "rows", x: 22, y: 44, rows: [".dd.", "dbbd", ".dd."], legend: { d: "#3a2412", b: "#2a1809" } },
  { op: "pixels", color: "#3f9a45", points: [[20, 56], [21, 57], [27, 57], [28, 56], [19, 58]].map(([x, y]) => ({ x, y })) },
  // apples: highlight, body, shade
  ...[[14, 24], [30, 30], [37, 21], [21, 29], [8, 33], [27, 16]].map(([x, y]) => ({ op: "rows", x, y, rows: ["hr", "rd"], legend: { h: "#ff9a9a", r: "#d93636", d: "#8f1d1d" } })),
];
console.log((await call("sprite_draw", { sheetId: SHEET, ops })).text);

const prev = await call("sprite_preview", { sheetId: SHEET, scale: 8 });
writeFileSync(`${outDir}/${SHEET}-final.png`, Buffer.from(prev.data, "base64"));
const got = JSON.parse((await call("sprite_get", { sheetId: SHEET })).text);
console.log("colors used:", Object.keys(got.legend).length - 1, "| size", got.width + "x" + got.height);
await c.close();
