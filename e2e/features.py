"""Market-inspired features: autotile terrain, block stamps, animated entities, symmetry, flip, tiled preview, atlas export."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image

P = os.environ["MSE_E2E_PROJ"]; S = os.environ["MSE_E2E_OUT"]
MCP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "packages", "mcp-server")
errors = []
def read(p): return json.load(open(f"{P}/{p}"))
def check(n, c, x=""):
    print(("PASS " if c else "FAIL ") + n + (f"  [{x}]" if x and not c else ""))
    if not c: errors.append(n)
def mcp(tool, args):
    r = subprocess.run(["node", "scripts/mcp-call.mjs", P, tool, json.dumps(args)], cwd=MCP, capture_output=True, text=True, timeout=60)
    try: out = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception: out = {"isError": True, "text": r.stdout + r.stderr}
    if out["isError"]: raise SystemExit(f"MCP {tool} failed: {out['text']}")
    return out

# --- fixture built purely through MCP tools -------------------------------------------------
mcp("sprite_create", {"id": "blob", "width": 64, "height": 16})
mcp("sprite_slice", {"sheetId": "blob", "frameWidth": 4, "frameHeight": 16})            # 16 frames in a row
mcp("tileset_create", {"id": "blob-ts", "name": "Blob", "sheetId": "blob"})
mcp("tileset_define_terrain", {"tilesetId": "blob-ts", "terrain": "grass", "tiles": [{"tile": m + 1, "mask": m} for m in range(16)]})
mcp("map_create", {"id": "m", "name": "M", "width": 5, "height": 3, "tilesetId": "blob-ts"})
# two-frame animation whose frames are solid red / solid blue, as an entity on the map
mcp("sprite_create", {"id": "pulse", "width": 32, "height": 16})
mcp("sprite_draw", {"sheetId": "pulse", "ops": [{"op": "rect", "x": 0, "y": 0, "w": 16, "h": 16, "color": "#ff0000"}, {"op": "rect", "x": 16, "y": 0, "w": 16, "h": 16, "color": "#0000ff"}]})
mcp("sprite_slice", {"sheetId": "pulse", "frameWidth": 16, "frameHeight": 16})
mcp("animation_create", {"id": "pulse", "name": "Pulse", "sheetId": "pulse", "frameIds": ["pulse_0", "pulse_1"], "fps": 10})
mcp("layer_add", {"mapId": "m", "layerId": "fx", "name": "FX", "kind": "object"})
mcp("entity_place", {"mapId": "m", "layerId": "fx", "entityId": "p1", "type": "pulse", "x": 24, "y": 32, "props": {"animation": "pulse"}})

with sync_playwright() as pw:
    b = pw.chromium.launch(channel="chrome", headless=True)
    pg = b.new_page(viewport={"width": 1300, "height": 800}); logs = []
    pg.on("console", lambda m: logs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: logs.append(str(e)))
    pg.goto("http://127.0.0.1:5173/"); pg.wait_for_selector(".topbar")

    pg.click(".rail >> text=Map"); pg.select_option(".side select >> nth=0", "m"); pg.wait_for_selector("canvas"); time.sleep(0.6)
    box = pg.locator("canvas").bounding_box()
    Z = 8; cell = lambda x, y: (box["x"] + 16 + (x + .5) * 16 * Z, box["y"] + 16 + (y + .5) * 16 * Z)   # zoom is capped at 8 on this viewport

    # animated entity: the sprite cycles red/blue (anchored bottom-centre at (24,32) => centre of sprite is (24,24))
    def px(x, y):
        return pg.evaluate("""([x,y]) => { const c=document.querySelector('canvas'); const d=c.getContext('2d').getImageData(x*devicePixelRatio,y*devicePixelRatio,1,1).data; return [d[0],d[1],d[2]]; }""", [16 + 24 * Z, 16 + 24 * Z])
    seen = set()
    for _ in range(25):
        c = px(0, 0); seen.add("red" if c[0] > 200 and c[2] < 60 else "blue" if c[2] > 200 and c[0] < 60 else "other"); time.sleep(0.06)
    check("entity animation plays in the editor (red and blue both seen)", {"red", "blue"} <= seen, str(seen))

    # terrain tool: drag across 3 cells of row 1 -> masks fit themselves (E, E+W, W) => tiles 3, 11, 9
    pg.click("button:has-text('Terrain')")
    pg.select_option("label:has-text('Terrain') select", "grass")
    x0, y0 = cell(1, 1); x2, _ = cell(3, 1)
    pg.mouse.move(x0, y0); pg.mouse.down()
    for i in range(1, 11): pg.mouse.move(x0 + (x2 - x0) * i / 10, y0)
    pg.mouse.up(); time.sleep(0.8)
    data = read("maps/m.json")["layers"][0]["data"]
    check("terrain brush fits edges automatically", data[6:9] == [3, 11, 9], str(data))
    # shift-click erases the middle cell and re-fits the ends
    xm, ym = cell(2, 1)
    pg.keyboard.down("Shift"); pg.mouse.click(xm, ym); pg.keyboard.up("Shift"); time.sleep(0.8)
    data = read("maps/m.json")["layers"][0]["data"]
    check("shift-click erases terrain and re-fits neighbours", data[6:9] == [1, 0, 1], str(data))
    pg.keyboard.press("Control+z"); time.sleep(0.8)
    check("undo restores the run in one step", read("maps/m.json")["layers"][0]["data"][6:9] == [3, 11, 9])

    # stamp: select tiles 1..3 as a block (shift+click) and place with the brush
    pg.click("button:has-text('Brush')")
    pg.click(".tilegrid button >> nth=0"); pg.click(".tilegrid button >> nth=2", modifiers=["Shift"])
    check("stamp size is announced", "Stamp 3×1" in pg.inner_text(".side"), pg.inner_text(".side")[-200:])
    sx, sy = cell(0, 2); pg.mouse.click(sx, sy); time.sleep(0.8)
    data = read("maps/m.json")["layers"][0]["data"]
    check("brush places the whole block", data[10:13] == [1, 2, 3], str(data))
    pg.screenshot(path=f"{S}/feat-map.png")

    # pixel editor: mirror X, flip, tiled preview
    pg.click(".rail >> text=Pixel")
    pg.fill("input[placeholder=id]", "sym")
    pg.locator(".side .row input[type=number]").nth(0).fill("8"); pg.locator(".side .row input[type=number]").nth(1).fill("8")
    pg.click(".side button:has-text('Create')"); pg.wait_for_selector("canvas.checker"); time.sleep(0.8)
    pg.click("button:has-text('Mirror X')")
    cb = pg.locator("canvas.checker").first.bounding_box(); zz = cb["width"] / 8
    pg.mouse.click(cb["x"] + 1.5 * zz, cb["y"] + 2.5 * zz); time.sleep(1.2)
    im = Image.open(f"{P}/assets/sym.png").convert("RGBA")
    check("mirror X paints the mirrored pixel too", im.getpixel((1, 2))[3] > 0 and im.getpixel((6, 2))[3] > 0, f"{im.getpixel((1,2))} {im.getpixel((6,2))}")
    check("only those two pixels were painted", sum(1 for p in im.getdata() if p[3] > 0) == 2)
    pg.click("button:has-text('Mirror X')")
    pg.click("button:has-text('Flip ↔')"); time.sleep(1.2)
    im = Image.open(f"{P}/assets/sym.png").convert("RGBA")
    check("flip keeps symmetric art symmetric (pixels moved to their mirror)", im.getpixel((6, 2))[3] > 0 and im.getpixel((1, 2))[3] > 0)
    pg.click("button:has-text('Tiled')"); time.sleep(0.3)
    check("tiled preview appears", pg.locator("figure canvas").count() == 1)
    pg.screenshot(path=f"{S}/feat-pixel.png")

    # terrain/mask editor and atlas export in Assets
    pg.click(".rail >> text=Assets")
    pg.click(".list li:has-text('pulse')"); pg.click("button:has-text('Export atlas')"); time.sleep(0.8)
    atlas = read("export/atlas/pulse.json") if os.path.exists(f"{P}/export/atlas/pulse.json") else {}
    check("atlas json written with frames and animation", "pulse_1" in atlas.get("frames", {}) and "pulse" in atlas.get("animations", {}), str(atlas)[:120])
    check("atlas png copied", os.path.exists(f"{P}/export/atlas/pulse.png"))
    # deleting sheets from the list: confirm dialogs are auto-accepted
    pg.on("dialog", lambda d: d.accept())
    pg.click(".list li:has-text('blob') .x"); pg.wait_for_timeout(600)
    check("a sheet used by a tileset cannot be deleted, with the reason shown", "used by tileset blob-ts" in pg.inner_text(".side") and "blob" in read("project.json")["sheets"], pg.inner_text(".side")[-160:])
    check("the delete button is on every sheet row", pg.locator(".list li .x").count() >= 2)
    png_before = os.path.exists(f"{P}/assets/pulse.png")
    pg.click(".list li:has-text('pulse') .x"); pg.wait_for_timeout(1200)  # not time.sleep: only Playwright calls dispatch the confirm() dialog event
    pr = read("project.json")
    check("deleting a free sheet removes it, its animation and its PNG", png_before and "pulse" not in pr["sheets"] and "pulse" not in pr["animations"] and not os.path.exists(f"{P}/assets/pulse.png") and not os.path.exists(f"{P}/sheets/pulse.json"), str(pr["sheets"]))
    pg.click("nav.subtabs >> text=tilesets"); pg.click(".list li:has-text('blob-ts')"); pg.click(".tilegrid button >> nth=2")
    cbs = pg.locator("fieldset.mask input[type=checkbox]")
    check("mask editor shows tile 3 as east-only (mask 2)", cbs.nth(1).is_checked() and not cbs.nth(0).is_checked() and not cbs.nth(2).is_checked())
    cbs.nth(0).check(); time.sleep(0.8)
    check("toggling N updates the tile mask on disk", read("tilesets/blob-ts.json")["tiles"][2]["mask"] == 3)

    check("no console errors", not logs, "; ".join(logs[:3]))
    b.close()
print("\nFAILED:" if errors else "\nALL PASSED", errors); sys.exit(1 if errors else 0)
