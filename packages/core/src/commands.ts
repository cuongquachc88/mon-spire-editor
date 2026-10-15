import type { MapData } from "./schema";

/** A reversible edit. Commands store deltas, not snapshots, so large maps stay cheap. */
export interface Command<S> {
  readonly label: string;
  apply(state: S): void;
  revert(state: S): void;
  /** Return a merged command if `next` can be coalesced into this one (e.g. one brush stroke). */
  merge?(next: Command<S>): Command<S> | null;
}

export class History<S> {
  private undoStack: Command<S>[] = [];
  private redoStack: Command<S>[] = [];

  constructor(
    private state: S,
    private limit = 200,
  ) {}

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  execute(cmd: Command<S>) {
    cmd.apply(this.state);
    this.redoStack = [];
    const last = this.undoStack[this.undoStack.length - 1];
    const merged = last?.merge?.(cmd);
    if (merged) this.undoStack[this.undoStack.length - 1] = merged;
    else this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.revert(this.state);
    this.redoStack.push(cmd);
    return true;
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.apply(this.state);
    this.undoStack.push(cmd);
    return true;
  }
}

export interface TilePatch {
  index: number;
  before: number;
  after: number;
}

/** Sets cells on a tile/collision layer; stores only the changed cells. */
export class SetTilesCommand implements Command<MapData> {
  readonly label = "Set tiles";
  private patches: TilePatch[] = [];

  constructor(
    private layerId: string,
    private cells: { index: number; value: number }[],
    private mergeKey?: string,
  ) {}

  private layer(map: MapData) {
    const l = map.layers.find((x) => x.id === this.layerId);
    if (!l || l.kind === "object") throw new Error(`No tile layer "${this.layerId}"`);
    return l;
  }

  apply(map: MapData) {
    const layer = this.layer(map);
    this.patches = [];
    for (const { index, value } of this.cells) {
      const before = layer.data[index];
      if (before === undefined) throw new Error(`Cell ${index} out of range`);
      if (before === value) continue;
      layer.data[index] = value;
      this.patches.push({ index, before, after: value });
    }
  }

  revert(map: MapData) {
    const layer = this.layer(map);
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i]!;
      layer.data[p.index] = p.before;
    }
  }

  /** Fold a following stroke segment into this one so a whole brush stroke undoes at once. */
  merge(next: Command<MapData>): Command<MapData> | null {
    if (!(next instanceof SetTilesCommand) || !this.mergeKey || next.mergeKey !== this.mergeKey || next.layerId !== this.layerId) {
      return null;
    }
    // `next` is already applied; keep the oldest `before` for each cell.
    const merged = new SetTilesCommand(this.layerId, [], this.mergeKey);
    const first = new Map<number, TilePatch>();
    for (const p of [...this.patches, ...next.patches]) {
      const prev = first.get(p.index);
      first.set(p.index, { index: p.index, before: prev?.before ?? p.before, after: p.after });
    }
    merged.patches = [...first.values()].filter((p) => p.before !== p.after);
    // Redo re-runs apply(), so the merged command needs the final values as its cells.
    merged.cells = merged.patches.map((p) => ({ index: p.index, value: p.after }));
    return merged;
  }
}
