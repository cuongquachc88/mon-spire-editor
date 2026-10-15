"""Prompt builder and request queue: form -> prompt -> queue -> Claude claims and completes over MCP -> UI follows."""
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

P = os.environ["MSE_E2E_PROJ"]; S = os.environ["MSE_E2E_OUT"]
MCP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "packages", "mcp-server")
errors = []
def read(p): return json.load(open(f"{P}/{p}"))
def check(n, c, x=""):
    print(("PASS " if c else "FAIL ") + n + (f"  [{x}]" if x and not c else ""))
    if not c: errors.append(n)
def mcp(tool, args=None):
    r = subprocess.run(["node", "scripts/mcp-call.mjs", P, tool, json.dumps(args or {})], cwd=MCP, capture_output=True, text=True, timeout=60)
    try: return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception: return {"isError": True, "text": r.stdout + r.stderr}

with sync_playwright() as pw:
    b = pw.chromium.launch(channel="chrome", headless=True)
    ctx = b.new_context(viewport={"width": 1400, "height": 900}); ctx.grant_permissions(["clipboard-read", "clipboard-write"])
    pg = ctx.new_page(); logs = []
    pg.on("console", lambda m: logs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: logs.append(str(e)))
    pg.goto("http://127.0.0.1:5173/"); pg.wait_for_selector(".topbar")
    pg.click(".rail >> text=Create")

    check("nothing to show until a subject is typed", "Describe what to draw" in pg.inner_text(".panel"))
    pg.fill("textarea >> nth=0", "a red slime with a tiny crown")
    pg.wait_for_selector(".prompt-text")
    t = pg.inner_text(".prompt-text")
    check("prompt names the subject, size and derived sheet id", "a red slime with a tiny crown" in t and "32x32 pixels" in t and 'sprite_create id "a-red-slime-with-a-tiny-crown"' in t, t[:200])
    check("single frame has no animation steps", "animation_create" not in t)

    pg.locator("input[type=range]").first.fill("4")
    pg.fill("input[placeholder^='What moves']", "squashes and stretches")
    t = pg.inner_text(".prompt-text")
    check("frames add sheet width and animation steps", "4 frames side by side (128x32 sheet)" in t and "squashes and stretches" in t and 'animation_create id' in t)

    pg.fill("input[placeholder^='#1d2b53']", "red")
    check("a bad palette explains itself instead of showing a prompt", "Use #rrggbb" in pg.inner_text(".panel"), pg.inner_text(".panel")[:160])
    pg.fill("input[placeholder^='#1d2b53']", "#220000, #ff0000")
    check("a valid palette is used exactly", "exactly this palette (add nothing else): #220000, #ff0000" in pg.inner_text(".prompt-text"))

    pg.fill("label:has-text('Sheet id') input", "terrain")
    check("an id that already exists is refused with a reason", 'already exists' in pg.inner_text(".panel") and pg.locator("button:has-text('Queue for MCP client')").is_disabled())
    pg.fill("label:has-text('Sheet id') input", "slime")
    prompt_now = pg.inner_text(".prompt-text")
    pg.click("button:has-text('Copy prompt')"); time.sleep(0.3)
    check("copy puts the whole prompt on the clipboard", pg.evaluate("navigator.clipboard.readText()") == prompt_now)

    pg.click("button:has-text('Queue for MCP client')"); time.sleep(1.0)
    reqs = read("project.json")["requests"]
    check("queue writes a request file and registers it", len(reqs) == 1 and os.path.exists(f"{P}/requests/{reqs[0]}.json"), str(reqs))
    saved = read(f"requests/{reqs[0]}.json")
    check("the request keeps the spec and the exact prompt", saved["status"] == "pending" and saved["spec"]["sheetId"] == "slime" and saved["spec"]["frames"] == 4 and saved["prompt"] == prompt_now)
    check("UI lists it as waiting for an MCP client", "Waiting for an MCP client" in pg.inner_text(".requests"))
    check("form is cleared after queueing", pg.input_value("textarea >> nth=0") == "")

    # The MCP client's side, through the real stdio MCP server
    r = mcp("request_claim")
    check("claude can claim it and gets the prompt", not r["isError"] and json.loads(r["text"])["sheetId"] == "slime" and "sprite_create" in json.loads(r["text"])["prompt"], r["text"][:120])
    pg.wait_for_function("document.querySelector('.requests').innerText.includes('Being drawn')", timeout=8000)
    check("UI switches to 'Being drawn' on its own", True)

    early = mcp("request_complete", {"id": reqs[0]})
    check("completing before drawing is refused", early["isError"] and "does not exist yet" in early["text"], early["text"])
    mcp("sprite_create", {"id": "slime", "width": 128, "height": 32})
    mcp("sprite_draw", {"sheetId": "slime", "ops": [{"op": "ellipse", "cx": 16, "cy": 20, "rx": 10, "ry": 8, "color": "#3cb44b"}]})
    done = mcp("request_complete", {"id": reqs[0], "note": "green blob"})
    check("claude completes the request", not done["isError"], done["text"])
    pg.wait_for_function("document.querySelector('.requests').innerText.includes('Done')", timeout=8000)
    check("UI shows Done with the client's note", "green blob" in pg.inner_text(".requests"))
    pg.screenshot(path=f"{S}/create.png")

    pg.click("button:has-text('Open sprite')"); pg.wait_for_selector("canvas.checker"); time.sleep(0.4)
    check("Open sprite jumps to the pixel editor on that sheet", pg.locator(".rail button.on").inner_text().strip() == "Pixel" and pg.locator(".side select >> nth=0").input_value() == "slime")

    # failing a request
    pg.click(".rail >> text=Create")
    pg.fill("textarea >> nth=0", "something vague"); pg.click("button:has-text('Queue for MCP client')"); time.sleep(0.8)
    nid = [x for x in read("project.json")["requests"] if x != reqs[0]][0]
    mcp("request_fail", {"id": nid, "reason": "Too vague: what kind of thing is it?"})
    pg.wait_for_function("document.querySelector('.requests').innerText.includes('Failed')", timeout=8000)
    check("a failed request shows the client's reason and offers Try again", "Too vague" in pg.inner_text(".requests") and pg.locator("button:has-text('Try again')").count() == 1)
    pg.click("button:has-text('Try again')"); time.sleep(0.8)
    check("Try again puts it back in the queue", read(f"requests/{nid}.json")["status"] == "pending")

    # the MCP popup must fit a short window and scroll to its end
    pg.set_viewport_size({"width": 1100, "height": 360})
    pg.click("header >> text=MCP"); pg.wait_for_selector(".dialog")
    box = pg.locator(".dialog").bounding_box()
    check("the MCP popup fits inside a short window", box["y"] >= 0 and box["y"] + box["height"] <= 360, str(box))
    sh = pg.evaluate("(() => { const b = document.querySelector('.dialog-body'); return [b.scrollHeight, b.clientHeight]; })()")
    check("its body is taller than what is visible, so it scrolls", sh[0] > sh[1], str(sh))
    pg.evaluate("document.querySelector('.dialog-body').scrollTop = 99999")
    end = pg.evaluate("(() => { const p = [...document.querySelectorAll('.dialog-body p')].pop().getBoundingClientRect(); return [p.top, p.bottom, innerHeight]; })()")
    check("scrolling reaches the last line", 0 <= end[0] and end[1] <= end[2], str(end))
    check("the popup says MCP, not a product name", pg.inner_text(".dialog h2").strip() == "MCP")
    pg.keyboard.press("Escape")
    check("Escape closes it", pg.locator(".dialog").count() == 0)

    check("no console errors", not logs, "; ".join(logs[:3]))
    b.close()
print("\nFAILED:" if errors else "\nALL PASSED", errors); sys.exit(1 if errors else 0)
