import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Add a file only when a delivered component consumes it, then mirror the exact
// path in Dockerfile and Dockerfile.dockerignore. No binary is committed twice.
// Paths are relative to the landing's public/; each copy lands flat in /landing/.
export const landingAssets = [
  "assets/crt-poster.webp",
  // The 1% TV film (experience/home/film): the video and its poster frame.
  "media/onepercent-explained.mp4",
  "media/onepercent-explained.webp",
  // The 1% TV of the home's hero (experience/home/tv), its "Find your 1%." broadcast included.
  "models/onepercent-crt.glb",
  // The home's "Got dust? Feed the machine." and "How dust pays." (experience/home/Dust.tsx).
  "assets/onepercent-machine.webp",
  "assets/tokens/ansem.webp",
];
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(web, "../../..");

export async function syncLandingAssets(sourceRoot = repo, destination = web) {
  const result = [];
  for (const asset of landingAssets) {
    const source = resolve(sourceRoot, "public", asset);
    const target = resolve(destination, "public/landing", basename(asset));
    const original = await readFile(source); // Missing source must fail the build.
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    const copied = await readFile(target);
    if (!original.equals(copied))
      throw new Error(`Asset copy mismatch: ${asset}`);
    result.push({
      asset,
      bytes: copied.length,
      sha256: createHash("sha256").update(copied).digest("hex"),
    });
  }
  return result;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(JSON.stringify(await syncLandingAssets(), null, 2));
}
