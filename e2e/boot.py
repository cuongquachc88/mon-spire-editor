"""The production bundle must start. A crash while loading modules leaves a blank window, so check it mounts."""
import os, sys, time
from playwright.sync_api import sync_playwright

errors = []
def check(n, c, x=""):
    print(("PASS " if c else "FAIL ") + n + (f"  [{x}]" if x and not c else ""))
    if not c: errors.append(n)

with sync_playwright() as pw:
    b = pw.chromium.launch(channel="chrome", headless=True)
    pg = b.new_page(viewport={"width": 1200, "height": 760}); problems = []
    pg.on("pageerror", lambda e: problems.append(str(e)))
    pg.goto("http://127.0.0.1:5173/"); time.sleep(2)
    check("no uncaught errors while loading the bundle", not problems, "; ".join(problems[:2]))
    check("the app mounted something (not a blank window)", pg.evaluate("document.getElementById('root').children.length") > 0)
    # `vite preview` has no project API, so the app should say so instead of showing nothing
    check("a missing project is explained, not blank", len(pg.inner_text("body").strip()) > 0, pg.inner_text("body")[:80])
    b.close()
print("\nFAILED:" if errors else "\nALL PASSED", errors); sys.exit(1 if errors else 0)
