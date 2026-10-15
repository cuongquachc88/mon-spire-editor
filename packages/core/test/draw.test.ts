import { describe, expect, it } from "vitest";
import { History, SetPixelsCommand, createImage, floodCells, lineCells, rectCells, rgba, unpack } from "../src";

describe("shapes", () => {
  it("draws a diagonal and a steep line including both ends", () => {
    expect(lineCells({ x: 0, y: 0 }, { x: 3, y: 3 })).toHaveLength(4);
    const steep = lineCells({ x: 0, y: 0 }, { x: 1, y: 4 });
    expect(steep[0]).toEqual({ x: 0, y: 0 });
    expect(steep[steep.length - 1]).toEqual({ x: 1, y: 4 });
    expect(steep).toHaveLength(5);
  });
  it("outlines vs fills a rectangle regardless of corner order", () => {
    expect(rectCells({ x: 2, y: 2 }, { x: 0, y: 0 }, true)).toHaveLength(9);
    expect(rectCells({ x: 2, y: 2 }, { x: 0, y: 0 }, false)).toHaveLength(8);
  });
  it("round-trips packed color", () => {
    expect(unpack(rgba(10, 20, 30, 40))).toEqual({ r: 10, g: 20, b: 30, a: 40 });
  });
});

describe("floodCells", () => {
  it("fills only the connected region", () => {
    // 3x3, wall column in the middle
    const g = [0, 1, 0, 0, 1, 0, 0, 1, 0];
    expect(floodCells(3, 3, (i) => g[i]!, { x: 0, y: 0 }).sort()).toEqual([0, 3, 6]);
  });
  it("returns nothing for an off-grid start", () => {
    expect(floodCells(3, 3, () => 0, { x: 9, y: 0 })).toEqual([]);
  });
});

describe("SetPixelsCommand", () => {
  it("merges one stroke into a single undo step and restores the original", () => {
    const img = createImage(4, 1);
    const h = new History(img);
    h.execute(new SetPixelsCommand("pencil", [{ index: 0, value: 5 }], "stroke1"));
    h.execute(new SetPixelsCommand("pencil", [{ index: 0, value: 7 }, { index: 1, value: 7 }], "stroke1"));
    expect([...img.data]).toEqual([7, 7, 0, 0]);
    h.undo();
    expect([...img.data]).toEqual([0, 0, 0, 0]);
    expect(h.canUndo).toBe(false);
    h.redo();
    expect([...img.data]).toEqual([7, 7, 0, 0]);
  });
  it("does not merge different strokes", () => {
    const img = createImage(2, 1);
    const h = new History(img);
    h.execute(new SetPixelsCommand("p", [{ index: 0, value: 1 }], "a"));
    h.execute(new SetPixelsCommand("p", [{ index: 1, value: 1 }], "b"));
    h.undo();
    expect([...img.data]).toEqual([1, 0]);
  });
});
