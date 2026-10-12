/** Run from app/: node --preserve-symlinks apps/web/e2e/visual/start.mjs */
import { mkdir, mkdtemp, readdir, realpath, symlink } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const workspace = await realpath(
  dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))),
);
const web = join(workspace, "apps/web");
const mode = process.argv[2] ?? "preview";
if (!["preview", "build"].includes(mode))
  throw new Error(`Unsupported visual harness command: ${mode}`);
const temporary = await realpath(
  await mkdtemp(join(tmpdir(), "onepercent-visual-")),
);
const alias = join(temporary, "app");
const root = join(temporary, "apps/web");
await symlink(workspace, alias, "dir");
await mkdir(root, { recursive: true });
// Preserve workspace-relative tsconfig and fixture paths beneath the safe root.
for (const name of ["tsconfig.base.json", "packages", "node_modules"])
  await symlink(join(workspace, name), join(temporary, name));
for (const name of await readdir(web))
  if (name !== "dist" && name !== "index.html")
    await symlink(join(web, name), join(root, name));
await symlink(join(web, "e2e/visual/index.html"), join(root, "index.html"));
process.once("exit", () => rmSync(temporary, { recursive: true, force: true }));
const viteEntry = await realpath(
  join(web, "node_modules/vite/dist/node/index.js"),
);
const { preview, build } = await import(
  pathToFileURL(join(alias, relative(workspace, viteEntry))).href
);
const dependencies = {};
for (const name of ["react", "react-dom"])
  dependencies[name] = join(
    alias,
    relative(workspace, await realpath(join(web, "node_modules", name))),
  );
const options = {
  root,
  configFile: join(root, "e2e/visual/vite.config.ts"),
  envDir: alias,
  cacheDir: join(temporary, "cache"),
  // Keep every URL-facing module, CSS asset and pnpm link under the safe root.
  // Resolving symlinks back to the checkout reintroduces raw '%' into Vite URLs.
  resolve: { preserveSymlinks: true, alias: dependencies },
  build: { outDir: join(temporary, "dist"), emptyOutDir: true },
  plugins: [
    {
      name: "visual-pnpm-paths",
      enforce: "pre",
      async resolveId(id, importer, options) {
        const resolved = await this.resolve(id, importer, {
          ...options,
          skipSelf: true,
        });
        if (!resolved?.id.includes("/node_modules/")) return resolved;
        // pnpm dependencies need their own dependency directory, rather than
        // the top-level package link. Keep that real layout via the safe alias.
        const query = resolved.id.indexOf("?");
        const path = query < 0 ? resolved.id : resolved.id.slice(0, query);
        const suffix = query < 0 ? "" : resolved.id.slice(query);
        const physical = await realpath(path);
        return physical.startsWith(`${workspace}/`)
          ? {
              ...resolved,
              id: join(alias, relative(workspace, physical)) + suffix,
            }
          : resolved;
      },
    },
  ],
};
// Serve compiled assets only: no browser URL contains a filesystem module id.
// Validation artifacts stay temporary and are removed by the exit hook.
await build(options);
if (mode === "preview") {
  const server = await preview(options);
  server.printUrls();
  const stop = () => {
    server.httpServer.close(() => process.exit());
    server.httpServer.closeAllConnections();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
