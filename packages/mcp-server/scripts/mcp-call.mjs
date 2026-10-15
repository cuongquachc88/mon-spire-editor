// Call one tool on a real stdio MCP server: node scripts/mcp-call.mjs <project> <tool> '<json args>'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const [proj, tool, argsJson = "{}"] = process.argv.slice(2);
const c = new Client({ name: "mcp-call", version: "0" });
await c.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/index.ts", proj] }));
const r = await c.callTool({ name: tool, arguments: JSON.parse(argsJson) });
console.log(JSON.stringify({ isError: !!r.isError, text: r.content[0].type === "text" ? r.content[0].text : "<image>" }));
await c.close();
