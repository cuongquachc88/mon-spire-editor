/** Zoom steps for the buttons and the wheel; below 1 the image is shown smaller than its pixel size. */
export const ZOOM_LEVELS = [0.125, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
/** Browsers fail on very large canvases, so the zoomed image is kept under this many pixels per side. */
export const MAX_CANVAS = 8192;

export const zoomLabel = (z: number) => (z >= 1 ? `${+z.toFixed(1)}×` : `${Math.round(z * 100)}%`);

export const maxZoomFor = (w: number, h: number) => Math.max(1, Math.min(64, MAX_CANVAS / Math.max(w, h)));

/** Largest zoom that shows the whole image in an area of aw × ah (whole numbers once it is 1× or more). */
export function fitZoom(w: number, h: number, aw: number, ah: number): number {
  const f = Math.min(Math.max(64, aw) / w, Math.max(64, ah) / h, maxZoomFor(w, h));
  return f >= 1 ? Math.floor(f) : Math.max(0.125, Math.floor(f * 100) / 100);
}

/** The next zoom step in a direction, or undefined at the end of the range. */
export function nextZoom(zoom: number, dir: 1 | -1, w: number, h: number): number | undefined {
  const levels = ZOOM_LEVELS.filter((l) => l <= maxZoomFor(w, h));
  return dir > 0 ? levels.find((l) => l > zoom + 1e-6) : [...levels].reverse().find((l) => l < zoom - 1e-6);
}

/** Index of the zoom step closest to `zoom` (for the slider). */
export const nearestLevel = (zoom: number) =>
  ZOOM_LEVELS.reduce((best, l, i) => (Math.abs(l - zoom) < Math.abs(ZOOM_LEVELS[best]! - zoom) ? i : best), 0);
