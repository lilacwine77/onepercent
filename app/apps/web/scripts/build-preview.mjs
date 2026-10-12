/**
 * The PREVIEW build (VITE_PREVIEW=1): one app where each flow runs live or on its
 * demo adapter, as /api/web/config says (src/demo). Railway's dev web service
 * builds it with the build argument VITE_PREVIEW=1 and the production Caddyfile;
 * locally it writes apps/web/dist-preview:
 *
 *   pnpm --filter web build:preview
 *
 * Production builds never set VITE_PREVIEW; scripts/check-dist.mjs fails on
 * preview output.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = spawnSync(
  process.execPath,
  [
    "--preserve-symlinks",
    "--preserve-symlinks-main",
    resolve(web, "../../scripts/web.mjs"),
    "build",
  ],
  {
    cwd: web,
    stdio: "inherit",
    env: { ...process.env, VITE_PREVIEW: "1", WEB_OUT_DIR: "dist-preview" },
  },
);
if (run.status !== 0) process.exit(run.status ?? 1);
const index = resolve(web, "dist-preview/index.html");
if (
  !existsSync(index) ||
  !readFileSync(index, "utf8").includes('<div id="root">')
)
  throw new Error("dist-preview/index.html is missing");
console.log("Preview build ready: apps/web/dist-preview.");
