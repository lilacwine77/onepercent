// Read-only deployment evidence. No key loading, signing or transaction submission.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { PROGRAM_IDS } from "./anchor-cluster.mjs";
import { assertReleaseElf, sha256 } from "./program-release-build.mjs";

export const LOADER = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const GENESIS = {
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
};
function assertApprovedReference(approved) {
  assert(
    typeof approved?.commit === "string" &&
      /^[0-9a-f]{40}$/.test(approved.commit) &&
      approved.commit !== "0".repeat(40),
    "--approved-commit requires the nonzero full commit of the independently approved RC",
  );
  assert(
    typeof approved?.elfSha256 === "string" &&
      /^[0-9a-f]{64}$/.test(approved.elfSha256) &&
      approved.elfSha256 !== "0".repeat(64),
    "--approved-elf-sha256 requires the independently approved RC ELF SHA-256",
  );
}
export async function readApprovedRelease(
  commit,
  elfSha256,
  directory = fileURLToPath(new URL("../", import.meta.url)),
) {
  assertApprovedReference({ commit, elfSha256 });
  const git = (...args) =>
    execFileSync("git", ["--no-replace-objects", ...args], {
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
    });
  assert.equal(
    git("rev-parse", "--verify", `${commit}^{commit}`).toString().trim(),
    commit,
    "Approved RC must identify a commit object",
  );
  const tree = git("rev-parse", `${commit}^{tree}`).toString().trim();
  const cargoLockSha256 = sha256(git("show", `${commit}:app/Cargo.lock`));
  assert.equal(
    sha256(await readFile(join(directory, "Cargo.lock"))),
    cargoLockSha256,
    "Local Cargo.lock differs from the approved RC commit",
  );
  return { commit, elfSha256, tree, cargoLockSha256 };
}
export function checkArtifactManifest(
  manifest,
  artifact,
  program,
  inputBytes,
  approved,
) {
  assertApprovedReference(approved);
  assert.match(approved.tree, /^[0-9a-f]{40}$/);
  assert.match(approved.cargoLockSha256, /^[0-9a-f]{64}$/);
  assert.equal(
    manifest.commit,
    approved.commit,
    "Manifest commit differs from the approved RC",
  );
  assert.equal(
    manifest.tree,
    approved.tree,
    "Manifest tree differs from the approved RC commit",
  );
  assert.equal(
    manifest.cargoLockSha256,
    approved.cargoLockSha256,
    "Manifest Cargo.lock hash differs from the approved RC commit",
  );
  assert.equal(
    sha256(artifact),
    approved.elfSha256,
    "ELF hash differs from the independently approved RC",
  );
  const input = JSON.parse(inputBytes.toString("utf8"));
  assert.equal(
    manifest.publicInputSha256,
    sha256(inputBytes),
    "Manifest public inputs differ from this release",
  );
  assert.equal(manifest.dbcConfig, input.dbcConfig, "Manifest DBC pin differs");
  assert.equal(
    input.programId,
    program.toBase58(),
    "Public input program differs",
  );
  assert.equal(
    manifest.cluster,
    "mainnet",
    "Manifest is not a mainnet release",
  );
  assert.equal(
    manifest.programId,
    program.toBase58(),
    "Manifest program differs from release pin",
  );
  assert.equal(
    manifest.artifact?.bytes,
    artifact.length,
    "Manifest byte length differs",
  );
  assert.equal(
    manifest.artifact?.sha256,
    sha256(artifact),
    "Manifest hash differs",
  );
  assert.deepEqual(
    manifest.toolchain?.features,
    ["mainnet"],
    "Manifest features differ",
  );
  assert.equal(
    manifest.reproduction?.independentBuilds,
    2,
    "Missing independent release builds",
  );
  assert.equal(
    manifest.reproduction?.byteIdentical,
    true,
    "Release builds were not identical",
  );
}
const meta = (pubkey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const ix = (tag, keys, data = Buffer.alloc(0)) =>
  new TransactionInstruction({
    programId: LOADER,
    keys,
    data: Buffer.concat([u32(tag), data]),
  });
export function validateCapacity(artifactBytes, maxLen) {
  assert(
    Number.isSafeInteger(maxLen) &&
      maxLen >= artifactBytes &&
      maxLen <= 10 * 1024 * 1024,
    "--max-len must fit the ELF and Solana's 10 MiB account limit",
  );
  assert(
    maxLen + 45 <= 10 * 1024 * 1024,
    "ProgramData capacity exceeds the account limit",
  );
  return { program: 36, programData: 45 + maxLen, buffer: 37 + artifactBytes };
}
export function assertDeploymentBytes(account, programId, artifact, authority) {
  assert(
    account?.owner.equals(LOADER) && !account.executable,
    "Invalid ProgramData owner or executable flag",
  );
  const data = account.data;
  assert(
    data.length >= 45 && data.readUInt32LE(0) === 3,
    "Invalid ProgramData layout",
  );
  assert.equal(
    data[12],
    1,
    "Program is immutable; founder upgrade authority required",
  );
  const actualAuthority = new PublicKey(data.subarray(13, 45));
  assert(
    actualAuthority.equals(authority),
    "Upgrade authority differs from expected wallet",
  );
  const bytes = data.subarray(45);
  assert(
    bytes.length >= artifact.length &&
      bytes.subarray(0, artifact.length).equals(artifact),
    "Deployed ELF differs from release artifact",
  );
  assert(
    bytes.subarray(artifact.length).every((b) => b === 0),
    "Nonzero bytes beyond the release ELF",
  );
  return {
    programId: programId.toBase58(),
    authority: actualAuthority.toBase58(),
    deploymentSlot: data.readBigUInt64LE(4).toString(),
    capacity: bytes.length,
    artifactBytes: artifact.length,
    sha256: sha256(bytes.subarray(0, artifact.length)),
    paddingIsZero: true,
  };
}
/** Mirrors Agave v4.3.0 cli/src/program.rs, clean initial deploy, payer = authority,
 * explicit compute price zero. Simulated CU limits do not change that fee.
 */
export function deploymentMessages({
  payer,
  buffer,
  program,
  artifact,
  maxLen,
  blockhash,
  programRent,
  programDataRent,
}) {
  assert(
    new Set([payer, buffer, program].map(String)).size === 3,
    "Payer, buffer and program must differ",
  );
  validateCapacity(artifact.length, maxLen);
  const compile = (instructions) =>
    new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(
      ...instructions,
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    );
  const write = (offset, bytes) =>
    compile([
      ix(
        1,
        [meta(buffer, true), meta(payer, false, true)],
        Buffer.concat([u32(offset), u64(bytes.length), bytes]),
      ),
    ]);
  const baseline = write(0, Buffer.alloc(0));
  const chunkSize =
    1232 -
    baseline.serialize({ requireAllSignatures: false, verifySignatures: false })
      .length -
    1;
  let writeCount = 0;
  for (let offset = 0; offset < artifact.length; offset += chunkSize)
    if (artifact.subarray(offset, offset + chunkSize).some((b) => b !== 0))
      writeCount++;
  const initial = compile([
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: buffer,
      lamports: programDataRent,
      space: 37 + artifact.length,
      programId: LOADER,
    }),
    ix(0, [meta(buffer, true), meta(payer)]),
  ]);
  const programData = PublicKey.findProgramAddressSync(
    [program.toBuffer()],
    LOADER,
  )[0];
  const final = compile([
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: program,
      lamports: programRent,
      space: 36,
      programId: LOADER,
    }),
    ix(
      2,
      [
        meta(payer, true, true),
        meta(programData, true),
        meta(program, true),
        meta(buffer, true),
        meta(SYSVAR_RENT_PUBKEY),
        meta(SYSVAR_CLOCK_PUBKEY),
        meta(SystemProgram.programId),
        meta(payer, false, true),
      ],
      u64(maxLen),
    ),
  ]);
  return {
    initial: initial.compileMessage(),
    write: baseline.compileMessage(),
    final: final.compileMessage(),
    chunkSize,
    writeCount,
  };
}
export async function deploymentBudget(rpc, args) {
  const sizes = validateCapacity(args.artifact.length, args.maxLen);
  const rent = {};
  for (const [name, bytes] of Object.entries(sizes)) {
    const lamports = await rpc.getMinimumBalanceForRentExemption(
      bytes,
      "finalized",
    );
    assert(
      Number.isSafeInteger(lamports) && lamports >= 0,
      "Unsafe RPC rent value",
    );
    rent[name] = { bytes, lamports };
  }
  const { blockhash } = await rpc.getLatestBlockhash("finalized");
  const messages = deploymentMessages({
    ...args,
    blockhash,
    programRent: rent.program.lamports,
    programDataRent: rent.programData.lamports,
  });
  const fee = {};
  for (const name of ["initial", "write", "final"]) {
    const result = await rpc.getFeeForMessage(messages[name], "finalized");
    assert(
      Number.isSafeInteger(result.value) && result.value >= 0,
      "RPC fee unavailable; retry with a fresh blockhash",
    );
    fee[name] = result.value;
  }
  const totalFees =
    BigInt(fee.initial) +
    BigInt(fee.write) * BigInt(messages.writeCount) +
    BigInt(fee.final);
  // Initial deploy moves the prefunded buffer balance to ProgramData. It does
  // not require both rent amounts simultaneously from the payer.
  const retained =
    BigInt(rent.program.lamports) + BigInt(rent.programData.lamports);
  return {
    artifactBytes: args.artifact.length,
    sha256: sha256(args.artifact),
    maxLen: args.maxLen,
    rent,
    bufferFundingLamports: rent.programData.lamports,
    deploymentRentLamports: retained.toString(),
    uploadChunkBytes: messages.chunkSize,
    uploadTransactions: messages.writeCount,
    fees: {
      ...fee,
      totalLamports: totalFees.toString(),
      computeUnitPriceMicroLamports: 0,
    },
    requiredFirstAttemptLamports: (retained + totalFees).toString(),
    scope:
      "New program and buffer; payer is upgrade authority; --with-compute-unit-price 0 --max-sign-attempts 1. Excludes init, DBC, LUT, token purchase and retries.",
  };
}
export async function main(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: Object.fromEntries(
      [
        "cluster",
        "rpc",
        "artifact",
        "max-len",
        "program",
        "payer",
        "buffer",
        "authority",
        "approved-commit",
        "approved-elf-sha256",
        "out",
      ].map((k) => [k, { type: "string" }]),
    ),
  });
  assert(
    positionals.length === 1 && ["budget", "verify"].includes(positionals[0]),
    "Use budget or verify",
  );
  const cluster = values.cluster;
  assert(
    ["mainnet", "devnet", "localnet"].includes(cluster),
    "Explicit --cluster required",
  );
  assert(
    values.rpc && values.artifact && values.program,
    "--rpc, --artifact and --program required",
  );
  const approved =
    cluster === "mainnet"
      ? await readApprovedRelease(
          values["approved-commit"],
          values["approved-elf-sha256"],
        )
      : undefined;
  const program = new PublicKey(values.program);
  assert.equal(
    program.toBase58(),
    PROGRAM_IDS[cluster],
    "Program differs from selected release pin (or pin is PENDING)",
  );
  const artifact = await readFile(values.artifact);
  assertReleaseElf(artifact);
  if (cluster === "mainnet") {
    const { checkMainnetRelease } = await import("./mainnet-release.mjs");
    await checkMainnetRelease();
    checkArtifactManifest(
      JSON.parse(
        await readFile(join(dirname(values.artifact), "manifest.json"), "utf8"),
      ),
      artifact,
      program,
      await readFile(new URL("../release/mainnet.json", import.meta.url)),
      approved,
    );
  }
  const rpc = new Connection(values.rpc, {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
  });
  const genesis = await rpc.getGenesisHash();
  if (cluster === "localnet") {
    assert(
      ["127.0.0.1", "localhost", "[::1]"].includes(
        new URL(values.rpc).hostname,
      ) && !Object.values(GENESIS).includes(genesis),
      "Localnet requires loopback and a test genesis",
    );
  } else assert.equal(genesis, GENESIS[cluster], "Cluster genesis mismatch");
  let result;
  if (positionals[0] === "budget") {
    assert(
      values.payer && values.buffer && values["max-len"],
      "--payer, --buffer, --max-len required",
    );
    const payer = new PublicKey(values.payer),
      buffer = new PublicKey(values.buffer);
    const existing = await rpc.getMultipleAccountsInfo([program, buffer]);
    assert(
      existing.every((a) => a === null),
      "Budget is only for new program and buffer accounts; reconcile a partial deployment first",
    );
    result = await deploymentBudget(rpc, {
      payer,
      buffer,
      program,
      artifact,
      maxLen: Number(values["max-len"]),
    });
  } else {
    assert(values.authority, "--authority required");
    const programData = PublicKey.findProgramAddressSync(
      [program.toBuffer()],
      LOADER,
    )[0];
    const snapshot = await rpc.getMultipleAccountsInfoAndContext(
      [program, programData],
      { commitment: "finalized" },
    );
    const executable = snapshot.value[0];
    assert(
      executable?.owner.equals(LOADER) &&
        executable.executable &&
        executable.data.length === 36 &&
        executable.data.readUInt32LE(0) === 2,
      "Invalid executable Program account",
    );
    assert(
      new PublicKey(executable.data.subarray(4)).equals(programData),
      "ProgramData address mismatch",
    );
    result = {
      finalizedSlot: snapshot.context.slot,
      ...assertDeploymentBytes(
        snapshot.value[1],
        program,
        artifact,
        new PublicKey(values.authority),
      ),
    };
  }
  const output =
    JSON.stringify({ cluster, genesis, ...result }, null, 2) + "\n";
  if (values.out) await writeFile(values.out, output);
  console.log(output.trim());
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main(process.argv.slice(2));
