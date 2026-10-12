// Static server for the compositor: /compose (the film), /repo (fonts, brand
// assets), /cap (frame captures), /audio (the mix, for previews).
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { repo } from "./kit.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wav": "audio/wav",
};

export function serve({ cap, audio = null, port = 0 }) {
  const roots = {
    compose: resolve(repo, "scripts/film/compose"),
    repo,
    cap: resolve(cap),
    ...(audio ? { audio: resolve(audio) } : {}),
  };
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const [, mount, ...rest] = path.split("/");
      const root = roots[mount];
      if (!root) throw new Error("no mount");
      const file = normalize(join(root, ...rest));
      if (!file.startsWith(root)) throw new Error("outside");
      const info = await stat(file);
      if (!info.isFile()) throw new Error("not a file");
      res.writeHead(200, {
        "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": info.size,
        "Cache-Control": "max-age=3600",
      });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((ok) =>
    server.listen(port, "127.0.0.1", () => ok({ server, url: `http://127.0.0.1:${server.address().port}` })),
  );
}
