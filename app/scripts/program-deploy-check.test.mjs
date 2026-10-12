import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  LOADER,
  assertDeploymentBytes,
  deploymentBudget,
  deploymentMessages,
  validateCapacity,
  checkArtifactManifest,
  main,
  readApprovedRelease,
} from "./program-deploy-check.mjs";
import { sha256 } from "./program-release-build.mjs";
const pub = (n) => new PublicKey(Buffer.alloc(32, n));
const args = {
  payer: pub(1),
  buffer: pub(2),
  program: pub(3),
  artifact: Buffer.alloc(2300, 5),
  maxLen: 4096,
  blockhash: pub(4).toBase58(),
  programRent: 100,
  programDataRent: 200,
};
async function manifestFixture(t) {
  const repository = await mkdtemp(join(tmpdir(), "onepercent-approved-rc-"));
  t.after(() => rm(repository, { recursive: true, force: true }));
  const directory = join(repository, "app");
  await mkdir(directory);
  const lock = Buffer.from("version = 4\n# approved release lock\n");
  await writeFile(join(directory, "Cargo.lock"), lock);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repository,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init");
  git("add", "app/Cargo.lock");
  git(
    "-c",
    "user.name=RC Test",
    "-c",
    "user.email=rc-test@example.invalid",
    "-c",
    "commit.gpgSign=false",
    "commit",
    "-m",
    "Approved RC test fixture",
  );
  const commit = git("rev-parse", "HEAD");
  const approved = await readApprovedRelease(
    commit,
    sha256(args.artifact),
    directory,
  );
  const input = Buffer.from(
    JSON.stringify({
      programId: args.program.toBase58(),
      dbcConfig: args.buffer.toBase58(),
    }),
  );
  const m = {
    cluster: "mainnet",
    commit,
    tree: git("rev-parse", "HEAD^{tree}"),
    cargoLockSha256: sha256(lock),
    programId: args.program.toBase58(),
    dbcConfig: args.buffer.toBase58(),
    publicInputSha256: sha256(input),
    artifact: { bytes: args.artifact.length, sha256: sha256(args.artifact) },
    toolchain: { features: ["mainnet"] },
    reproduction: { independentBuilds: 2, byteIdentical: true },
  };
  return { m, input, approved, directory };
}
test("mainnet evidence requires the matching reproducible release manifest", async (t) => {
  const { m, input, approved } = await manifestFixture(t);
  checkArtifactManifest(m, args.artifact, args.program, input, approved);
  assert.throws(() =>
    checkArtifactManifest(
      { ...m, cluster: "devnet" },
      args.artifact,
      args.program,
      input,
      approved,
    ),
  );
  assert.throws(
    () =>
      checkArtifactManifest(
        m,
        Buffer.alloc(args.artifact.length),
        args.program,
        input,
        approved,
      ),
    /hash differs/,
  );
  assert.throws(
    () => checkArtifactManifest(m, args.artifact, args.payer, input, approved),
    /program differs/,
  );
  assert.throws(
    () =>
      checkArtifactManifest(
        m,
        args.artifact,
        args.program,
        Buffer.from(input.toString() + " "),
        approved,
      ),
    /public inputs differ/,
  );
  assert.throws(
    () =>
      checkArtifactManifest(
        { ...m, dbcConfig: args.payer.toBase58() },
        args.artifact,
        args.program,
        input,
        approved,
      ),
    /DBC pin differs/,
  );
});
test("replacing both ELF and its manifest cannot replace the independently approved RC", async (t) => {
  const { m, input, approved } = await manifestFixture(t);
  const replaced = Buffer.from(args.artifact);
  replaced[replaced.length - 1] ^= 1;
  const forged = {
    ...m,
    artifact: { bytes: replaced.length, sha256: sha256(replaced) },
  };
  assert.throws(
    () =>
      checkArtifactManifest(forged, replaced, args.program, input, approved),
    /ELF hash differs from the independently approved RC/,
  );
});
test("manifest commit, source tree and lock hash must match the approved Git commit", async (t) => {
  const { m, input, approved } = await manifestFixture(t);
  for (const [field, invalid, message] of [
    ["commit", null, /Manifest commit differs/],
    ["commit", "0".repeat(40), /Manifest commit differs/],
    ["commit", "f".repeat(40), /Manifest commit differs/],
    ["tree", "f".repeat(40), /Manifest tree differs/],
    ["tree", undefined, /Manifest tree differs/],
    ["cargoLockSha256", "f".repeat(64), /Manifest Cargo.lock hash differs/],
    ["cargoLockSha256", undefined, /Manifest Cargo.lock hash differs/],
  ]) {
    assert.throws(
      () =>
        checkArtifactManifest(
          { ...m, [field]: invalid },
          args.artifact,
          args.program,
          input,
          approved,
        ),
      message,
    );
  }
});
test("approved source evidence rejects a modified local Cargo.lock", async (t) => {
  const { approved, directory } = await manifestFixture(t);
  await writeFile(join(directory, "Cargo.lock"), "version = 3\n");
  await assert.rejects(
    readApprovedRelease(approved.commit, approved.elfSha256, directory),
    /Local Cargo.lock differs from the approved RC commit/,
  );
});
test("manifest validation never uses the manifest itself as the RC approval", async (t) => {
  const { m, input, approved } = await manifestFixture(t);
  for (const invalid of [
    undefined,
    { ...approved, commit: null },
    { ...approved, commit: "0".repeat(40) },
    { ...approved, commit: approved.commit.slice(0, 7) },
    { ...approved, elfSha256: undefined },
    { ...approved, elfSha256: "0".repeat(64) },
  ]) {
    assert.throws(
      () =>
        checkArtifactManifest(m, args.artifact, args.program, input, invalid),
      /--approved-/,
    );
  }
});
test("both mainnet commands reject missing or null RC pins before any file or RPC read", async () => {
  for (const command of ["budget", "verify"]) {
    const base = [
      command,
      "--cluster",
      "mainnet",
      "--rpc",
      "not-an-rpc-url",
      "--artifact",
      "/missing-onepercent-rc.so",
      "--program",
      args.program.toBase58(),
    ];
    for (const [extra, message] of [
      [[], /--approved-commit/],
      [["--approved-commit", "0".repeat(40)], /--approved-commit/],
      [["--approved-commit", "f".repeat(40)], /--approved-elf-sha256/],
    ]) {
      await assert.rejects(main([...base, ...extra]), message);
    }
  }
});
test("deployment fee count includes exact upload chunking and omits zero chunks like the CLI", () => {
  const m = deploymentMessages(args);
  assert.equal(m.initial.header.numRequiredSignatures, 2);
  assert.equal(m.write.header.numRequiredSignatures, 1);
  assert.equal(m.final.header.numRequiredSignatures, 2);
  assert.equal(m.writeCount, Math.ceil(args.artifact.length / m.chunkSize));
  assert.equal(
    deploymentMessages({ ...args, artifact: Buffer.alloc(2300) }).writeCount,
    0,
  );
  assert.throws(() => deploymentMessages({ ...args, buffer: args.payer }));
});
test("budget uses live RPC rent, never double-counts the prefunded ProgramData and uses RPC fees", async () => {
  const sizes = [];
  const rpc = {
    async getMinimumBalanceForRentExemption(size) {
      sizes.push(size);
      return 7 * size + 33;
    },
    async getLatestBlockhash() {
      return { blockhash: args.blockhash };
    },
    async getFeeForMessage(message) {
      return { value: 900 * message.header.numRequiredSignatures };
    },
  };
  const b = await deploymentBudget(rpc, args);
  assert.deepEqual(sizes, [36, 45 + 4096, 37 + 2300]);
  assert.equal(b.bufferFundingLamports, b.rent.programData.lamports);
  const retained = b.rent.program.lamports + b.rent.programData.lamports;
  assert.equal(b.deploymentRentLamports, String(retained));
  assert.equal(
    b.requiredFirstAttemptLamports,
    String(retained + 3600 + b.uploadTransactions * 900),
  );
  await assert.rejects(
    deploymentBudget(
      { ...rpc, getFeeForMessage: async () => ({ value: null }) },
      args,
    ),
    /fee unavailable/,
  );
});
test("hash verification binds authority and rejects modified bytes, short data and hidden trailing bytes", () => {
  const data = Buffer.alloc(45 + args.maxLen);
  data.writeUInt32LE(3);
  data.writeBigUInt64LE(123n, 4);
  data[12] = 1;
  args.payer.toBuffer().copy(data, 13);
  args.artifact.copy(data, 45);
  const account = { owner: LOADER, data, executable: false };
  assert.equal(
    assertDeploymentBytes(account, args.program, args.artifact, args.payer)
      .deploymentSlot,
    "123",
  );
  assert.throws(
    () => assertDeploymentBytes(account, args.program, args.artifact, pub(9)),
    /authority/,
  );
  data[data.length - 1] = 1;
  assert.throws(
    () =>
      assertDeploymentBytes(account, args.program, args.artifact, args.payer),
    /Nonzero/,
  );
  data[data.length - 1] = 0;
  data[45] ^= 1;
  assert.throws(
    () =>
      assertDeploymentBytes(account, args.program, args.artifact, args.payer),
    /ELF differs/,
  );
  assert.throws(() => validateCapacity(200, 100));
  assert.throws(() => validateCapacity(200, 10 * 1024 * 1024));
});
