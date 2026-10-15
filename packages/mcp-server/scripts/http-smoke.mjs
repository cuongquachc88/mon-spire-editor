// Drives a running Mon Spire Editor desktop app through its built-in MCP endpoint with the official client.
//   node scripts/http-smoke.mjs <url> <out-dir>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { writeFileSync } from "node:fs";
const [url, outDir] = process.argv.slice(2);
const c = new Client({ name: "http-smoke", version: "0" });
await c.connect(new StreamableHTTPClientTransport(new URL(url)));
const call = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); return { isError: !!r.isError, content: r.content }; };
const text = (r) => r.content[0].text;
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : `  [${extra}]`)); };

const tools = (await c.listTools()).tools.map((t) => t.name);
check("tools/list returns the full tool set", tools.length >= 25 && tools.includes("sprite_draw") && tools.includes("map_autotile"), String(tools.length));
const info = await call("project_info");
check("project_info reads the open project", !info.isError && JSON.parse(text(info)).name === "scratch", text(info));

check("sprite_create works over HTTP", !(await call("sprite_create", { id: "gem", width: 16, height: 16 })).isError);
const d = await call("sprite_draw", { sheetId: "gem", ops: [{ op: "ellipse", cx: 8, cy: 8, rx: 6, ry: 6, color: "#ff3366" }, { op: "rect", x: 6, y: 6, w: 2, h: 2, color: "#ffd0dc" }] });
check("sprite_draw changes pixels", !d.isError && /pixel\(s\) changed/.test(text(d)), text(d));
const prev = await call("sprite_preview", { sheetId: "gem", scale: 8 });
check("sprite_preview returns a PNG image (codec works in the webview)", prev.content[0].type === "image" && Buffer.from(prev.content[0].data, "base64").subarray(1, 4).toString() === "PNG");
writeFileSync(`${outDir}/http-gem.png`, Buffer.from(prev.content[0].data, "base64"));

await call("sprite_slice", { sheetId: "gem", frameWidth: 16, frameHeight: 16 });
await call("tileset_create", { id: "gem-ts", name: "Gem", sheetId: "gem" });
await call("map_create", { id: "m", name: "M", width: 3, height: 2, tilesetId: "gem-ts" });
await call("map_fill", { mapId: "m", layerId: "ground", x: 0, y: 0, w: 3, h: 2, value: 1 });
const mp = await call("map_render_preview", { id: "m", scale: 4 });
check("map_render_preview works", mp.content[0].type === "image");
const v = await call("project_validate");
check("project_validate is ok", JSON.parse(text(v)).ok === true, text(v));
const bad = await call("map_get", { id: "does-not-exist" });
check("tool errors come back as isError, not a crash", bad.isError === true, text(bad));
await c.close();
console.log(results.every(Boolean) ? "ALL PASSED" : "FAILED");
process.exit(results.every(Boolean) ? 0 : 1);
