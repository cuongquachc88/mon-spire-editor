import { floodCells, lineCells, rectCells, rgba, unpack, type PixelImage, type Point } from "./draw";

/** A drawing instruction that can be written as plain JSON, so an AI agent can batch many of them. */
export type DrawOp =
  | { op: "clear" }
  | { op: "pixels"; points: Point[]; color: string }
  | { op: "rect"; x: number; y: number; w: number; h: number; color: string; filled?: boolean }
  | { op: "line"; x1: number; y1: number; x2: number; y2: number; color: string }
  | { op: "ellipse"; cx: number; cy: number; rx: number; ry: number; color: string; filled?: boolean }
  | { op: "fill"; x: number; y: number; color: string }
  /**
   * Copy a region onto another place in the same image (the source is snapshotted first, so overlaps are safe).
   * `rowShift[i]` moves source row i sideways by that many pixels (shear/sway); the result is clipped to the
   * destination rectangle. The destination rectangle is cleared first unless `keepDest` is true.
   */
  | { op: "copy"; x: number; y: number; w: number; h: number; dx: number; dy: number; rowShift?: number[]; flipX?: boolean; flipY?: boolean; keepDest?: boolean }
  /** ASCII art: each character of each row is looked up in `legend`; unknown characters are skipped (transparent paint-through). */
  | { op: "rows"; x: number; y: number; rows: string[]; legend: Record<string, string> };

/** "#rgb", "#rrggbb", "#rrggbbaa" or "transparent" -> packed RGBA. */
export function parseColor(input: string): number {
  const s = input.trim().toLowerCase();
  if (s === "transparent" || s === "none") return 0;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (!m) throw new Error(`Bad color "${input}": use #rgb, #rrggbb, #rrggbbaa or "transparent"`);
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return rgba(n(0), n(2), n(4), h.length === 8 ? n(6) : 255);
}

export function formatColor(c: number): string {
  const { r, g, b, a } = unpack(c);
  const hex = (v: number) => v.toString(16).padStart(2, "0");
  return a === 0 ? "transparent" : `#${hex(r)}${hex(g)}${hex(b)}${a === 255 ? "" : hex(a)}`;
}

function ellipseCells(cx: number, cy: number, rx: number, ry: number, filled: boolean): Point[] {
  const inside = (x: number, y: number, a: number, b: number) =>
    a > 0 && b > 0 && ((x - cx) / a) ** 2 + ((y - cy) / b) ** 2 <= 1;
  const out: Point[] = [];
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      // +0.5 samples the pixel centre so a radius of N gives a symmetric 2N-ish wide shape.
      const px = x + 0.5, py = y + 0.5;
      if (!inside(px, py, rx, ry)) continue;
      if (!filled && inside(px, py, rx - 1, ry - 1)) continue;
      out.push({ x, y });
    }
  return out;
}

/** Apply ops in order, mutating `img`. Off-canvas cells are ignored. Returns how many pixels changed. */
export function applyDrawOps(img: PixelImage, ops: DrawOp[]): number {
  let changed = 0;
  const put = (p: Point, c: number) => {
    if (p.x < 0 || p.y < 0 || p.x >= img.width || p.y >= img.height) return;
    const i = p.y * img.width + p.x;
    if (img.data[i] !== c) {
      img.data[i] = c;
      changed++;
    }
  };
  for (const op of ops) {
    switch (op.op) {
      case "clear":
        for (let i = 0; i < img.data.length; i++) if (img.data[i] !== 0) (img.data[i] = 0, changed++);
        break;
      case "pixels": {
        const c = parseColor(op.color);
        op.points.forEach((p) => put(p, c));
        break;
      }
      case "rect": {
        const c = parseColor(op.color);
        rectCells({ x: op.x, y: op.y }, { x: op.x + op.w - 1, y: op.y + op.h - 1 }, op.filled ?? true).forEach((p) => put(p, c));
        break;
      }
      case "line": {
        const c = parseColor(op.color);
        lineCells({ x: op.x1, y: op.y1 }, { x: op.x2, y: op.y2 }).forEach((p) => put(p, c));
        break;
      }
      case "ellipse": {
        const c = parseColor(op.color);
        ellipseCells(op.cx, op.cy, op.rx, op.ry, op.filled ?? true).forEach((p) => put(p, c));
        break;
      }
      case "fill": {
        const c = parseColor(op.color);
        floodCells(img.width, img.height, (i) => img.data[i]!, { x: op.x, y: op.y }).forEach((i) =>
          put({ x: i % img.width, y: Math.floor(i / img.width) }, c),
        );
        break;
      }
      case "copy": {
        const snap = new Uint32Array(op.w * op.h);
        for (let yy = 0; yy < op.h; yy++)
          for (let xx = 0; xx < op.w; xx++) {
            const sx = op.x + xx, sy = op.y + yy;
            snap[yy * op.w + xx] = sx >= 0 && sy >= 0 && sx < img.width && sy < img.height ? img.data[sy * img.width + sx]! : 0;
          }
        if (!op.keepDest) for (let yy = 0; yy < op.h; yy++) for (let xx = 0; xx < op.w; xx++) put({ x: op.dx + xx, y: op.dy + yy }, 0);
        for (let yy = 0; yy < op.h; yy++) {
          const shift = Math.round(op.rowShift?.[yy] ?? 0);
          const destY = op.dy + (op.flipY ? op.h - 1 - yy : yy);
          for (let xx = 0; xx < op.w; xx++) {
            const c = snap[yy * op.w + xx]!;
            const tx = (op.flipX ? op.w - 1 - xx : xx) + shift;
            if (c !== 0 && tx >= 0 && tx < op.w) put({ x: op.dx + tx, y: destY }, c); // clipped to the destination rectangle
          }
        }
        break;
      }
      case "rows": {
        const colors = new Map(Object.entries(op.legend).map(([ch, col]) => [ch, parseColor(col)]));
        for (const [ch] of colors) if ([...ch].length !== 1) throw new Error(`Legend key "${ch}" must be a single character`);
        op.rows.forEach((row, dy) => [...row].forEach((ch, dx) => colors.has(ch) && put({ x: op.x + dx, y: op.y + dy }, colors.get(ch)!)));
        break;
      }
    }
  }
  return changed;
}

/**
 * Describe an image as ASCII rows plus a legend, so a model can "see" pixels as text.
 * Transparent is '.'; other colors get letters/digits in order of first appearance.
 */
export function imageToRows(img: PixelImage, region?: { x: number; y: number; w: number; h: number }) {
  const r = region ?? { x: 0, y: 0, w: img.width, h: img.height };
  const symbols = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const legend: Record<string, string> = { ".": "transparent" };
  const bySymbol = new Map<number, string>();
  const rows: string[] = [];
  for (let y = r.y; y < Math.min(img.height, r.y + r.h); y++) {
    let row = "";
    for (let x = r.x; x < Math.min(img.width, r.x + r.w); x++) {
      const c = img.data[y * img.width + x]!;
      if (unpack(c).a === 0) {
        row += ".";
        continue;
      }
      let s = bySymbol.get(c);
      if (!s) {
        s = symbols[bySymbol.size] ?? "?"; // >62 colors: remaining ones share '?'
        bySymbol.set(c, s);
        if (s !== "?") legend[s] = formatColor(c);
      }
      row += s;
    }
    rows.push(row);
  }
  return { rows, legend, colorCount: bySymbol.size };
}
