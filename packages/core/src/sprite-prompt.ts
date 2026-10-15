import type { SpriteSpec } from "./schema";

const KIND: Record<SpriteSpec["kind"], string> = {
  character: "a character",
  creature: "a creature or monster",
  item: "an inventory item",
  prop: "a world prop",
  tile: "a seamless tile",
  tree: "a tree or plant",
  ui: "a UI icon",
};
const STYLE: Record<SpriteSpec["style"], string> = {
  nes: "8-bit NES look: few colours, hard edges, no anti-aliasing",
  gameboy: "Game Boy look: four shades of one green hue only",
  snes: "16-bit SNES look: rich but limited palette, clean pixels, no anti-aliasing",
  modern: "modern pixel art: soft colour ramps, selective anti-aliasing allowed",
};
const VIEW: Record<SpriteSpec["view"], string> = {
  side: "side view",
  front: "front view",
  "three-quarter": "three-quarter view (slightly from above)",
  "top-down": "top-down view",
};
const SHADING: Record<SpriteSpec["shading"], string> = {
  flat: "flat colour, no shading",
  cel: "cel shading: one lit tone, one base tone, one shadow tone per material",
  dither: "shading with checkerboard dithering between tones",
};
const OUTLINE: Record<SpriteSpec["outline"], string> = {
  none: "no outline",
  dark: "a 1px dark outline around the silhouette",
  colored: "a 1px outline that is a darker shade of each material, not black",
};

/**
 * Turn a sprite request into instructions for an AI that has this editor's MCP tools.
 * Pure text: it is shown to the user, can be copied, or is stored with a queued request.
 */
export function buildSpritePrompt(spec: SpriteSpec): string {
  const multi = spec.frames > 1;
  const sheetW = spec.width * spec.frames;
  const palette = spec.palette.length
    ? `Use exactly this palette (add nothing else): ${spec.palette.join(", ")}.`
    : `Use at most ${spec.colors} colours in total; pick them as a few small ramps, not ${spec.colors} unrelated hues.`;

  const lines = [
    `Draw ${KIND[spec.kind]}: ${spec.subject.trim()}`,
    "",
    "Requirements",
    `- Size: ${spec.width}x${spec.height} pixels${multi ? ` per frame, ${spec.frames} frames side by side (${sheetW}x${spec.height} sheet)` : ""}.`,
    `- Style: ${STYLE[spec.style]}.`,
    `- ${palette}`,
    `- ${OUTLINE[spec.outline]}; ${SHADING[spec.shading]}; light comes from the ${spec.light}.`,
    `- ${VIEW[spec.view][0]!.toUpperCase()}${VIEW[spec.view].slice(1)}. Transparent background. Keep the subject centred with about 1px of padding.`,
  ];
  if (multi) lines.push(`- Animation: ${spec.motion.trim() || "a short, readable loop"}. Frame 0 is the rest pose; change only what moves so the loop does not jitter.`);
  if (spec.notes.trim()) lines.push(`- Also: ${spec.notes.trim()}`);

  lines.push(
    "",
    "How to do it with the editor's tools",
    `1. sprite_create id "${spec.sheetId}" width ${sheetW} height ${spec.height}.`,
    "2. sprite_draw in batches: big shapes first (silhouette, main colours), then shading, then small details. The `rows` op (ASCII art + legend) is best for fine detail.",
    "3. sprite_preview, look at it critically (silhouette readable? lighting consistent? stray pixels?), then fix with more sprite_draw calls. Repeat until it is good; do not stop at the first draft.",
  );
  let step = 4;
  if (multi) {
    lines.push(
      `${step++}. Build frames 1..${spec.frames - 1} from frame 0 with sprite_draw \`copy\` (dx = frame × ${spec.width}); use rowShift for sways and flipX for mirrored poses; then redraw what is different.`,
      `${step++}. sprite_slice with frameWidth ${spec.width} and frameHeight ${spec.height}, then animation_create id "${spec.sheetId}" with all frames in order (about ${Math.max(4, Math.min(12, spec.frames * 2))} fps).`,
    );
  }
  lines.push(`${step}. project_validate, then request_complete (if this came from a queued request) with sheetId "${spec.sheetId}" and a one-line note.`);
  return lines.join("\n");
}

/** A sensible default sheet id from free text: "Red slime!" -> "red-slime". */
export function slugify(text: string, fallback = "sprite"): string {
  const s = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  return s || fallback;
}
