import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Measure real static download closures; lazy CSS is never charged to the home. */
export async function measureBudgets({ settings, manifest, modules, size }) {
  const failures = [];
  const rows = [];
  function closure(key, seen = new Set()) {
    if (seen.has(key)) return seen;
    if (!manifest[key]) throw new Error(`Manifest import missing: ${key}`);
    seen.add(key);
    for (const next of manifest[key].imports ?? []) closure(next, seen);
    return seen;
  }
  const entries = Object.entries(manifest)
    .filter(([, item]) => item.isEntry)
    .map(([key]) => key);
  if (entries.length === 0) throw new Error("Vite manifest has no entry");
  const entryKeys = new Set(
    [...entries, ...settings.entryDynamicSources].flatMap((key) => [
      ...closure(key),
    ]),
  );
  const entryFiles = new Set([...entryKeys].map((key) => manifest[key].file));
  async function measure(label, files, limit) {
    const gzipBytes = (
      await Promise.all(
        [...files].filter((file) => file.endsWith(".js")).map(size),
      )
    ).reduce((a, b) => a + b, 0);
    rows.push({ label, gzipBytes, limit });
    if (gzipBytes > limit) failures.push(`${label}: ${gzipBytes} > ${limit}`);
  }
  await measure("entry", entryFiles, settings.entryJsGzipBytes);
  for (const file of entryFiles) {
    if (!Array.isArray(modules[file]))
      throw new Error(`Missing module inventory for ${file}`);
    for (const source of settings.entryForbiddenSources ?? []) {
      if (modules[file].some((id) => id.endsWith(`/${source}`)))
        failures.push(`Entry includes deferred source ${source}: ${file}`);
    }
    for (const forbidden of settings.entryForbiddenModules) {
      if (
        modules[file].some((id) => id.includes(`/node_modules/${forbidden}/`))
      ) {
        failures.push(`Entry includes ${forbidden}: ${file}`);
      }
    }
  }
  // Named chunks (the home, the 3D TV) have their own budgets; the 3D chunk is
  // measured on its own and never counted against a route.
  const chunkLimits = settings.chunkJsGzipBytes ?? {};
  // Shared loader/Three chunks belong to the separately budgeted experience too.
  // The manifest may split that graph into several files; count its full closure once.
  const experienceKeys = new Set(
    Object.entries(manifest)
      .filter(([, item]) => item.name === settings.experienceChunk)
      .flatMap(([key]) => [...closure(key)]),
  );
  for (const key of Object.keys(chunkLimits)) {
    if (!manifest[key]?.isDynamicEntry)
      failures.push(`Budgeted chunk not in the build: ${key}`);
  }
  for (const [key, item] of Object.entries(manifest)) {
    const experience = item.name === settings.experienceChunk;
    if (
      !item.isDynamicEntry ||
      entryKeys.has(key) ||
      (experience && !(key in chunkLimits))
    )
      continue;
    const files = new Set(
      [...closure(key)]
        .filter(
          (dependency) =>
            !entryKeys.has(dependency) &&
            (experience || !experienceKeys.has(dependency)),
        )
        .map((dependency) => manifest[dependency].file),
    );
    await measure(key, files, chunkLimits[key] ?? settings.routeJsGzipBytes);
  }
  const css = new Set(
    Object.values(manifest).flatMap((item) => item.css ?? []),
  );
  const initialCssKeys = new Set(entryKeys);
  for (const key of settings.initialCssSources) {
    for (const dependency of closure(key)) initialCssKeys.add(dependency);
  }
  const initialCss = new Set(
    [...initialCssKeys].flatMap((key) => manifest[key].css ?? []),
  );
  const initialCssBytes = (await Promise.all([...initialCss].map(size))).reduce(
    (a, b) => a + b,
    0,
  );
  rows.push({
    label: "css-initial",
    gzipBytes: initialCssBytes,
    limit: settings.initialCssGzipBytes,
  });
  if (initialCssBytes > settings.initialCssGzipBytes)
    failures.push(
      `Initial CSS: ${initialCssBytes} > ${settings.initialCssGzipBytes}`,
    );
  for (const file of css) {
    if (initialCss.has(file)) continue;
    const gzipBytes = await size(file);
    rows.push({
      label: file,
      gzipBytes,
      limit: settings.lazyCssChunkGzipBytes,
    });
    if (gzipBytes > settings.lazyCssChunkGzipBytes)
      failures.push(
        `Lazy CSS ${file}: ${gzipBytes} > ${settings.lazyCssChunkGzipBytes}`,
      );
  }
  return { measurements: rows, failures };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dist = resolve(web, "dist");
  const json = async (path) => JSON.parse(await readFile(path, "utf8"));
  const sizes = new Map();
  const result = await measureBudgets({
    settings: await json(resolve(web, "budget.json")),
    manifest: await json(resolve(dist, ".vite/manifest.json")),
    modules: await json(resolve(dist, ".vite/modules.json")),
    size: async (path) => {
      if (!sizes.has(path))
        sizes.set(path, gzipSync(await readFile(resolve(dist, path))).length);
      return sizes.get(path);
    },
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) process.exitCode = 1;
}
