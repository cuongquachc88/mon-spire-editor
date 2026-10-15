import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { projectFsPlugin } from "./server/project-fs";

// Project folder the editor edits; same folder the MCP server serves.
const projectRoot = resolve(process.env.MSE_PROJECT ?? "../../projects/demo");

export default defineConfig({
  plugins: [react(), projectFsPlugin(projectRoot)],
  clearScreen: false, // keep Rust/Tauri logs visible
  server: { port: 5173, strictPort: true },
});
