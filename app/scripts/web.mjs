import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const workspace = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv[2] ?? "dev";
if (!["dev", "build", "preview"].includes(mode)) {
  throw new Error(`Unsupported web command: ${mode}`);
}
const { values } = parseArgs({
  args: process.argv.slice(3),
  options: { port: { type: "string" }, host: { type: "string" } },
});

// Vite decodes filesystem paths as URLs. Serve the original workspace through an
// alias when its path contains a literal percent, as the landing's dev runner does.
const temporary = workspace.includes("%")
  ? await realpath(await mkdtemp(join(tmpdir(), "onepercent-web-")))
  : null;
const alias = temporary ? join(temporary, "app") : workspace;
if (temporary) await symlink(workspace, alias, "dir");
// Keep Vite's root a real directory: resolving pnpm symlinks must not restore
// the percent-containing workspace path before Vite decodes the HTML filename.
const web = join(workspace, "apps/web");
const root =
  temporary && mode === "dev"
    ? join(temporary, "web")
    : join(alias, "apps/web");
if (temporary && mode === "dev") {
  await mkdir(root);
  for (const name of await readdir(web)) {
    if (name !== "dist") await symlink(join(web, name), join(root, name));
  }
}
// Vite also handles SIGTERM and may exit after closing its server. An exit hook
// removes our alias even when that handler finishes before asynchronous cleanup.
process.once("exit", () => {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
});
let server;
let stopping = false;

async function cleanup() {
  if (stopping) return;
  stopping = true;
  if (server?.close) await server.close();
  else if (server?.httpServer) {
    await new Promise((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
  if (temporary) await rm(temporary, { recursive: true, force: true });
}

try {
  const entry = await realpath(
    join(workspace, "apps/web/node_modules/vite/dist/node/index.js"),
  );
  const vite = await import(
    pathToFileURL(join(alias, relative(workspace, entry))).href
  );
  const dependencies = {};
  for (const name of ["react", "react-dom"]) {
    const location = await realpath(
      join(workspace, "apps/web/node_modules", name),
    );
    dependencies[name] = join(alias, relative(workspace, location));
  }
  const options = {
    root,
    configFile: join(root, "vite.config.ts"),
    envDir: alias,
    resolve: { preserveSymlinks: false, alias: dependencies },
    // WEB_OUT_DIR: the preview build writes dist-preview (apps/web/scripts/build-preview.mjs).
    build: {
      outDir: join(web, process.env.WEB_OUT_DIR ?? "dist"),
      emptyOutDir: true,
    },
    plugins:
      temporary && mode === "dev"
        ? [
            {
              name: "onepercent-workspace-paths",
              enforce: "pre",
              async resolveId(id, importer, options) {
                const resolved = await this.resolve(id, importer, {
                  ...options,
                  skipSelf: true,
                });
                // Resolve pnpm links first, then keep URL-facing ids free of literal '%'.
                return resolved?.id.startsWith(`${workspace}/`)
                  ? {
                      ...resolved,
                      id: join(alias, relative(workspace, resolved.id)),
                    }
                  : resolved;
              },
            },
          ]
        : [],
  };
  if (mode === "build") {
    await vite.build(options);
    await cleanup();
  } else {
    const settings = {
      host: values.host ?? "localhost",
      port: Number(values.port ?? (mode === "preview" ? 4173 : 5173)),
      strictPort: true,
    };
    if (mode === "preview") {
      server = await vite.preview({ ...options, preview: settings });
    } else {
      server = await vite.createServer({
        ...options,
        server: { ...settings, fs: { allow: [workspace, temporary ?? root] } },
      });
      await server.listen();
    }
    server.printUrls();
    const stop = () => {
      void cleanup().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
} catch (error) {
  await cleanup();
  throw error;
}
