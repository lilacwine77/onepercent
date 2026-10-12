import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const [baselinePath, outputPath = "fixtures/reports/cargo-age.json"] =
  process.argv.slice(2);
if (!baselinePath)
  throw new Error(
    "Usage: node scripts/audit-cargo-age.mjs <M0.1 Cargo.lock> [report.json]",
  );
function packages(text) {
  return text.split("[[package]]").flatMap((chunk) => {
    const name = /^name = "([^"]+)"/m.exec(chunk)?.[1];
    const version = /^version = "([^"]+)"/m.exec(chunk)?.[1];
    return name && version && chunk.includes('source = "registry+')
      ? [{ name, version }]
      : [];
  });
}
const baseline = new Set(
  packages(await readFile(baselinePath, "utf8")).map(
    (p) => `${p.name}@${p.version}`,
  ),
);
const added = packages(await readFile("Cargo.lock", "utf8")).filter(
  (p) => !baseline.has(`${p.name}@${p.version}`),
);
const checkedAt = new Date();
const cutoff = new Date(checkedAt.getTime() - 14 * 24 * 3600 * 1000);
let next = 0;
const rows = [];
let previous = [];
try {
  previous = JSON.parse(await readFile(outputPath, "utf8")).packages;
} catch {
  /* First audit has no cache. */
}
const cached = new Map(
  previous
    .filter((r) => r.publishedAt && !r.error)
    .map((r) => [`${r.name}@${r.version}`, r]),
);
await Promise.all(
  Array.from({ length: 5 }, async () => {
    while (next < added.length) {
      const p = added[next++];
      const prior = cached.get(`${p.name}@${p.version}`);
      if (prior) {
        rows.push({
          ...prior,
          eligible: new Date(prior.publishedAt) <= cutoff,
        });
        continue;
      }
      const source = `https://crates.io/api/v1/crates/${p.name}/${p.version}`;
      let row;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const response = await fetch(source, {
            headers: { "user-agent": "Onepercent-M1-dependency-audit" },
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const { version } = await response.json();
          row = {
            ...p,
            publishedAt: version.created_at,
            source,
            eligible: new Date(version.created_at) <= cutoff,
          };
          break;
        } catch (error) {
          row = { ...p, source, error: String(error) };
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
      rows.push(row);
    }
  }),
);
rows.sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);
const report = {
  checkedAt: checkedAt.toISOString(),
  cutoff: cutoff.toISOString(),
  added: rows.length,
  violations: rows.filter((r) => r.eligible === false).length,
  errors: rows.filter((r) => r.error).length,
  packages: rows,
};
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({
    added: report.added,
    violations: report.violations,
    errors: report.errors,
    report: outputPath,
  }),
);
if (report.violations || report.errors) process.exitCode = 1;
