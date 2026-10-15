import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FileSystemAdapter } from "@mse/core";

export class NodeFs implements FileSystemAdapter {
  readText = (path: string) => readFile(path, "utf8");
  readBinary = async (path: string) => new Uint8Array(await readFile(path));
  exists = (path: string) => stat(path).then(() => true, () => false);
  remove = (path: string) => rm(path, { force: true });

  async writeText(path: string, content: string) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
  async writeBinary(path: string, data: Uint8Array) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }
}
