import type { Command, MapData } from "@mse/core";

/**
 * Undoable structural edit of a map's layers (add/remove/reorder/rename, entity changes).
 * Snapshots the layer list before and after; fine for infrequent edits, not for per-cell painting.
 */
export class LayersCommand implements Command<MapData> {
  private before?: MapData["layers"];
  private after?: MapData["layers"];

  constructor(
    readonly label: string,
    private mutate: (map: MapData) => void,
  ) {}

  apply(map: MapData) {
    if (!this.after) {
      this.before = structuredClone(map.layers);
      this.mutate(map);
      this.after = structuredClone(map.layers);
    } else {
      map.layers = structuredClone(this.after);
    }
  }

  revert(map: MapData) {
    map.layers = structuredClone(this.before!);
  }
}
