import { format } from "prettier";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const pinned = "2293f9a66c654e9fe82dc5e8f4618538f24bb35f";
const base = "https://raw.githubusercontent.com/pump-fun/pump-public-docs";
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const stripDocs = (value) =>
  Array.isArray(value)
    ? value.map(stripDocs)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== "docs")
            .map(([key, item]) => [key, stripDocs(item)]),
        )
      : value;
const target = new URL("./idl/", import.meta.url);
await mkdir(target, { recursive: true });
const reports = [];
for (const name of ["pump", "pump_amm", "pump_fees"]) {
  const upstreamUrl = `${base}/${pinned}/idl/${name}.json`;
  const [pinnedResponse, currentResponse] = await Promise.all([
    fetch(upstreamUrl),
    fetch(`${base}/main/idl/${name}.json`),
  ]);
  if (!pinnedResponse.ok || !currentResponse.ok)
    throw new Error(`IDL fetch failed: ${name}`);
  const upstream = await pinnedResponse.text();
  const current = await currentResponse.text();
  const stored = await format(JSON.stringify(stripDocs(JSON.parse(upstream))), {
    parser: "json",
  });
  await writeFile(new URL(`${name}.json`, target), stored);
  reports.push({
    name,
    upstreamUrl,
    upstreamSha256: sha256(upstream),
    storedSha256: sha256(stored),
    mainSha256: sha256(current),
    matchesMain: sha256(upstream) === sha256(current),
  });
}
const report = {
  checkedAt: new Date().toISOString(),
  pinnedCommit: pinned,
  files: reports,
};
await writeFile(
  new URL("./idl-verification.json", import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
);
if (reports.some((item) => !item.matchesMain)) {
  throw new Error(
    "Upstream IDL drift; review the M4 instruction and layout subset before using it",
  );
}
console.log(JSON.stringify(report, null, 2));
