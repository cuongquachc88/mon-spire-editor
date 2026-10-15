import { useEffect, useRef } from "react";

const W = 40, H = 24, T = 12; // tiles, and canvas pixels per tile (scaled up with CSS)
const COLORS = ["#2d5bc7", "#3f7be0", "#e6cf8b", "#4aa356", "#3f9450", "#2a6d3d", "#b98b5a", "#d9445a", "#efe3cc", "#7b8094", "#ffd166"];
const [DEEP, WATER, SAND, GRASS, GRASS2, FOREST, PATH, ROOF, WALL, , FLOWER] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const EMPTY = "#1a1736";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function makeScene(): number[] {
  const rand = rng(7);
  const lat = (n: number) => Array.from({ length: n }, () => rand());
  const A = lat(256), B = lat(256);
  const smooth = (g: number[], x: number, y: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const v = (i: number, j: number) => g[((i & 15) * 16 + (j & 15)) % g.length]!;
    const s = (t: number) => t * t * (3 - 2 * t);
    const top = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * s(fx);
    const bot = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * s(fx);
    return top + (bot - top) * s(fy);
  };
  const cells: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2);
      const e = smooth(A, x / 7, y / 7) * 0.65 + smooth(B, x / 3, y / 3) * 0.2 + 0.3 - (dx * dx + dy * dy) * 0.55;
      let c = e < 0.2 ? DEEP : e < 0.3 ? WATER : e < 0.36 ? SAND : GRASS;
      if (c === GRASS) {
        if (smooth(B, x / 4 + 9, y / 4 + 3) > 0.66) c = FOREST;
        else if ((x * 7 + y * 13) % 5 === 0) c = GRASS2;
        else if (rand() < 0.03) c = FLOWER;
      }
      cells.push(c);
    }
  // a path winding across the middle, then two small houses beside it
  const set = (x: number, y: number, c: number) => x >= 0 && y >= 0 && x < W && y < H && (cells[y * W + x] = c);
  for (let x = 4; x < W - 4; x++) {
    const y = Math.round(H / 2 + Math.sin(x / 4.5) * 2.2);
    if (cells[y * W + x] !== DEEP && cells[y * W + x] !== WATER) set(x, y, PATH);
  }
  for (const [hx, hy] of [[13, 6], [24, 15]] as const) {
    for (let i = 0; i < 4; i++) {
      set(hx + i, hy, ROOF);
      set(hx + i, hy + 1, ROOF);
      set(hx + i, hy + 2, WALL);
    }
    set(hx + 1, hy + 2, PATH);
  }
  return cells;
}

interface Step { who: "you" | "claude"; cells: number[]; start: number; dur: number; tool: string }

function makeSchedule(scene: number[]) {
  const rand = rng(21);
  const CW = 8, CH = 8;
  const chunks: { x: number; y: number }[] = [];
  for (let cy = 0; cy < H / CH; cy++) for (let cx = 0; cx < W / CW; cx++) chunks.push({ x: cx * CW, y: cy * CH });
  for (let i = chunks.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [chunks[i], chunks[j]] = [chunks[j]!, chunks[i]!];
  }
  const steps: Step[] = [];
  let t = 600;
  chunks.forEach((c, i) => {
    const who = i % 2 === 0 ? "you" : "claude";
    const idx: number[] = [];
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) idx.push((c.y + y) * W + c.x + x);
    // you: a snake of single strokes; claude: one diagonal sweep, like a batched fill
    const ordered = who === "you"
      ? idx.map((v, k) => ({ v, k: Math.floor(k / CW) % 2 ? Math.floor(k / CW) * CW + (CW - 1 - (k % CW)) : k })).sort((a, b) => a.k - b.k).map((o) => o.v)
      : [...idx].sort((a, b) => ((a % W) + Math.floor(a / W)) - ((b % W) + Math.floor(b / W)));
    const dur = who === "you" ? 780 : 460;
    steps.push({ who, cells: ordered, start: t, dur, tool: ["map_fill", "map_set_tiles"][i % 2 === 0 ? 0 : 1]! });
    t += dur + 140;
  });
  return { steps, total: t, scene };
}

/** A map that paints itself while two cursors work on it: you (blue) and Claude through MCP (coral). */
export function HeroScene({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const youEl = useRef<HTMLDivElement>(null);
  const aiEl = useRef<HTMLDivElement>(null);
  const aiLabel = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext("2d")!;
    const { steps, total, scene } = makeSchedule(makeScene());
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const HOLD = 4500, FADE = 700, LOOP = total + HOLD + FADE;

    const draw = (t: number) => {
      const shown = new Uint8Array(W * H);
      const last: Record<string, { x: number; y: number; active: boolean } | undefined> = {};
      for (const s of steps) {
        const p = reduce ? 1 : Math.max(0, Math.min(1, (t - s.start) / s.dur));
        const n = Math.floor(p * s.cells.length);
        for (let k = 0; k < n; k++) shown[s.cells[k]!] = 1;
        if (p > 0) {
          const i = s.cells[Math.max(0, Math.min(s.cells.length - 1, n - (p < 1 ? 0 : 1)))]!;
          last[s.who] = { x: i % W, y: Math.floor(i / W), active: p < 1 };
          if (s.who === "claude" && aiLabel.current && p < 1 && aiLabel.current.textContent !== s.tool) aiLabel.current.textContent = s.tool;
        }
      }
      const fade = t > total + HOLD ? 1 - (t - total - HOLD) / FADE : 1;
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (let i = 0; i < scene.length; i++) {
        const x = (i % W) * T, y = Math.floor(i / W) * T;
        ctx.fillStyle = shown[i] ? COLORS[scene[i]!]! : EMPTY;
        ctx.globalAlpha = shown[i] ? fade : 1;
        ctx.fillRect(x, y, T, T);
        if (!shown[i] && (i + Math.floor(i / W)) % 2 === 0) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#201d42";
          ctx.fillRect(x, y, T, T);
        }
      }
      ctx.globalAlpha = 1;
      const place = (el: HTMLDivElement | null, c?: { x: number; y: number; active: boolean }) => {
        if (!el) return;
        el.style.opacity = !c || reduce ? "0" : c.active ? "1" : "0.45";
        if (c) el.style.transform = `translate(${((c.x + 0.5) / W) * 100}cqw, ${((c.y + 0.5) / H) * 100}cqh)`;
      };
      place(youEl.current, last.you);
      place(aiEl.current, last.claude);
    };

    if (reduce) return void draw(Infinity);
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      draw((now - t0) % LOOP);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={`hero-scene ${className ?? ""}`} role="img" aria-label="A pixel map being painted by you and by Claude at the same time">
      <canvas ref={canvas} width={W * T} height={H * T} />
      <div className="cursor you" ref={youEl}><i /><span>You</span></div>
      <div className="cursor ai" ref={aiEl}><i /><span>Claude <b ref={aiLabel}>map_fill</b></span></div>
    </div>
  );
}
