#!/usr/bin/env python3
"""Runs the browser e2e suites against a throwaway project.

Needs: Python 3 with `playwright` and `Pillow`, Google Chrome (driven via channel="chrome"), pnpm deps installed.
Each suite gets a freshly seeded project and its own dev server, so suites cannot affect each other.
Screenshots land in e2e/out/ (git-ignored).
"""
import json, os, shutil, signal, socket, subprocess, sys, tempfile, time
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, "out")
SUITES = ["boot.py", "editor_basics.py", "mcp_and_assets.py", "features.py"]
PREVIEW_SUITES = {"boot.py"}  # run against the production bundle (`vite preview`), not the dev server
PORT = 5173  # vite.config.ts uses strictPort

def seed(proj):
    """4 solid 16px tiles (grass, wall, water, sand), sliced, with a tileset."""
    os.makedirs(f"{proj}/assets"); os.makedirs(f"{proj}/sheets"); os.makedirs(f"{proj}/tilesets")
    cols = [(60, 160, 60), (110, 110, 120), (40, 90, 200), (220, 200, 120)]
    im = Image.new("RGBA", (64, 16))
    for x in range(64):
        for y in range(16):
            c = cols[x // 16]; edge = x % 16 == 0 or y == 0
            im.putpixel((x, y), tuple(int(v * 0.7) for v in c) + (255,) if edge else c + (255,))
    im.save(f"{proj}/assets/terrain.png")
    frames = [{"id": f"terrain_{n}", "name": f"terrain_{n}", "rect": {"x": n * 16, "y": 0, "w": 16, "h": 16}, "pivot": {"x": 0.5, "y": 0.5}} for n in range(4)]
    w = lambda p, d: json.dump(d, open(f"{proj}/{p}", "w"), indent=2)
    w("project.json", {"version": 1, "name": "scratch", "tileSize": 16, "sheets": ["terrain"], "animations": [], "tilesets": ["ground"], "maps": []})
    w("sheets/terrain.json", {"id": "terrain", "image": "assets/terrain.png", "frameWidth": 16, "frameHeight": 16, "margin": 0, "spacing": 0, "frames": frames})
    w("tilesets/ground.json", {"id": "ground", "name": "Ground", "sheetId": "terrain",
        "tiles": [{"frameId": f"terrain_{n}", "collision": n in (1, 2), "tags": []} for n in range(4)]})

def port_free():
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", PORT)) != 0

def wait_up(timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        if not port_free(): return True
        time.sleep(0.2)
    return False

def run_suite(name):
    tmp = tempfile.mkdtemp(prefix="mse-e2e-")
    proj = f"{tmp}/proj"; seed(proj)
    env = {**os.environ, "MSE_PROJECT": proj, "MSE_E2E_PROJ": proj, "MSE_E2E_OUT": OUT}
    cmd = ["pnpm", "exec", "vite", "preview" if name in PREVIEW_SUITES else "--host", *(["--host", "127.0.0.1", "--port", str(PORT), "--strictPort"] if name in PREVIEW_SUITES else ["127.0.0.1"])]
    vite = subprocess.Popen(cmd, cwd=f"{ROOT}/packages/editor", env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        if not wait_up(): print(f"[{name}] dev server did not start"); return False
        print(f"\n=== {name} ===", flush=True)
        return subprocess.run([sys.executable, f"{HERE}/{name}"], env=env).returncode == 0
    finally:
        os.killpg(vite.pid, signal.SIGTERM)
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    if not port_free(): sys.exit(f"Port {PORT} is already in use; stop the running dev server first.")
    shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
    # the boot suite tests the real production bundle, so build it first
    if subprocess.run(["pnpm", "--filter", "@mse/editor", "build"], cwd=ROOT, stdout=subprocess.DEVNULL).returncode != 0:
        sys.exit("editor build failed")
    results = {s: run_suite(s) for s in SUITES}
    print("\n" + "\n".join(f"{'PASS' if ok else 'FAIL'}  {s}" for s, ok in results.items()))
    sys.exit(0 if all(results.values()) else 1)
