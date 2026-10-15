// pnpm docs:tools        write docs/mcp-tools.md
// pnpm docs:tools --check  fail if the committed file is out of date
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToolDocs } from "../src/docs";

const target = fileURLToPath(new URL("../../../docs/mcp-tools.md", import.meta.url));
const fresh = await renderToolDocs();
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    /* missing counts as out of date */
  }
  if (current !== fresh) {
    console.error("docs/mcp-tools.md is out of date. Run: pnpm docs:tools");
    process.exit(1);
  }
  console.log("docs/mcp-tools.md is up to date");
} else {
  writeFileSync(target, fresh);
  console.log(`wrote ${target}`);
}
