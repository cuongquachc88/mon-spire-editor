import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToolDocs } from "../src/docs";

const file = fileURLToPath(new URL("../../../docs/mcp-tools.md", import.meta.url));

describe("docs/mcp-tools.md", () => {
  it("lists every tool and prompt the server offers", async () => {
    const md = await renderToolDocs();
    for (const name of ["project_info", "sprite_draw", "map_autotile", "request_claim", "export_atlas", "sheet_delete"]) expect(md).toContain(`### \`${name}\``);
    for (const name of ["draw_sprite", "do_pending_requests"]) expect(md).toContain(`### \`${name}\``);
    expect(md).not.toContain("## Other"); // every tool belongs to a group, so a new tool is never hidden
  });

  it("documents the drawing ops field by field", async () => {
    const md = await renderToolDocs();
    expect(md).toContain("`\"ellipse\"`");
    expect(md).toMatch(/\| `rowShift` \| number\[\] \| no \|/);
  });

  it("is up to date with the server (run `pnpm docs:tools` after changing a tool)", async () => {
    expect(readFileSync(file, "utf8")).toBe(await renderToolDocs());
  });
});
