import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasProhibitedBuildContent } from "./production-content.mjs";
import { browserBufferReferences } from "./browser-buffer.mjs";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(web, "dist");
const failures = [];
let checked = 0;
async function inspect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    // The preview build's demo adapters (VITE_PREVIEW=1) never reach production.
    if (/^(xray-card|Demo[A-Z][a-z]+|boot)-/.test(item.name))
      failures.push(`${relative(dist, path)}: demo build output`);
    if (item.isDirectory()) await inspect(path);
    else if (/\.(?:html|js|css|json|map)$/i.test(item.name)) {
      checked++;
      const source = await readFile(path, "utf8");
      if (item.name.endsWith(".js"))
        failures.push(
          ...browserBufferReferences(source).map(
            (error) => `${relative(dist, path)}:${error}`,
          ),
        );
      if (hasProhibitedBuildContent(source))
        failures.push(`${relative(dist, path)}: prohibited build content`);
      if (item.name.endsWith(".html")) {
        for (const tag of source.matchAll(
          /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
        )) {
          if (!/\bsrc\s*=/.test(tag[1]) || tag[2].trim())
            failures.push(`${relative(dist, path)}: inline script`);
        }
        if (/\bon[a-z]+\s*=|\bstyle\s*=/i.test(source))
          failures.push(
            `${relative(dist, path)}: inline executable or style attribute`,
          );
      }
    }
  }
}
await inspect(dist);
if (!checked) throw new Error("No production build files found");
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log(`Production content check passed (${checked} files).`);
