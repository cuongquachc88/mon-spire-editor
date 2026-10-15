import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
P = os.environ["MSE_E2E_PROJ"]; S = os.environ["MSE_E2E_OUT"]
MCP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "packages", "mcp-server")
errors = []
def read(p): return json.load(open(f"{P}/{p}"))
def check(n, c, x=""):
    print(("PASS " if c else "FAIL ") + n + (f"  [{x}]" if x and not c else ""))
    if not c: errors.append(n)
def mcp(tool, args):
    r = subprocess.run(["node", "scripts/mcp-call.mjs", P, tool, json.dumps(args)], cwd=MCP, capture_output=True, text=True, timeout=60)
    try: return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception: return {"isError": True, "text": r.stdout + r.stderr}

with sync_playwright() as pw:
    b = pw.chromium.launch(channel="chrome", headless=True)
    pg = b.new_page(viewport={"width": 1300, "height": 800}); logs = []
    pg.on("console", lambda m: logs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: logs.append(str(e)))
    pg.goto("http://127.0.0.1:5173/"); pg.wait_for_selector("header")

    # --- MCP builds a map; editor (already open) must pick it up
    r = mcp("map_create", {"id": "plains", "name": "Plains", "width": 6, "height": 4, "tilesetId": "ground"})
    check("mcp map_create ok", not r["isError"], r["text"])
    r = mcp("map_fill", {"mapId": "plains", "layerId": "ground", "x": 0, "y": 0, "w": 6, "h": 4, "value": 3})
    check("mcp map_fill ok", not r["isError"], r["text"])
    pg.click(".rail >> text=Map")
    pg.wait_for_function("document.querySelector('.side select option[value=plains]') !== null", timeout=8000)
    check("editor lists map created by MCP", True)
    pg.select_option(".side select >> nth=0", "plains"); pg.wait_for_selector("canvas"); time.sleep(0.5)
    def px(x, y):
        return pg.evaluate("""([x,y]) => { const c=document.querySelector('canvas'); const d=c.getContext('2d').getImageData(x*devicePixelRatio,y*devicePixelRatio,1,1).data; return [d[0],d[1],d[2]]; }""", [x, y])
    box = pg.locator("canvas").bounding_box()
    # first cell at view offset (16,16); zoom>=1 so (30,30) is inside cell (0,0)
    c1 = px(30, 30)
    check("canvas shows MCP-filled tile 3 (water-blue)", c1[2] > c1[0] and c1[2] > 120, str(c1))

    # MCP edits again while the map is open: change cell (0,0) to tile 4 (sand)
    r = mcp("map_set_tiles", {"mapId": "plains", "layerId": "ground", "cells": [{"x": 0, "y": 0, "value": 4}]})
    time.sleep(1.5)
    c2 = px(30, 30)
    check("live reload after MCP edit (sand = warm)", c2[0] > c2[2], f"before={c1} after={c2}")
    check("header announces reload", "Changed outside the editor" in pg.inner_text("header"), pg.inner_text("header"))

    # --- Tiled export button
    pg.click("button:has-text('Export Tiled')"); time.sleep(0.8)
    check("export wrote tmj", os.path.exists(f"{P}/export/tiled/plains.tmj"))
    tmj = read("export/tiled/plains.tmj")
    check("tmj gids correct", tmj["layers"][0]["data"][0] == 4 and tmj["layers"][0]["data"][1] == 3, str(tmj["layers"][0]["data"][:3]))
    check("tsj written", os.path.exists(f"{P}/export/tiled/ground.tsj"))

    # --- Assets: import PNG, slice, tileset, animation
    from PIL import Image
    im = Image.new("RGBA", (32, 16)); 
    for x in range(32):
        for y in range(16): im.putpixel((x, y), (255, 0, 0, 255) if x < 16 else (0, 0, 255, 255))
    im.save(f"{S}/extra.png")
    pg.click(".rail >> text=Assets")
    pg.set_input_files("input[type=file]", f"{S}/extra.png"); time.sleep(1)
    check("png imported as sheet", os.path.exists(f"{P}/assets/extra.png") and "extra" in read("project.json")["sheets"])
    pg.click(".list li:has-text('extra')")
    pg.click("button:has-text('Slice')"); time.sleep(1)
    check("sheet sliced into 2 frames", len(read("sheets/extra.json")["frames"]) == 2, str(read("sheets/extra.json")["frames"]))
    pg.click("nav.subtabs >> text=tilesets")
    pg.click("summary:has-text('New tileset')")
    pg.fill("input[placeholder=id]", "extra-ts"); pg.select_option("details select", "extra"); pg.click("details >> text=Create"); time.sleep(1)
    check("tileset created with 2 tiles", len(read("tilesets/extra-ts.json")["tiles"]) == 2)
    pg.click(".tilegrid button >> nth=1")
    pg.check("text=Blocks movement >> input"); time.sleep(0.8)
    check("collision toggle saved", read("tilesets/extra-ts.json")["tiles"][1]["collision"] is True)
    pg.click("nav.subtabs >> text=animations")
    pg.fill("input[placeholder=id]", "blink"); pg.select_option(".side select", "extra")
    pg.click(".tilegrid button >> nth=0"); pg.click(".tilegrid button >> nth=1")
    pg.click(".side button:has-text('Create')"); time.sleep(1)
    a = read("animations/blink.json")
    check("animation saved with 2 steps @125ms", [f["frameId"] for f in a["frames"]] == ["extra_0", "extra_1"] and a["frames"][0]["durationMs"] == 125, str(a))
    pg.screenshot(path=f"{S}/shot-anim.png")

    # --- project_validate via MCP agrees everything is consistent
    r = mcp("project_validate", {})
    check("mcp project_validate ok", not r["isError"] and json.loads(r["text"])["ok"], r["text"])

    check("no console errors", not logs, "; ".join(logs[:3]))
    b.close()
print("\nFAILED:" if errors else "\nALL PASSED", errors); sys.exit(1 if errors else 0)
