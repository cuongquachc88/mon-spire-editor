import { describe, expect, it } from "vitest";
import { applyDrawOps, createImage, formatColor, imageToRows, parseColor, rgba } from "../src";

const rowsOf = (img: ReturnType<typeof createImage>) => imageToRows(img).rows;

describe("parseColor", () => {
  it("accepts short, long, alpha and transparent forms", () => {
    expect(parseColor("#f00")).toBe(rgba(255, 0, 0));
    expect(parseColor("#00ff0080")).toBe(rgba(0, 255, 0, 128));
    expect(parseColor("transparent")).toBe(0);
    expect(formatColor(parseColor("#12ab34"))).toBe("#12ab34");
  });
  it("rejects garbage with a helpful message", () => {
    expect(() => parseColor("red")).toThrow('Bad color "red"');
  });
});

describe("applyDrawOps", () => {
  it("draws rect, line and pixels, clipping off-canvas cells", () => {
    const img = createImage(5, 3);
    const n = applyDrawOps(img, [
      { op: "rect", x: 0, y: 0, w: 2, h: 2, color: "#f00" },
      { op: "line", x1: 4, y1: 0, x2: 4, y2: 9, color: "#0f0" },
      { op: "pixels", points: [{ x: -1, y: 0 }, { x: 2, y: 2 }], color: "#00f" },
    ]);
    expect(rowsOf(img)).toEqual(["aa..b", "aa..b", "..c.b"]);
    expect(n).toBe(4 + 3 + 1);
  });

  it("draws a symmetric filled ellipse and an outline with a hollow middle", () => {
    const filled = createImage(9, 9);
    applyDrawOps(filled, [{ op: "ellipse", cx: 4.5, cy: 4.5, rx: 4, ry: 4, color: "#fff" }]);
    const r = rowsOf(filled);
    expect(r.map((x) => x.split("").reverse().join(""))).toEqual(r); // mirrored left-right
    expect([...r].reverse()).toEqual(r); // and top-bottom
    expect(r[4]).toBe("aaaaaaaaa");

    const ring = createImage(9, 9);
    applyDrawOps(ring, [{ op: "ellipse", cx: 4.5, cy: 4.5, rx: 4, ry: 4, color: "#fff", filled: false }]);
    expect(rowsOf(ring)[4]![4]).toBe("."); // hollow centre
    expect(rowsOf(ring)[4]![0]).toBe("a");
  });

  it("flood fills only the connected region", () => {
    const img = createImage(3, 3);
    applyDrawOps(img, [
      { op: "line", x1: 1, y1: 0, x2: 1, y2: 2, color: "#000" },
      { op: "fill", x: 0, y: 0, color: "#f00" },
    ]);
    // red fills the left column only; the black wall blocks the transparent right column
    expect(rowsOf(img)).toEqual(["ab.", "ab.", "ab."]);
  });

  it("paints ASCII rows through a legend, skipping unknown characters", () => {
    const img = createImage(4, 2);
    applyDrawOps(img, [{ op: "rows", x: 1, y: 0, rows: ["g.r", "?gg"], legend: { g: "#0a0", r: "#a00" } }]);
    expect(imageToRows(img)).toEqual({
      rows: [".a.b", "..aa"],
      legend: { ".": "transparent", a: "#00aa00", b: "#aa0000" },
      colorCount: 2,
    });
  });

  it("rejects a multi-character legend key", () => {
    expect(() => applyDrawOps(createImage(2, 2), [{ op: "rows", x: 0, y: 0, rows: ["ab"], legend: { ab: "#fff" } }])).toThrow("single character");
  });

  it("clear empties the image and reports changed pixels", () => {
    const img = createImage(2, 2);
    applyDrawOps(img, [{ op: "rect", x: 0, y: 0, w: 2, h: 1, color: "#fff" }]);
    expect(applyDrawOps(img, [{ op: "clear" }])).toBe(2);
  });
});
