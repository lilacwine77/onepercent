import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const versionPattern = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;
const day = 24 * 60 * 60 * 1000;
const key = ({ registry, name, version }) => `${registry}:${name}@${version}`;

export function cargoPackages(text) {
  return text.split("[[package]]").flatMap((entry) => {
    const name = /^name = "([^"]+)"/m.exec(entry)?.[1];
    const version = /^version = "([^"]+)"/m.exec(entry)?.[1];
    const source = /^source = "([^"]+)"/m.exec(entry)?.[1];
    if (!source) return [];
    if (!name || !version || !source.startsWith("registry+"))
      throw new Error("Unsupported Cargo lock source; explicit audit required");
    return [{ registry: "cargo", name, version }];
  });
}

export function npmPackages(text) {
  if (!text.trim()) return [];
  const section = /^packages:\n([\s\S]*?)(?=^\S|$(?![\s\S]))/m.exec(text)?.[1];
  if (!section) throw new Error("Expected pnpm v9 packages section");
  return [...section.matchAll(/^ {2}(\S[^\n]*):\s*$/gm)].map((match) => {
    const entry = match[1].replace(/^['"]|['"]$/g, "");
    const at = entry.lastIndexOf("@");
    const name = entry.slice(0, at);
    const version = entry.slice(at + 1);
    if (at < 1 || !versionPattern.test(version))
      throw new Error(`Unsupported npm lock entry: ${entry}`);
    return { registry: "npm", name, version };
  });
}

export function npmDirect(manifest) {
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  };
  if (manifest.packageManager) {
    const at = manifest.packageManager.lastIndexOf("@");
    dependencies[manifest.packageManager.slice(0, at)] =
      manifest.packageManager.slice(at + 1);
  }
  return Object.entries(dependencies).flatMap(([name, version]) => {
    if (version.startsWith("workspace:")) return [];
    if (!versionPattern.test(version))
      throw new Error(
        `Direct npm dependency must be exact: ${name}@${version}`,
      );
    return [{ registry: "npm", name, version, documented: true }];
  });
}

export function cargoDirect(text) {
  let dependencySection = false;
  const result = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("[")) {
      if (/dependencies\.[^\]]+\]$/.test(line))
        throw new Error(
          "Expanded Cargo dependency tables need explicit audit support",
        );
      dependencySection = /(?:^\[|\.)(?:dev-|build-)?dependencies\]$/.test(
        line,
      );
      continue;
    }
    if (!dependencySection || !line.trim() || line.trim().startsWith("#"))
      continue;
    const match =
      /^([\w-]+)\s*=\s*(?:"=([^"]+)"|\{[^\n]*version\s*=\s*"=([^"]+)")/.exec(
        line,
      );
    if (!match || !versionPattern.test(match[2] ?? match[3]))
      throw new Error(`Unsupported or unpinned Cargo dependency: ${line}`);
    const renamed = /package\s*=\s*"([^"]+)"/.exec(line)?.[1];
    result.push({
      registry: "cargo",
      name: renamed ?? match[1],
      version: match[2] ?? match[3],
      documented: true,
    });
  }
  return result;
}

export function documentationDates(text) {
  const dates = new Map();
  for (const line of text.split("\n")) {
    const cells = line
      .split("|")
      .map((cell) => cell.replaceAll("`", "").trim());
    const published = cells
      .slice(3)
      .find((cell) => /^\d{4}-\d{2}-\d{2}$/.test(cell));
    if (
      cells.length >= 5 &&
      versionPattern.test(cells[2]) &&
      published &&
      line.includes("https://")
    )
      dates.set(`${cells[1]}@${cells[2]}`, published);
  }
  for (const match of text.matchAll(
    /`([\w-]+) (\d+\.\d+\.\d+)` \((\d{4}-\d{2}-\d{2})\)/g,
  ))
    dates.set(`${match[1]}@${match[2]}`, match[3]);
  for (const match of text.matchAll(
    /([@\w/.-]+) (\d+\.\d+\.\d+)\s*\(\[published (\d{4}-\d{2}-\d{2})\]\(https:\/\/[^)]+\)\)/g,
  ))
    dates.set(`${match[1]}@${match[2]}`, match[3]);
  return dates;
}

export function publicationCheck(row, publishedAt, documentedDate, now) {
  const published = new Date(publishedAt);
  if (!publishedAt || !Number.isFinite(published.getTime()))
    throw new Error(`Missing registry publication date: ${key(row)}`);
  if (published.getTime() > now.getTime() - 14 * day)
    throw new Error(
      `Release younger than 14 days: ${key(row)} (${publishedAt})`,
    );
  if (row.documented && !documentedDate)
    throw new Error(`Missing publish-date entry in VERSIONS.md: ${key(row)}`);
  if (documentedDate && published.toISOString().slice(0, 10) !== documentedDate)
    throw new Error(
      `VERSIONS.md date differs from registry: ${key(row)} (${documentedDate} vs ${publishedAt})`,
    );
}

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.name.startsWith(".") ||
      ["node_modules", "target", "dist", "coverage", "test-ledger"].includes(
        entry.name,
      )
    )
      continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (["package.json", "Cargo.toml"].includes(entry.name))
      result.push(path);
  }
  return result;
}

async function registryJson(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "Onepercent-dependency-age-audit" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return await response.json();
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((done) => setTimeout(done, 1000 * (attempt + 1)));
    }
  }
}

export async function audit(appDirectory, baselineDirectory, outputPath) {
  const versions = await readFile(join(appDirectory, "VERSIONS.md"), "utf8");
  const documented = documentationDates(versions);
  for (const match of versions.matchAll(
    /\]\((fixtures\/reports\/[\w-]+age\.json)\)/g,
  )) {
    const report = JSON.parse(
      await readFile(join(appDirectory, match[1]), "utf8"),
    );
    for (const row of report.packages ?? []) {
      if (row.publishedAt && row.source?.startsWith("https://"))
        documented.set(
          `${row.name}@${row.version}`,
          new Date(row.publishedAt).toISOString().slice(0, 10),
        );
    }
  }
  const current = new Map();
  const add = (row) =>
    current.set(key(row), { ...current.get(key(row)), ...row });
  for (const path of await files(appDirectory)) {
    const text = await readFile(path, "utf8");
    for (const row of path.endsWith("package.json")
      ? npmDirect(JSON.parse(text))
      : cargoDirect(text))
      add(row);
  }
  const locks = [
    ["pnpm-lock.yaml", npmPackages],
    ["Cargo.lock", cargoPackages],
    ["test-programs/mock-vrf/Cargo.lock", cargoPackages],
  ];
  // The mock's separate lock may reuse approved program resolutions.
  // A version is new only if it was absent from the entire baseline graph.
  const previous = new Set();
  for (const [lock, parse] of locks) {
    for (const row of parse(
      await readFile(join(baselineDirectory, lock), "utf8"),
    ))
      previous.add(key(row));
  }
  for (const [lock, parse] of locks) {
    for (const row of parse(await readFile(join(appDirectory, lock), "utf8"))) {
      if (!previous.has(key(row)))
        add({
          ...row,
          documented:
            row.registry === "cargo" || current.get(key(row))?.documented,
        });
    }
  }
  const workspace = await readFile(
    join(appDirectory, "pnpm-workspace.yaml"),
    "utf8",
  );
  if (
    !/^minimumReleaseAge:\s*20160\s*$/m.test(workspace) ||
    /^minimumReleaseAgeExclude\s*:/m.test(workspace)
  )
    throw new Error(
      "Expected the documented 14-day npm policy without exclusions",
    );
  const now = new Date();
  const rows = [...current.values()].sort((a, b) =>
    key(a).localeCompare(key(b)),
  );
  const npmMetadata = new Map();
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        try {
          if (row.registry === "npm") {
            row.source = `https://registry.npmjs.org/${encodeURIComponent(row.name)}`;
            if (!npmMetadata.has(row.name))
              npmMetadata.set(row.name, registryJson(row.source));
            row.publishedAt = (await npmMetadata.get(row.name)).time?.[
              row.version
            ];
          } else {
            row.source = `https://crates.io/api/v1/crates/${row.name}/${row.version}`;
            row.publishedAt = (
              await registryJson(row.source)
            ).version?.created_at;
          }
          publicationCheck(
            row,
            row.publishedAt,
            documented.get(`${row.name}@${row.version}`),
            now,
          );
        } catch (error) {
          row.error = error.message;
        }
      }
    }),
  );
  const errors = rows.filter((row) => row.error);
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ checkedAt: now.toISOString(), cutoff: new Date(now.getTime() - 14 * day).toISOString(), checked: rows.length, errors: errors.length, packages: rows }, null, 2)}\n`,
  );
  for (const row of errors) console.error(row.error);
  console.log(
    JSON.stringify({
      checked: rows.length,
      errors: errors.length,
      report: outputPath,
    }),
  );
  return errors.length === 0;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [baselineDirectory, outputPath] = process.argv.slice(2);
  if (!baselineDirectory || !outputPath)
    throw new Error(
      "Usage: node scripts/audit-dependency-age.mjs <baseline app directory> <report.json>",
    );
  const appDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
  if (
    !(await audit(
      appDirectory,
      resolve(baselineDirectory),
      resolve(outputPath),
    ))
  )
    process.exitCode = 1;
}
