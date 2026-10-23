import { describe, expect, it } from "vitest";
import { MAX_CANVAS, ZOOM_LEVELS, fitZoom, maxZoomFor, nearestLevel, nextZoom, zoomLabel } from "./zoom";

describe("zoom", () => {
  it("labels zooms as × at 1 and above, % below", () => {
    expect(zoomLabel(16)).toBe("16×");
    expect(zoomLabel(1)).toBe("1×");
    expect(zoomLabel(0.5)).toBe("50%");
    expect(zoomLabel(0.125)).toBe("13%");
  });

  it("keeps the zoomed canvas within the canvas limit", () => {
    expect(maxZoomFor(16, 16)).toBe(64);
    expect(maxZoomFor(512, 512)).toBe(MAX_CANVAS / 512);
    expect(maxZoomFor(100000, 10)).toBe(1);
  });

  it("fits whole numbers at 1× and above, fractions below", () => {
    expect(fitZoom(16, 16, 640, 640)).toBe(40);
    expect(fitZoom(256, 256, 700, 700)).toBe(2);
    expect(fitZoom(1024, 1024, 700, 700)).toBe(0.68);
    expect(fitZoom(4000, 4000, 700, 700)).toBe(0.17);
    expect(fitZoom(8000, 8000, 700, 700)).toBe(0.125);
  });

  it("fits by the tighter side and respects the cap", () => {
    expect(fitZoom(100, 10, 600, 600)).toBe(6);
    expect(fitZoom(2, 2, 10000, 10000)).toBe(64);
    expect(fitZoom(512, 512, 10000, 10000)).toBe(16);
  });

  it("steps through the levels and stops at the ends", () => {
    expect(nextZoom(1, 1, 16, 16)).toBe(2);
    expect(nextZoom(1, -1, 16, 16)).toBe(0.5);
    expect(nextZoom(5, 1, 16, 16)).toBe(6);
    expect(nextZoom(5, -1, 16, 16)).toBe(4);
    expect(nextZoom(0.125, -1, 16, 16)).toBeUndefined();
    expect(nextZoom(64, 1, 16, 16)).toBeUndefined();
  });

  it("does not step beyond what a large image allows", () => {
    expect(nextZoom(12, 1, 512, 512)).toBe(16);
    expect(nextZoom(16, 1, 512, 512)).toBeUndefined();
  });

  it("maps a zoom to the nearest slider step", () => {
    expect(ZOOM_LEVELS[nearestLevel(5)]).toBe(4);
    expect(ZOOM_LEVELS[nearestLevel(0.6)]).toBe(0.5);
    expect(nearestLevel(1000)).toBe(ZOOM_LEVELS.length - 1);
  });
});
