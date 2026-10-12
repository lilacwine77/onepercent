import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { landingAssets, syncLandingAssets } from "./sync-landing-assets.mjs";

test("landing copy is byte-identical and a missing asset fails", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "onepercent-assets-"));
  try {
    const source = resolve(directory, "source");
    const target = resolve(directory, "web");
    await assert.rejects(syncLandingAssets(source, target), { code: "ENOENT" });
    const bytes = Uint8Array.from([0, 1, 255, 64, 32]);
    for (const asset of landingAssets) {
      await mkdir(dirname(resolve(source, "public", asset)), {
        recursive: true,
      });
      await writeFile(resolve(source, "public", asset), bytes);
    }
    const result = await syncLandingAssets(source, target);
    assert.equal(result.length, landingAssets.length);
    for (const asset of landingAssets)
      assert.deepEqual(
        await readFile(resolve(target, "public/landing", basename(asset))),
        Buffer.from(bytes),
      );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the web image lets in and copies every landing asset the sync reads", async () => {
  const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dockerfile = await readFile(resolve(web, "Dockerfile"), "utf8");
  const ignore = (
    await readFile(resolve(web, "Dockerfile.dockerignore"), "utf8")
  )
    .split("\n")
    .map((line) => line.trim());
  const copies = dockerfile
    .split("\n")
    .filter((line) => line.startsWith("COPY public/"))
    .flatMap((line) => line.split(/\s+/).slice(1, -1));
  for (const asset of landingAssets) {
    assert.ok(
      ignore.includes(`!public/${asset}`),
      `dockerignore misses ${asset}`,
    );
    assert.ok(copies.includes(`public/${asset}`), `Dockerfile misses ${asset}`);
  }
});
