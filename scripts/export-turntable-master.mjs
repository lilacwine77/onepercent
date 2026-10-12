import { chromium } from "@playwright/test";
import {
  mkdtemp,
  symlink,
  unlink,
  rmdir,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { strict as assert } from "node:assert";

const project = dirname(dirname(fileURLToPath(import.meta.url)));
// The checkout contains a literal percent sign, so Vite needs the same safe
// symlink root used by scripts/dev.mjs when started independently for export.
const temporary = project.includes("%")
  ? await mkdtemp(join(tmpdir(), "one-percent-export-"))
  : null;
const root = temporary ? join(temporary, "project") : project;
if (temporary) await symlink(project, root, "dir");
const { createServer } = await import(
  pathToFileURL(join(root, "node_modules/vite/dist/node/index.js")).href
);
const server = await createServer({
  configFile: false,
  root,
  resolve: { preserveSymlinks: true },
  server: { host: "127.0.0.1", port: 0 },
});
let browser;
try {
  await server.listen();
  const port = server.httpServer.address().port;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/scripts/turntable-export.html`);
  await page.waitForFunction(
    () => typeof window.buildTurntableMaster === "function",
  );
  const result = await page.evaluate(() => window.buildTurntableMaster());
  assert.deepEqual(errors, []);
  assert.deepEqual(result.names, [
    "Printed front",
    "Branded reverse",
    "Sealed foil edge",
  ]);
  const binary = Buffer.from(result.base64, "base64");
  assert.equal(binary.readUInt32LE(0), 0x46546c67);
  const output = resolve(project, "assets/blender/onepercent-foil-master.glb");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, binary);
  console.log(
    JSON.stringify(
      { output, bytes: binary.length, meshes: result.names },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server.close();
  if (temporary) {
    await unlink(root);
    await rmdir(temporary);
  }
}
