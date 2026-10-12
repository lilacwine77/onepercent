/** Standalone onepct-rescue: one CommonJS file for Node 22, built twice and compared. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, version } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = resolve(root, "../..");
const destination = resolve(
  process.argv[2] ?? resolve(root, "dist/rescue-release"),
);
const options = {
  absWorkingDir: app,
  entryPoints: ["packages/cli/src/rescue/index.ts"],
  bundle: true,
  conditions: ["development"],
  platform: "node",
  target: "node22.22.2",
  format: "cjs",
  write: false,
  sourcemap: false,
  legalComments: "inline",
  logLevel: "warning",
};
// Pure-JS dependency fallbacks avoid platform-specific native artifacts; paths in
// the output are relative to app/, so the same lockfile gives the same bytes.
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const first = await build(options);
const second = await build(options);
const bytes = first.outputFiles[0].contents;
assert.equal(sha256(bytes), sha256(second.outputFiles[0].contents));
await mkdir(destination, { recursive: true });
await writeFile(resolve(destination, "onepct-rescue.cjs"), bytes);
await chmod(resolve(destination, "onepct-rescue.cjs"), 0o755);
const manifest = {
  schemaVersion: 1,
  artifact: "onepct-rescue.cjs",
  sha256: sha256(bytes),
  lockfileSha256: sha256(await readFile(resolve(app, "pnpm-lock.yaml"))),
  esbuild: version,
  node: ">=22.22.2 <23",
  packageManager: "pnpm@10.34.5",
  reproducibleBuilds: 2,
};
await writeFile(
  resolve(destination, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
// Verify with: shasum -a 256 -c onepct-rescue.cjs.sha256 (or sha256sum -c).
await writeFile(
  resolve(destination, "onepct-rescue.cjs.sha256"),
  `${manifest.sha256}  onepct-rescue.cjs\n`,
);
process.stdout.write(`${JSON.stringify(manifest)}\n`);
