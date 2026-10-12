import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILD,
  buildCommand,
  assertReleaseElf,
  releaseManifest,
  sha256,
} from "./program-release-build.mjs";
const elf = () => {
  const bytes = Buffer.alloc(128);
  Buffer.from("7f454c460201", "hex").copy(bytes);
  bytes.writeUInt32LE(3, 48);
  return bytes;
};
test("release manifest ties exact bytes to committed source, public inputs and locked toolchain", () => {
  const artifact = elf();
  const input = Buffer.from(
    JSON.stringify({ programId: "public program", dbcConfig: "public config" }),
  );
  const m = releaseManifest({
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    artifact,
    input,
    lock: Buffer.from("lock"),
    image: "sha256:image",
    versions: "pinned",
  });
  assert.equal(m.artifact.sha256, sha256(artifact));
  assert.equal(m.publicInputSha256, sha256(input));
  assert.equal(m.artifact.bytes, 128);
  assert.deepEqual(m.toolchain.features, ["mainnet"]);
  assert.equal(m.reproduction.independentBuilds, 2);
  assert.match(BUILD.baseImage, /@sha256:[0-9a-f]{64}$/);
  assert(buildCommand.includes("--locked"));
  assert(!buildCommand.includes("--all-features"));
});
test("release refuses truncated, other architectures and changed byte hashes", () => {
  assert.throws(() => assertReleaseElf(Buffer.alloc(10)));
  const bytes = elf();
  const before = sha256(bytes);
  bytes.writeUInt32LE(2, 48);
  assert.throws(() => assertReleaseElf(bytes), /sBPFv3/);
  assert.notEqual(sha256(bytes), before);
});
