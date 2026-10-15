import json, time, os, sys
from playwright.sync_api import sync_playwright

P = os.environ["MSE_E2E_PROJ"]
S = os.environ["MSE_E2E_OUT"]
errors = []
def read(p): return json.load(open(f"{P}/{p}"))
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  [{extra}]" if extra and not cond else ""))
    if not cond: errors.append(name)

with sync_playwright() as pw:
    b = pw.chromium.launch(channel="chrome", headless=True)
    pg = b.new_page(viewport={"width": 1300, "height": 800})
    logs = []
    pg.on("console", lambda m: logs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: logs.append(str(e)))
    pg.on("response", lambda r: logs.append(f"HTTP {r.status} {r.request.method} {r.url}") if r.status >= 400 else None)
    pg.goto("http://127.0.0.1:5173/")
    pg.wait_for_selector("header")
    check("project name shown", "scratch" in pg.inner_text("header"))

    # Assets
    check("sheet listed", "terrain" in pg.inner_text(".list"))
    pg.click("text=tilesets")
    check("tileset listed", "ground" in pg.inner_text(".list"))
    pg.screenshot(path=f"{S}/shot-assets.png")

    # Map: create
    pg.click(".rail >> text=Map")
    pg.click("summary:has-text('New map')")
    pg.fill("input[placeholder=id]", "town")
    pg.fill("input[placeholder=name]", "Town")
    pg.select_option("details select", "ground")
    pg.click("details >> text=Create")
    pg.wait_for_selector("canvas")
    time.sleep(0.4)
    check("map file created", os.path.exists(f"{P}/maps/town.json"))
    check("project registers map", "town" in read("project.json")["maps"])

    # Paint a stroke with tile 2 (wall)
    pg.click(".tilegrid button >> nth=1")
    box = pg.locator("canvas").bounding_box()
    y = box["y"] + 60
    pg.mouse.move(box["x"] + 40, y); pg.mouse.down()
    for dx in range(40, 200, 10): pg.mouse.move(box["x"] + dx, y)
    pg.mouse.up()
    time.sleep(0.8)
    cells = read("maps/town.json")["layers"][0]["data"]
    painted = sum(1 for c in cells if c == 2)
    check("brush stroke saved", painted >= 3, f"painted={painted}")
    pg.screenshot(path=f"{S}/shot-map.png")

    # One undo removes the whole stroke
    pg.keyboard.press("Control+z"); time.sleep(0.8)
    check("undo reverts the entire stroke", sum(1 for c in read("maps/town.json")["layers"][0]["data"] if c) == 0)
    pg.keyboard.press("Control+Shift+z"); time.sleep(0.8)
    check("redo restores the stroke", sum(1 for c in read("maps/town.json")["layers"][0]["data"] if c == 2) == painted)

    # Fill tool on empty area
    pg.click("button:has-text('Fill')")
    pg.click(".tilegrid button >> nth=0")
    pg.mouse.click(box["x"] + 100, box["y"] + 200); time.sleep(0.8)
    filled = sum(1 for c in read("maps/town.json")["layers"][0]["data"] if c == 1)
    check("flood fill saved", filled > 40, f"filled={filled}")

    # Layer add + entity
    pg.select_option(".row select", "object")
    pg.fill(".row input[placeholder=name]", "npcs")
    pg.click(".row >> text=Add"); time.sleep(0.2)
    pg.click("button:has-text('Entity')")
    pg.mouse.click(box["x"] + 100, box["y"] + 100); time.sleep(0.8)
    layers = read("maps/town.json")["layers"]
    ents = [e for l in layers if l["kind"] == "object" for e in l["entities"]]
    check("entity placed on object layer", len(ents) == 1, str(layers[-1]))
    pg.screenshot(path=f"{S}/shot-entity.png")

    # External edit -> editor reloads
    m = read("maps/town.json")
    m["layers"][0]["data"][0] = 4
    json.dump(m, open(f"{P}/maps/town.json", "w"), indent=2)
    time.sleep(1.5)
    check("external change announced", "Changed outside the editor" in pg.inner_text("header"), pg.inner_text("header"))

    # Pixel editor: new image, draw
    pg.click(".rail >> text=Pixel")
    pg.fill("input[placeholder=id]", "hero")
    pg.locator(".side .row input[type=number]").nth(0).fill("8")
    pg.locator(".side .row input[type=number]").nth(1).fill("8")
    pg.click("button:has-text('Create')")
    pg.wait_for_selector("canvas.checker")
    for _ in range(40):
        if os.path.exists(f"{P}/assets/hero.png"): break
        time.sleep(0.1)
    check("blank asset png written", os.path.exists(f"{P}/assets/hero.png"))
    cb = pg.locator("canvas.checker").bounding_box()
    pg.mouse.click(cb["x"] + 20, cb["y"] + 20); time.sleep(2)
    from PIL import Image
    im = Image.open(f"{P}/assets/hero.png").convert("RGBA")
    opaque = sum(1 for px in im.getdata() if px[3] > 0)
    check("pixel drawn and saved", im.size == (8, 8) and opaque >= 1, f"size={im.size} opaque={opaque}")
    check("hero registered as sheet", "hero" in read("project.json")["sheets"])
    pg.screenshot(path=f"{S}/shot-pixel.png")

    print("LOGS:", logs)
    check("no console errors", not logs, "; ".join(logs[:3]))
    b.close()

print("\nFAILED:" if errors else "\nALL PASSED", errors)
sys.exit(1 if errors else 0)
