import { useSyncExternalStore } from "react";
import { History, type Command } from "@mse/core";

/** A document being edited: data + undo history + debounced auto-save + change subscription. */
export class Doc<T> {
  readonly history: History<T>;
  private version = 0;
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private dirty = false;
  saveError?: string;

  constructor(
    readonly data: T,
    private save: (data: T) => Promise<void>,
    private debounceMs = 300,
  ) {
    this.history = new History(data);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  exec(cmd: Command<T>) {
    this.history.execute(cmd);
    this.touch();
  }
  undo() {
    if (this.history.undo()) this.touch();
  }
  redo() {
    if (this.history.redo()) this.touch();
  }

  /** Mark changed without a command (e.g. live preview that is not undoable). */
  touch() {
    this.dirty = true;
    this.emit();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  /** Redraw only; nothing is saved. */
  repaint() {
    this.emit();
  }

  async flush() {
    clearTimeout(this.timer);
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await this.save(this.data);
      this.saveError = undefined;
    } catch (e) {
      this.dirty = true; // keep it dirty so a later flush retries
      this.saveError = e instanceof Error ? e.message : String(e);
    }
    this.emit();
  }

  get isDirty() {
    return this.dirty;
  }
}

/** Re-render when the doc changes. */
export function useDoc<T>(doc: Doc<T> | undefined) {
  useSyncExternalStore(
    doc ? doc.subscribe : () => () => {},
    doc ? doc.getVersion : () => 0,
  );
  return doc;
}
