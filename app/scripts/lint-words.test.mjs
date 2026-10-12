import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { test } from "node:test";
import {
  isPinnedUpstreamIdl,
  readVocabulary,
  repoRoot,
  upstreamIdlHashes,
  wordMatches,
} from "../apps/web/scripts/lint-words.mjs";

test("the upstream IDL exception requires both the pinned path and hash", () => {
  const source = readFileSync(
    resolve(repoRoot, "app/fixtures/meteora/SOURCE.md"),
    "utf8",
  );
  assert.equal(Object.keys(upstreamIdlHashes).length, 2);
  for (const [file, hash] of Object.entries(upstreamIdlHashes)) {
    const bytes = readFileSync(resolve(repoRoot, file));
    assert.equal(isPinnedUpstreamIdl(file, bytes), true);
    assert.ok(
      source
        .split("\n")
        .some(
          (line) =>
            line.includes(`\`${basename(file)}\``) && line.includes(hash),
        ),
    );
    assert.equal(isPinnedUpstreamIdl(`${file}.copy`, bytes), false);
    assert.equal(
      isPinnedUpstreamIdl(file.replace("fixtures", "src"), bytes),
      false,
    );
    const edited = Buffer.concat([
      bytes,
      Buffer.from(`\n${readVocabulary().everywhere[0]}\n`),
    ]);
    assert.equal(isPinnedUpstreamIdl(file, edited), false);
    assert.ok(
      wordMatches(edited.toString(), readVocabulary().everywhere).length,
    );
  }
});
