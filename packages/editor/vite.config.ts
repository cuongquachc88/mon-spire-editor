import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { projectFsPlugin } from "./server/project-fs";

// pngjs@7 has a browser build but does not declare it, so without this Vite bundles the Node entry
// (util/zlib/stream) and the app dies at startup. The MCP tools running inside the app need pngjs.
const pngjsBrowser = createRequire(resolve(__dirname, "../mcp-server/package.json")).resolve("pngjs/browser.js");

// Project folder the editor edits; same folder the MCP server serves.
const projectRoot = resolve(process.env.MSE_PROJECT ?? "../../projects/demo");

export default defineConfig({
  plugins: [react(), projectFsPlugin(projectRoot)],
  resolve: { alias: { pngjs: pngjsBrowser } },
  clearScreen: false, // keep Rust/Tauri logs visible
  server: { port: 5173, strictPort: true },
});
