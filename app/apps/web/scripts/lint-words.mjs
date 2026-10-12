import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

export const repoRoot = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../.."),
);

const { BANNED_EVERYWHERE, BANNED_COPY } = await tsImport(
  "../../../packages/config/src/vocabulary.ts",
  import.meta.url,
);

export function readVocabulary() {
  return { everywhere: BANNED_EVERYWHERE, copyOnly: BANNED_COPY };
}

// Architect-approved exception for byte-exact upstream IDLs only. These hashes
// are also recorded in fixtures/meteora/SOURCE.md. Edited files remain scanned.
export const upstreamIdlHashes = Object.freeze({
  "app/fixtures/meteora/dbc.json":
    "beedc8c869bc04865c26349a72a3ba9c773e61f48be2d33093c591a015fe82fd",
  "app/fixtures/meteora/damm-v2.json":
    "ccbe93966accca0693790fd3a35b06ed4ca3758cd4d8675c31df92703b9a974d",
});

export function isPinnedUpstreamIdl(file, bytes) {
  return (
    Object.hasOwn(upstreamIdlHashes, file) &&
    createHash("sha256").update(bytes).digest("hex") === upstreamIdlHashes[file]
  );
}

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function wordMatches(source, words) {
  return words.flatMap((word) => {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escape(word)}(?![\\p{L}\\p{N}_])`,
      "giu",
    );
    return [...source.matchAll(pattern)].map((match) => ({
      word,
      line: source.slice(0, match.index).split("\n").length,
    }));
  });
}

// Founder rule (COPY.md §0.8): no em dash in any user-facing text, including tab
// titles and link previews. Comments are ignored; tests and fixtures are exempt.
const userFacing = [
  /^app\/packages\/copy\/src\//,
  /^app\/packages\/eligibility\/src\/copy\.ts$/,
  /^app\/apps\/web\/index\.html$/,
  /^app\/apps\/web\/src\//,
  /^app\/services\/bot\/src\//,
  /^app\/services\/api\/src\/(actions|cards|go|link|public|web|xray)\//,
];
export function isUserFacing(file) {
  return (
    userFacing.some((pattern) => pattern.test(file)) &&
    !/(\.test\.|\/test\/|\/tests\/|__fixtures__|\/fixtures\/)/.test(file)
  );
}
export function emDashMatches(source) {
  return source.split("\n").flatMap((line, index) => {
    const trimmed = line.trim();
    if (/^(\/\/|\*|\/\*)/.test(trimmed)) return [];
    const code = line.replace(/\/\/.*$/, "");
    return code.includes("\u2014")
      ? [{ word: "em dash (U+2014)", line: index + 1 }]
      : [];
  });
}

export function scanVocabulary() {
  const vocabulary = readVocabulary();
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      "app/",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  const violations = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const file of new Set(files)) {
    if (
      file === "app/packages/config/src/vocabulary.ts" ||
      // X3's own vocabulary test asserts that these words are prohibited.
      file === "app/services/bot/src/test/static-rules.test.ts" ||
      /(?:^|\/)target\//.test(file) ||
      /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.lock)$/.test(
        file,
      )
    )
      continue;
    let source;
    try {
      const bytes = readFileSync(resolve(repoRoot, file));
      if (isPinnedUpstreamIdl(file, bytes)) continue;
      source = decoder.decode(bytes);
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof TypeError) continue;
      throw error;
    }
    if (source.includes("\0")) continue;
    const words = file.startsWith("app/packages/copy/")
      ? [...vocabulary.everywhere, ...vocabulary.copyOnly]
      : vocabulary.everywhere;
    violations.push(
      ...wordMatches(source, words).map((match) => ({ file, ...match })),
    );
    if (isUserFacing(file))
      violations.push(
        ...emDashMatches(source).map((match) => ({ file, ...match })),
      );
  }
  return violations;
}

if (
  process.argv[1] &&
  relative(
    realpathSync(process.argv[1]),
    realpathSync(fileURLToPath(import.meta.url)),
  ) === ""
) {
  const violations = scanVocabulary();
  for (const { file, line, word } of violations)
    console.error(`${file}:${line}: prohibited vocabulary: ${word}`);
  if (violations.length) process.exitCode = 1;
  else
    console.log(
      "Vocabulary check passed (packages/config/src/vocabulary.ts authority).",
    );
}
