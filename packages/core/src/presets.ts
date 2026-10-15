import type { SpriteSpec } from "./schema";

/** The parts of a sprite request a preset may set. Everything else keeps the user's current value. */
export type SpecPatch = Partial<Pick<SpriteSpec, "subject" | "kind" | "width" | "height" | "frames" | "motion" | "view" | "notes" | "style" | "colors" | "palette" | "outline" | "shading" | "light">>;

export interface SubjectPreset {
  id: string;
  label: string;
  category: SubjectCategory;
  spec: SpecPatch;
}

export const SUBJECT_CATEGORIES = ["Characters", "Creatures", "Items", "Props", "Nature", "Tiles", "Effects", "UI"] as const;
export type SubjectCategory = (typeof SUBJECT_CATEGORIES)[number];

const p = (id: string, label: string, category: SubjectCategory, spec: SpecPatch): SubjectPreset => ({ id, label, category, spec });

export const SUBJECT_PRESETS: SubjectPreset[] = [
  // ---- characters
  p("hero-idle", "Hero, idle", "Characters", { subject: "a young adventurer with a blue cape and a short sword", kind: "character", width: 32, height: 32, frames: 4, motion: "breathing idle: chest and cape move up and down by one pixel", view: "side" }),
  p("hero-walk", "Hero, walk cycle", "Characters", { subject: "a young adventurer with a blue cape and a short sword", kind: "character", width: 32, height: 32, frames: 6, motion: "side-view walk cycle: contact, down, passing, up for each leg; arms swing opposite to legs", view: "side" }),
  p("knight", "Knight", "Characters", { subject: "an armoured knight with a plumed helmet, round shield and sword", kind: "character", width: 32, height: 32, frames: 1, view: "front" }),
  p("mage", "Mage", "Characters", { subject: "a wizard in a long purple robe and pointed hat holding a glowing staff", kind: "character", width: 32, height: 32, frames: 4, motion: "the staff orb pulses and the robe hem sways", view: "front" }),
  p("archer", "Archer", "Characters", { subject: "a hooded forest archer with a longbow and quiver", kind: "character", width: 32, height: 32, frames: 1, view: "side" }),
  p("villager", "Villager NPC", "Characters", { subject: "a friendly village shopkeeper with an apron and a round face", kind: "character", width: 24, height: 32, frames: 2, motion: "gentle two-frame idle bob", view: "front" }),
  p("topdown-hero", "Top-down hero", "Characters", { subject: "a small adventurer seen from above, walking down", kind: "character", width: 16, height: 16, frames: 4, motion: "walk cycle facing the camera, four frames", view: "top-down" }),
  // ---- creatures
  p("slime", "Slime, bounce", "Creatures", { subject: "a friendly green slime with two eyes", kind: "creature", width: 24, height: 24, frames: 4, motion: "squash and stretch while bouncing in place", view: "side" }),
  p("bat", "Bat, flying", "Creatures", { subject: "a small purple bat with big ears", kind: "creature", width: 24, height: 16, frames: 4, motion: "wings flap: up, mid, down, mid", view: "front" }),
  p("skeleton", "Skeleton", "Creatures", { subject: "a skeleton warrior with a rusty sword and a cracked skull", kind: "creature", width: 32, height: 32, frames: 4, motion: "slow menacing idle sway", view: "side" }),
  p("ghost", "Ghost", "Creatures", { subject: "a translucent floating ghost with a wavy tail and sad eyes", kind: "creature", width: 24, height: 32, frames: 4, motion: "floats up and down; the tail ripples", view: "front" }),
  p("dragon", "Dragon, small", "Creatures", { subject: "a small red dragon with stubby wings and a long tail", kind: "creature", width: 48, height: 48, frames: 4, motion: "idle: wings lift slightly, tail swishes, smoke puff from the nostril", view: "side" }),
  p("wolf", "Wolf", "Creatures", { subject: "a grey wolf in profile with a bushy tail", kind: "creature", width: 40, height: 28, frames: 4, motion: "trot cycle", view: "side" }),
  p("crab", "Crab", "Creatures", { subject: "a red beach crab with raised claws", kind: "creature", width: 24, height: 16, frames: 2, motion: "claws open and close", view: "front" }),
  // ---- items
  p("potion", "Potion", "Items", { subject: "a round glass potion bottle with a cork, filled with glowing red liquid", kind: "item", width: 16, height: 16, frames: 1, view: "front" }),
  p("sword", "Sword", "Items", { subject: "a steel sword with a gold crossguard, shown diagonally", kind: "item", width: 16, height: 16, frames: 1, view: "front" }),
  p("shield", "Shield", "Items", { subject: "a wooden round shield with an iron rim and a red emblem", kind: "item", width: 16, height: 16, frames: 1, view: "front" }),
  p("key", "Key", "Items", { subject: "an old brass key with a decorative bow", kind: "item", width: 16, height: 16, frames: 1, view: "front" }),
  p("coin", "Coin, spin", "Items", { subject: "a gold coin with a star stamped on it", kind: "item", width: 16, height: 16, frames: 6, motion: "spins around its vertical axis: full face, narrowing, edge-on, narrowing, full face again", view: "front" }),
  p("heart", "Heart pickup", "Items", { subject: "a glossy red heart", kind: "item", width: 16, height: 16, frames: 2, motion: "pulses: the second frame is one pixel larger", view: "front" }),
  p("chest", "Treasure chest", "Items", { subject: "a wooden treasure chest with gold trim, closed", kind: "item", width: 32, height: 32, frames: 1, view: "three-quarter" }),
  p("scroll", "Scroll", "Items", { subject: "a rolled parchment scroll tied with a red ribbon", kind: "item", width: 16, height: 16, frames: 1, view: "front" }),
  // ---- props
  p("torch", "Wall torch, flame", "Props", { subject: "a wall torch with a flickering orange flame", kind: "prop", width: 16, height: 32, frames: 4, motion: "the flame flickers; the tip changes shape each frame; the torch itself does not move", view: "front" }),
  p("door", "Wooden door", "Props", { subject: "an arched wooden door with iron hinges set in a stone frame", kind: "prop", width: 32, height: 48, frames: 1, view: "front" }),
  p("barrel", "Barrel and crate", "Props", { subject: "a wooden barrel with iron hoops", kind: "prop", width: 16, height: 24, frames: 1, view: "three-quarter" }),
  p("sign", "Signpost", "Props", { subject: "a wooden signpost with two arrows", kind: "prop", width: 24, height: 32, frames: 1, view: "front" }),
  p("campfire", "Campfire", "Props", { subject: "a campfire with logs and crackling flames", kind: "prop", width: 32, height: 32, frames: 4, motion: "flames flicker, one ember pops up", view: "three-quarter" }),
  p("lamp", "Street lamp", "Props", { subject: "an iron street lamp with a warm glowing lantern", kind: "prop", width: 16, height: 48, frames: 1, view: "front" }),
  // ---- nature
  p("tree", "Apple tree", "Nature", { subject: "a leafy apple tree with a thick trunk and red apples", kind: "tree", width: 48, height: 64, frames: 1, view: "three-quarter" }),
  p("pine", "Pine tree", "Nature", { subject: "a tall dark-green pine tree with layered branches", kind: "tree", width: 32, height: 48, frames: 1, view: "three-quarter" }),
  p("bush", "Berry bush", "Nature", { subject: "a round green bush with a few red berries", kind: "tree", width: 24, height: 20, frames: 1, view: "three-quarter" }),
  p("flowers", "Flower patch", "Nature", { subject: "a small patch of wildflowers: yellow, white and pink", kind: "prop", width: 16, height: 16, frames: 2, motion: "flowers sway one pixel left and right", view: "three-quarter" }),
  p("rock", "Boulder", "Nature", { subject: "a mossy grey boulder", kind: "prop", width: 24, height: 20, frames: 1, view: "three-quarter" }),
  p("mushroom", "Mushroom", "Nature", { subject: "a red-capped mushroom with white spots", kind: "prop", width: 16, height: 16, frames: 1, view: "three-quarter" }),
  // ---- tiles
  p("grass-tile", "Grass tile", "Tiles", { subject: "a seamless grass tile with a few darker tufts", kind: "tile", width: 16, height: 16, frames: 1, view: "top-down", outline: "none" }),
  p("water-tile", "Water, animated", "Tiles", { subject: "a seamless water tile with soft light ripples", kind: "tile", width: 16, height: 16, frames: 4, motion: "ripples shift one pixel per frame and loop seamlessly", view: "top-down", outline: "none" }),
  p("stone-wall", "Stone wall tile", "Tiles", { subject: "a seamless grey stone brick wall tile", kind: "tile", width: 16, height: 16, frames: 1, view: "front", outline: "none" }),
  p("wood-floor", "Wood floor tile", "Tiles", { subject: "a seamless wooden plank floor tile", kind: "tile", width: 16, height: 16, frames: 1, view: "top-down", outline: "none" }),
  p("sand-tile", "Sand tile", "Tiles", { subject: "a seamless sand tile with tiny pebbles", kind: "tile", width: 16, height: 16, frames: 1, view: "top-down", outline: "none" }),
  p("lava-tile", "Lava, animated", "Tiles", { subject: "a seamless bubbling lava tile, orange and dark red", kind: "tile", width: 16, height: 16, frames: 4, motion: "bubbles rise and pop; glow shifts", view: "top-down", outline: "none" }),
  // ---- effects
  p("explosion", "Explosion", "Effects", { subject: "a cartoon explosion burst", kind: "prop", width: 32, height: 32, frames: 6, motion: "starts as a small white flash, grows to a big orange fireball, then fades into dark smoke", view: "front", outline: "none" }),
  p("sparkle", "Sparkle", "Effects", { subject: "a four-point star sparkle", kind: "prop", width: 16, height: 16, frames: 4, motion: "grows from a dot to a full star and shrinks again", view: "front", outline: "none" }),
  p("slash", "Sword slash", "Effects", { subject: "a white curved sword slash arc", kind: "prop", width: 32, height: 32, frames: 3, motion: "the arc sweeps across and thins out", view: "front", outline: "none" }),
  p("smoke", "Smoke puff", "Effects", { subject: "a grey smoke puff", kind: "prop", width: 24, height: 24, frames: 4, motion: "expands and fades", view: "front", outline: "none" }),
  // ---- ui
  p("ui-heart", "Heart container", "UI", { subject: "a heart icon for a health bar, full", kind: "ui", width: 16, height: 16, frames: 1, view: "front" }),
  p("ui-star", "Star icon", "UI", { subject: "a gold star icon", kind: "ui", width: 16, height: 16, frames: 1, view: "front" }),
  p("ui-button", "Button", "UI", { subject: "a rounded wooden button, flat, with room for a label", kind: "ui", width: 48, height: 16, frames: 2, motion: "frame 0 normal, frame 1 pressed (one pixel lower, darker)", view: "front" }),
  p("ui-cursor", "Pointer cursor", "UI", { subject: "a pixel arrow cursor with a white fill and black outline", kind: "ui", width: 16, height: 16, frames: 1, view: "front" }),
];

export interface StylePack {
  id: string;
  label: string;
  description: string;
  spec: SpecPatch;
}

/** Well-known fantasy-console palettes (hex values as published by their authors). */
export const PALETTES = {
  pico8: ["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8", "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa"],
  gameboy: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
  sweetie16: ["#1a1c2c", "#5d275d", "#b13e53", "#ef7d57", "#ffcd75", "#a7f070", "#38b764", "#257179", "#29366f", "#3b5dc9", "#41a6f6", "#73eff7", "#f4f4f4", "#94b0c2", "#566c86", "#333c57"],
} as const;

export const STYLE_PACKS: StylePack[] = [
  { id: "snes-rpg", label: "16-bit RPG", description: "Rich but limited colours, cel shading, dark outline.", spec: { style: "snes", colors: 16, palette: [], outline: "dark", shading: "cel", light: "top-left" } },
  { id: "nes", label: "8-bit NES", description: "Very few colours, flat shading, hard edges.", spec: { style: "nes", colors: 8, palette: [], outline: "dark", shading: "flat", light: "top-left" } },
  { id: "gameboy", label: "Game Boy", description: "Four shades of green, nothing else.", spec: { style: "gameboy", colors: 4, palette: [...PALETTES.gameboy], outline: "dark", shading: "cel", light: "top-left" } },
  { id: "pico8", label: "PICO-8 palette", description: "The 16 fixed PICO-8 colours.", spec: { style: "snes", colors: 16, palette: [...PALETTES.pico8], outline: "dark", shading: "cel", light: "top-left" } },
  { id: "sweetie16", label: "Sweetie 16 palette", description: "A warm, friendly 16-colour palette.", spec: { style: "snes", colors: 16, palette: [...PALETTES.sweetie16], outline: "colored", shading: "cel", light: "top-left" } },
  { id: "dark-dungeon", label: "Dark dungeon", description: "Muted cold colours, deep shadows, dithering.", spec: { style: "snes", colors: 12, palette: [], outline: "dark", shading: "dither", light: "top", notes: "Muted, cold colour ramps with deep near-black shadows. Mood: damp, dangerous." } },
  { id: "bright-cute", label: "Bright and cute", description: "Saturated candy colours, soft coloured outline.", spec: { style: "modern", colors: 20, palette: [], outline: "colored", shading: "cel", light: "top-left", notes: "Rounded shapes, big eyes where it makes sense, saturated friendly colours." } },
  { id: "neon", label: "Neon night", description: "Dark base with glowing neon accents.", spec: { style: "modern", colors: 14, palette: [], outline: "none", shading: "cel", light: "top", notes: "Near-black base colours with a few glowing neon accents (cyan, magenta, yellow)." } },
];

export function findSubjectPreset(idOrLabel: string): SubjectPreset | undefined {
  const k = idOrLabel.trim().toLowerCase();
  return SUBJECT_PRESETS.find((x) => x.id === k || x.label.toLowerCase() === k);
}
export function findStylePack(idOrLabel: string): StylePack | undefined {
  const k = idOrLabel.trim().toLowerCase();
  return STYLE_PACKS.find((x) => x.id === k || x.label.toLowerCase() === k);
}
