import type { Frame } from "./schema";

export interface GridSliceOptions {
  imageWidth: number;
  imageHeight: number;
  frameWidth: number;
  frameHeight: number;
  margin?: number;
  spacing?: number;
  /** Frames get id `${idPrefix}_${n}` and name `${namePrefix}_${n}`, numbered row-major from 0. */
  idPrefix: string;
  namePrefix?: string;
}

export function sliceGrid(o: GridSliceOptions): Frame[] {
  const margin = o.margin ?? 0;
  const spacing = o.spacing ?? 0;
  const cols = Math.floor((o.imageWidth - 2 * margin + spacing) / (o.frameWidth + spacing));
  const rows = Math.floor((o.imageHeight - 2 * margin + spacing) / (o.frameHeight + spacing));
  const frames: Frame[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const n = r * cols + c;
      frames.push({
        id: `${o.idPrefix}_${n}`,
        name: `${o.namePrefix ?? o.idPrefix}_${n}`,
        rect: {
          x: margin + c * (o.frameWidth + spacing),
          y: margin + r * (o.frameHeight + spacing),
          w: o.frameWidth,
          h: o.frameHeight,
        },
        pivot: { x: 0.5, y: 0.5 },
      });
    }
  }
  return frames;
}
