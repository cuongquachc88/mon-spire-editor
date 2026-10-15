#!/usr/bin/env python3
"""End-to-end check of the real packaged desktop app (macOS): MCP status controls, Keychain, native HTTP, generation.

STATUS: NOT PASSING YET. The app launches and its MCP endpoint answers, but macOS Accessibility exposes only part of the
web view, so the script cannot reach the "MCP status and setup" button and stops there. Everything after that step
(Restart/Stop/Start, key read from the Keychain, Generate through the native HTTP plugin) is therefore not yet checked
in the packaged app. What is covered elsewhere: Keychain and port-rebind in `cargo test`, and the same UI logic in the
browser suites (`pnpm e2e`). Treat this file as a starting point, not as evidence.

Needs the built app (`pnpm desktop:build`) and Accessibility permission for this terminal.

Safety: it launches its own copy on a private MCP port with a throwaway project, and only *presses* elements of that
process through Accessibility. It never sends raw mouse or keyboard events (those go to whatever window is in front).
Because nothing is typed, the fake API key is put in the Keychain beforehand with the `security` tool, and the app is
pointed at a local stand-in for the API with MSE_API_BASE_URL. The Keychain entry is removed at the end.
"""
import json, os, shutil, signal, subprocess, sys, tempfile, time, urllib.error, urllib.request
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import desktop_ax as ax
from mock_anthropic import Mock
import run

APP = f"{ROOT}/packages/editor/src-tauri/target/release/bundle/macos/Mon Spire Editor.app/Contents/MacOS/mon-spire-editor"
PORT = 17950
KEY = "sk-ant-desktop-test-0123456789"
SERVICE, ACCOUNT = "com.monspire.editor", "mse_anthropic_api_key"
errors = []

def check(n, c, x=""):
    print(("PASS " if c else "FAIL ") + n + (f"  [{x}]" if x and not c else ""), flush=True)
    if not c: errors.append(n)

def keychain():
    r = subprocess.run(["security", "find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None

def rpc(method):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/mcp", data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": {}}).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r: return r.status
    except urllib.error.HTTPError as e: return e.code
    except Exception: return None   # connection refused

def wait_for(pred, seconds=20, every=0.6):
    end = time.time() + seconds
    while time.time() < end:
        try:
            if pred(): return True
        except Exception: pass
        time.sleep(every)
    return False

if sys.platform != "darwin": sys.exit("macOS only")
if not os.path.exists(APP): sys.exit("Build the app first: pnpm desktop:build")
if keychain() is not None: sys.exit(f"A keychain entry {SERVICE}/{ACCOUNT} already exists; refusing to overwrite what may be a real key.")
if rpc("initialize") is not None: sys.exit(f"Port {PORT} is already in use")

tmp = tempfile.mkdtemp(prefix="mse-desktop-"); proj = f"{tmp}/proj"; run.seed(proj)
mock = Mock()
app = None
try:
    # -A: any app may read it, so macOS does not stop to ask for approval (nobody is there to click Allow)
    subprocess.run(["security", "add-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w", KEY, "-A"], check=True, capture_output=True)
    app = subprocess.Popen([APP, "--project", proj], env={**os.environ, "MSE_MCP_PORT": str(PORT), "MSE_API_BASE_URL": mock.url}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ax.set_pid(app.pid)
    check("the app window comes up", wait_for(lambda: ax.has("Projects"), 40))

    # ---- MCP status. The topbar chip is not in the accessibility tree, and the start screen animates (which makes reading
    # the tree very slow), so open the same panel from the Create tab's "MCP status and setup" link.
    ax.click("Create", nth=0)
    ax.click("MCP status and setup")
    check("the status panel says Running and shows the address", wait_for(lambda: ax.has("Running") and ax.has(f"http://127.0.0.1:{PORT}/mcp")), str(ax.texts()[:25]))
    check("the endpoint answers while running", rpc("initialize") == 200)
    ax.click("Restart"); time.sleep(2)
    check("Restart keeps the same port and the endpoint still answers", rpc("initialize") == 200 and ax.has(f"http://127.0.0.1:{PORT}/mcp"))
    ax.click("Stop"); time.sleep(2)
    check("Stop closes the port", rpc("initialize") is None)
    check("the panel reports it stopped", wait_for(lambda: ax.has("Stopped")), str(ax.texts()[:25]))
    ax.click("Start"); time.sleep(2)
    check("Start listens again", rpc("initialize") == 200 and wait_for(lambda: ax.has("Running")))
    ax.click("Close")

    # ---- the key saved in the Keychain is found and used ---------------------------------------------------------------------
    check("the app reads the key from the Keychain (masked in the UI)", wait_for(lambda: ax.has("Key sk-ant-…6789"), 20), str([t for t in ax.texts() if "ey" in t][:6]))
    ax.click("Slime, bounce")
    n0 = len(mock.calls)
    ax.click("Generate now")
    done = wait_for(lambda: os.path.exists(f"{proj}/assets/slime.png") and ax.has("Done"), 90, 1)
    check("Generate now draws the sprite in the desktop app", done, str([t for t in ax.texts() if "Done" in t or "Failed" in t][:6]))
    calls = mock.calls[n0:]
    check("the model got the Keychain key, through the native HTTP plugin", len(calls) >= 4 and all(c["key"] == KEY for c in calls), str(len(calls)))
    check("the editor's tools were offered, without the file-reading one", bool(calls) and "sprite_draw" in calls[0]["tools"] and "sprite_import" not in calls[0]["tools"])
    check("the preview image went back to the model", not mock.problems, str(mock.problems))
    if os.path.exists(f"{proj}/assets/slime.png"):
        im = Image.open(f"{proj}/assets/slime.png").convert("RGBA")
        check("the PNG on disk has the drawn pixels", im.size == (96, 24) and sum(1 for p in im.getdata() if p[3] > 0) > 100, str(im.size))
    reqs = json.load(open(f"{proj}/project.json")).get("requests", [])
    check("the request ended Done", bool(reqs) and json.load(open(f"{proj}/requests/{reqs[0]}.json"))["status"] == "done")
finally:
    if app:
        app.send_signal(signal.SIGTERM)
        try: app.wait(10)
        except Exception: app.kill()
    mock.stop()
    subprocess.run(["security", "delete-generic-password", "-s", SERVICE, "-a", ACCOUNT], capture_output=True)   # never leave a test key behind
    shutil.rmtree(tmp, ignore_errors=True)

print("\nFAILED:" if errors else "\nALL PASSED", errors)
sys.exit(1 if errors else 0)
