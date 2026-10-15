"""Presets, style packs and in-app generation with an API key (against a mock of the Anthropic API)."""
import json, os, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mock_anthropic import Mock

P = os.environ["MSE_E2E_PROJ"]; S = os.environ["MSE_E2E_OUT"]
errors = []
def read(p): return json.load(open(f"{P}/{p}"))
def check(n, c, x=""):
    print(("PASS " if c else "FAIL ") + n + (f"  [{x}]" if x and not c else ""))
    if not c: errors.append(n)

mock = Mock()
with sync_playwright() as pw:
    b = pw.chromium.launch(channel="chrome", headless=True)
    pg = b.new_page(viewport={"width": 1400, "height": 1000}); logs = []
    # failed HTTP calls (401 on purpose) are logged by Chrome as console errors; those are expected here
    pg.on("console", lambda m: logs.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    pg.on("pageerror", lambda e: logs.append(str(e)))
    pg.goto("http://127.0.0.1:5173/"); pg.wait_for_selector(".topbar"); pg.click(".rail >> text=Create")

    # ---- presets -----------------------------------------------------------------------------------------
    check("many presets are offered", pg.locator(".presets button").count() >= 40, str(pg.locator(".presets button").count()))
    pg.fill("input[type=search]", "slime")
    check("search narrows the presets", pg.locator(".presets button").count() == 1 and "Slime" in pg.inner_text(".presets"))
    pg.click(".presets button")
    check("a preset fills subject, frames and motion", "friendly green slime" in pg.input_value("textarea >> nth=0") and "squash and stretch" in pg.inner_text(".prompt-text") and "4 frames side by side (96x24 sheet)" in pg.inner_text(".prompt-text"), pg.inner_text(".prompt-text")[:200])
    pg.fill("input[type=search]", "")
    pg.click("[role=tab]:has-text('Tiles')")
    check("a group filters the list", pg.locator(".presets button").count() >= 4 and "Grass tile" in pg.inner_text(".presets") and "Slime" not in pg.inner_text(".presets"))
    pg.select_option("label:has-text('Style pack') select", "pico8")
    check("a style pack sets the exact palette", "#1d2b53" in pg.input_value("input[placeholder^='#1d2b53']") and "exactly this palette" in pg.inner_text(".prompt-text"))
    pg.select_option("label:has-text('Style pack') select", "")
    pg.fill("input[placeholder^='#1d2b53']", "")
    check("without a key, Generate now is unavailable and says why", pg.locator("button:has-text('Generate now')").is_disabled() and "No API key" in pg.inner_text(".ai-settings"))

    # ---- key and settings --------------------------------------------------------------------------------
    check("the key form is open when there is no key", pg.locator("input[type=password]").is_visible())
    pg.click(".ai-settings summary:has-text('Advanced')")
    pg.fill("label:has-text('API address') input", mock.url)
    pg.fill("input[type=password]", "bad-key"); pg.click("button:has-text('Test')"); pg.wait_for_selector("text=rejected (401)", timeout=8000)
    check("a rejected key is explained in plain words", True)
    pg.fill("input[type=password]", "sk-ant-test-0123456789"); pg.click("button:has-text('Save key')"); pg.wait_for_selector(".keystate.on")
    check("saving a key does not hide the form", pg.locator("button:has-text('Test')").is_visible())
    check("the key is masked once saved", "sk-ant-…6789" in pg.inner_text(".keystate") and pg.input_value("input[type=password]") == "", pg.inner_text(".keystate"))
    pg.click("button:has-text('Test')"); pg.wait_for_selector("text=The key works.", timeout=8000)
    check("Test reports success against the configured address", True)
    saved = pg.evaluate("JSON.stringify([localStorage.getItem('mse:ai'), ...Object.values(localStorage)])")
    check("the key is never written to local storage", "sk-ant-test-0123456789" not in saved)

    # ---- generate ----------------------------------------------------------------------------------------
    pg.click("[role=tab]:has-text('All')")
    pg.fill("input[type=search]", "slime"); pg.click(".presets button")
    sheet = pg.input_value("label:has-text('Sheet id') input")
    n0 = len(mock.calls)
    pg.click("button:has-text('Generate now')")
    pg.wait_for_function("document.querySelector('.requests')?.innerText.includes('Done')", timeout=30000)
    check("the agent finishes and the request is Done", True)
    calls = mock.calls[n0:]
    check("five model calls, one per turn", len(calls) == 5, str(len(calls)))
    c0 = calls[0]
    check("the key, API version and model are sent", c0["key"] == "sk-ant-test-0123456789" and c0["version"] == "2023-06-01" and c0["model"] == "claude-sonnet-5-5", str({k: c0[k] for k in ("key", "version", "model")}))
    check("the model gets the editor's tools, but not the file-reading one", {"sprite_draw", "sprite_preview", "map_fill", "request_complete"} <= set(c0["tools"]) and "sprite_import" not in c0["tools"], str(c0["tools"][:6]))
    check("the system prompt sets the role", "sprite artist" in c0["system"])
    check("the brief carries the request id", "request_complete" in json.dumps(c0["messages"][0]))
    check("the preview image was sent back to the model", not mock.problems, str(mock.problems))
    im = Image.open(f"{P}/assets/{sheet}.png").convert("RGBA")
    check("the sprite really exists on disk with pixels", im.size == (96, 24) and sum(1 for p in im.getdata() if p[3] > 0) > 100, str(im.size))
    req = read(f"requests/{read('project.json')['requests'][0]}.json")
    check("the request is done and linked to its sheet", req["status"] == "done" and req["resultSheetId"] == sheet, str({k: req.get(k) for k in ("status", "resultSheetId", "note")}))
    log = pg.inner_text(".gen-log")
    check("the progress log shows each tool call", all(t in log for t in ("sprite_create", "sprite_draw", "sprite_preview")), log[:200])
    check("the latest preview is shown", pg.locator("img.gen-preview").count() == 1)
    check("token usage is shown", "tokens" in pg.inner_text("[aria-label='Generation progress']"))
    pg.screenshot(path=f"{S}/create-ai.png")

    # ---- stop --------------------------------------------------------------------------------------------
    pg.fill("input[type=password]", "slow-key"); pg.click("button:has-text('Save key')"); pg.wait_for_selector("text=Key will be used")
    pg.fill("input[type=search]", "chest"); pg.click(".presets button")
    pg.click("button:has-text('Generate now')")
    pg.wait_for_selector("button:has-text('Stop')", timeout=8000)
    pg.click("button:has-text('Stop')")
    pg.wait_for_function("document.querySelector('.requests')?.innerText.includes('Failed')", timeout=10000)
    check("Stop ends the run and marks the request failed with 'Stopped.'", "Stopped." in pg.inner_text(".requests"))
    check("Generate now is available again", pg.locator("button:has-text('Generate now')").is_enabled())

    check("no console errors", not logs, "; ".join(logs[:3]))
    b.close()
mock.stop()
print("\nFAILED:" if errors else "\nALL PASSED", errors); sys.exit(1 if errors else 0)
