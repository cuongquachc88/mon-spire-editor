import { watch } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, resolve, sep } from "node:path";
import type { Plugin } from "vite";

/**
 * Exposes one project folder to the editor:
 *   GET    /api/fs?path=   read bytes (404 if missing)
 *   PUT    /api/fs?path=   write body
 *   DELETE /api/fs?path=   remove
 *   HEAD   /api/fs?path=   exists (200/404)
 *   GET    /api/watch      server-sent events: one `data: <relative path>` per change
 * Paths are resolved inside the project root; anything escaping it is rejected.
 */
export function projectFsPlugin(root: string): Plugin {
  const safe = (rel: string | null) => {
    if (!rel) return null;
    const full = resolve(root, rel);
    return full === root || full.startsWith(root + sep) ? full : null;
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<Buffer>((ok, bad) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => ok(Buffer.concat(chunks)));
      req.on("error", bad);
    });

  const send = (res: ServerResponse, code: number, body?: string | Buffer) => {
    res.statusCode = code;
    res.end(body);
  };

  return {
    name: "mse-project-fs",
    configureServer(server) {
      const clients = new Set<ServerResponse>();
      let watcher: ReturnType<typeof watch> | undefined;

      const startWatching = () => {
        if (watcher) return;
        // Coalesce bursts (editors/OS emit several events per write).
        const pending = new Map<string, NodeJS.Timeout>();
        watcher = watch(root, { recursive: true }, (_event, name) => {
          if (!name) return;
          const rel = name.split(sep).join("/");
          clearTimeout(pending.get(rel));
          pending.set(
            rel,
            setTimeout(() => {
              pending.delete(rel);
              for (const c of clients) c.write(`data: ${rel}\n\n`);
            }, 60),
          );
        });
      };

      server.middlewares.use("/api/watch", (req, res) => {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        res.write(": connected\n\n");
        clients.add(res);
        startWatching();
        req.on("close", () => clients.delete(res));
      });

      server.middlewares.use("/api/fs", async (req, res) => {
        const url = new URL(req.url ?? "", "http://x");
        const full = safe(url.searchParams.get("path"));
        if (!full) return send(res, 400, "bad path");
        try {
          switch (req.method) {
            case "GET":
              return send(res, 200, await readFile(full));
            case "HEAD":
              await stat(full);
              return send(res, 200);
            case "PUT":
              await mkdir(dirname(full), { recursive: true });
              await writeFile(full, await readBody(req));
              return send(res, 204);
            case "DELETE":
              await rm(full, { force: true });
              return send(res, 204);
            default:
              return send(res, 405);
          }
        } catch (e: any) {
          return send(res, e?.code === "ENOENT" ? 404 : 500, String(e?.message ?? e));
        }
      });

      server.httpServer?.on("close", () => watcher?.close());
    },
  };
}
