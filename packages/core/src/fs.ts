/** All disk access goes through this so Tauri, Node (MCP) and tests can each plug in their own. */
export interface FileSystemAdapter {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}

export class MemoryFs implements FileSystemAdapter {
  private files = new Map<string, string | Uint8Array>();

  async readText(path: string) {
    const v = this.files.get(path);
    if (typeof v !== "string") throw new Error(`ENOENT: ${path}`);
    return v;
  }
  async writeText(path: string, content: string) {
    this.files.set(path, content);
  }
  async readBinary(path: string) {
    const v = this.files.get(path);
    if (!(v instanceof Uint8Array)) throw new Error(`ENOENT: ${path}`);
    return v;
  }
  async writeBinary(path: string, data: Uint8Array) {
    this.files.set(path, data);
  }
  async exists(path: string) {
    return this.files.has(path);
  }
  async remove(path: string) {
    this.files.delete(path);
  }
}
