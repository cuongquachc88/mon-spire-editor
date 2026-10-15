#!/usr/bin/env -S npx tsx
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { ProjectStore } from "@mse/core";
import { NodeFs } from "./node-fs";
import { createServer } from "./server";

const root = resolve(process.argv[2] ?? process.env.MSE_PROJECT ?? ".");
const fs = new NodeFs();
const store = new ProjectStore(fs, root);

if (!(await fs.exists(`${root}/project.json`))) {
  // stdout is the protocol channel; log to stderr only.
  console.error(`[mse-mcp] no project.json in ${root}; run with a project folder: mse-mcp <path> (or set MSE_PROJECT)`);
  process.exit(1);
}

await createServer(store, fs).connect(new StdioServerTransport());
console.error(`[mse-mcp] serving ${root}`);
