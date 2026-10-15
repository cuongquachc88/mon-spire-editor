import type { SVGProps } from "react";

// 24px grid, 1.75 stroke. Kept inline so the desktop app needs no extra assets.
const PATHS = {
  assets: "M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v6H4zM13 14h7v6h-7z",
  pixel: "M4 20l1-4L16 5l3 3L8 19zM14 7l3 3",
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
  home: "M4 11l8-7 8 7M6 10v9h12v-9M10 19v-5h4v5",
  plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
  pencil: "M4 20l1-4L16 5l3 3L8 19zM14 7l3 3",
  eraser: "M4 16l9-9 6 6-6 6H8zM9 12l6 6M12 19h8",
  line: "M5 19L19 5",
  rect: "M5 6h14v12H5z",
  fill: "M6 11l6-6 7 7-6 6zM5 11h14M19 15c1 1.5 1.5 2.5 1.5 3.5a1.5 1.5 0 0 1-3 0c0-1 .5-2 1.5-3.5z",
  picker: "M14 6l4 4M12 8l4 4-8 8H4v-4zM15 5l1.5-1.5a2 2 0 0 1 3 3L18 8",
  entity: "M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10zM12 8.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  undo: "M9 8L5 12l4 4M5 12h9a5 5 0 0 1 0 10h-2",
  redo: "M15 8l4 4-4 4M19 12h-9a5 5 0 0 0 0 10h2",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  copy: "M9 9h10v11H9zM5 15V4h10",
  close: "M6 6l12 12M18 6L6 18",
  export: "M12 4v11M8 8l4-4 4 4M5 15v4h14v-4",
  check: "M5 12.5l4.5 4.5L19 7.5",
  terrain: "M3 19l6-11 4 7 3-4 5 8zM15 6a1.5 1.5 0 1 0 0 .01",
  mirror: "M12 4v16M8 8l-4 4 4 4M16 8l4 4-4 4",
  flipv: "M4 12h16M8 8l4-4 4 4M8 16l4 4 4-4",
  grid: "M4 4h16v16H4zM4 12h16M12 4v16",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The product mark: a 3x3 pixel tower, so it reads as both "spire" and "sprite". */
export function Mark({ size = 28 }: { size?: number }) {
  const px = (x: number, y: number, c: string) => <rect key={`${x}${y}`} x={x * 8} y={y * 8} width={8} height={8} fill={c} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" shapeRendering="crispEdges">
      {px(1, 0, "#5aa9ff")}
      {px(1, 1, "#8fc6ff")}
      {px(0, 2, "#ff7a6b")}
      {px(1, 2, "#8fc6ff")}
      {px(2, 2, "#ff7a6b")}
    </svg>
  );
}
