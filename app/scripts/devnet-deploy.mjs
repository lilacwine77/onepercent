import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  rpc,
  payer,
  program,
  send as sessionSend,
  key,
  requireBalance,
  journal,
  save,
  profile,
} from "./devnet-session.mjs";

import { utils } from "@anchor-lang/core";
import { p3UpgradeGuard } from "./devnet-upgrade-preflight.mjs";
import { launchPriorityPrice } from "../packages/cli/dist/launch/landing.js";

const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const programData = PublicKey.findProgramAddressSync(
  [program.publicKey.toBuffer()],
  loader,
)[0];
const release = spawnSync(
  process.execPath,
  ["scripts/program-release-check.mjs", "--cluster", "devnet"],
  { stdio: "inherit" },
);
assert.equal(
  release.status,
  0,
  "Devnet feature and compiled identity check failed",
);
const elf = readFileSync("target/deploy/onepercent.so");
assert(
  elf.includes(program.publicKey.toBuffer()),
  "ELF does not contain the compiled devnet program ID",
);
const { values: args } = parseArgs({
  options: {
    upgrade: { type: "boolean" },
    "expected-sha256": { type: "string" },
  },
  strict: true,
});
const hash = createHash("sha256").update(elf).digest("hex");
const expectedHash = args.upgrade
  ? args["expected-sha256"]
  : "1f58027ccd8836d4d72141c395dae46a8de5e73cc31389b3cb0a351f7434d937";
assert(
  typeof expectedHash === "string" && /^[a-f0-9]{64}$/.test(expectedHash),
  "Upgrade requires --expected-sha256 reviewed before sending",
);
assert.equal(hash, expectedHash, "Artifact differs from reviewed hash");
const maxLen = 1966080;
assert(
  elf.length <= maxLen,
  "Artifact exceeds provisioned capacity; stop before uploading",
);
const existing = await rpc.getAccountInfo(program.publicKey);
const priorData = existing ? await rpc.getAccountInfo(programData) : null;
if (existing) {
  assert(existing.executable && existing.owner.equals(loader));
  assert(
    priorData?.owner.equals(loader) && priorData.data.length === maxLen + 45,
  );
  assert.equal(priorData.data[12], 1);
  assert(
    new PublicKey(priorData.data.subarray(13, 45)).equals(payer.publicKey),
    "Upgrade authority mismatch",
  );
}
const prefix = existing
  ? `upgrade/${hash}/${priorData.data.readBigUInt64LE(4)}/`
  : "";
const labelFor = (name) => `${prefix}${name}`;
const send = (label, ...rest) => sessionSend(labelFor(label), ...rest);
const needsUpload =
  !existing ||
  (args.upgrade && !priorData.data.subarray(45, 45 + elf.length).equals(elf));
// P3 resume state must survive a changed ProgramData deployment slot.
const p3Label = `p3/${hash}`;
const p3State = args.upgrade && existing ? (journal[p3Label] ??= {}) : null;
const p3 = p3State
  ? p3UpgradeGuard({
      connection: rpc,
      programId: program.publicKey,
      payer,
      state: p3State,
      save,
      send: async (label, ...rest) => {
        const fullLabel = `${p3Label}/${label}`;
        await sessionSend(fullLabel, ...rest);
        return journal[fullLabel];
      },
    })
  : null;
if (p3) {
  assert(
    !p3State.activated || !needsUpload,
    "Activated artifact no longer matches deployed program",
  );
  await p3.prepare();
}
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
const meta = (pubkey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});
const ix = (tag, keys, data = Buffer.alloc(0)) =>
  new TransactionInstruction({
    programId: loader,
    keys,
    data: Buffer.concat([u32(tag), data]),
  });
const bufferPath = `${homedir()}/.config/solana/onepercent-devnet-deployment-buffer.json`;
if (!existsSync(bufferPath))
  writeFileSync(bufferPath, JSON.stringify([...Keypair.generate().secretKey]), {
    mode: 0o600,
    flag: "wx",
  });
const buffer = key(bufferPath);
if (needsUpload) {
  const rents = await Promise.all(
    [36, maxLen + 45, elf.length + 37].map((n) =>
      rpc.getMinimumBalanceForRentExemption(n),
    ),
  );
  // Include the final loader transaction at the devnet profile's full CU price cap.
  const finalPriorityBound = Number(
    (1_400_000n * profile.maxComputeUnitPriceMicroLamports + 999_999n) /
      1_000_000n,
  );
  // Simultaneous rents, upload fees, final priority bound and 0.1 SOL reserve.
  const uploadFeeBound = (Math.ceil(elf.length / 800) + 2) * 15000;
  await requireBalance(
    (existing
      ? Math.max(0, rents[1] - priorData.lamports)
      : rents[0] + rents[1]) +
      ((await rpc.getAccountInfo(buffer.publicKey)) ? 0 : rents[2]) +
      uploadFeeBound +
      finalPriorityBound +
      100_000_000,
  );
  await send(
    "buffer-create",
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: buffer.publicKey,
        space: elf.length + 37,
        lamports: rents[2],
        programId: loader,
      }),
      ix(0, [meta(buffer.publicKey, true), meta(payer.publicKey)]),
    ],
    [payer, buffer],
    { units: 10000 },
  );
  const currentBuffer = await rpc.getAccountInfo(buffer.publicKey);
  const offsets = Array.from(
    { length: Math.ceil(elf.length / 800) },
    (_, i) => i * 800,
  ).filter(
    (offset) =>
      !currentBuffer.data
        .subarray(37 + offset, 37 + Math.min(offset + 800, elf.length))
        .equals(elf.subarray(offset, offset + 800)),
  );
  console.log(
    JSON.stringify({
      buffer: buffer.publicKey.toBase58(),
      remainingChunks: offsets.length,
    }),
  );
  // Bounded batches share a blockhash, but each signed send samples its own price.
  // RPC preflight simulates every write; confirmations are read as a batch.
  // Ten writes keep RPC preflight and per-send priority sampling inside the
  // shared blockhash lifetime even when the public endpoint briefly slows down.
  const uploadBatchSize = 10;
  for (
    let batchStart = 0;
    batchStart < offsets.length;
    batchStart += uploadBatchSize
  ) {
    const batch = offsets.slice(batchStart, batchStart + uploadBatchSize);
    const latest = await rpc.getLatestBlockhash("confirmed");
    await Promise.all(
      batch.map(async (offset) => {
        const label = labelFor(`upload/${offset}`);
        let entry = journal[label];
        if (entry) {
          const status = (
            await rpc.getSignatureStatuses([entry.signature], {
              searchTransactionHistory: true,
            })
          ).value[0];
          assert(!status?.err, `Upload failed: ${offset}`);
          if (status) return;
          if (
            (await rpc.getBlockHeight("finalized")) > entry.lastValidBlockHeight
          ) {
            assert.equal(
              (
                await rpc.getSignatureStatuses([entry.signature], {
                  searchTransactionHistory: true,
                })
              ).value[0],
              null,
            );
            journal[`expired/${label}/${entry.signature}`] = {
              ...entry,
              expired: true,
            };
            delete journal[label];
            save();
            entry = undefined;
          }
        }
        if (!entry) {
          const chunk = elf.subarray(offset, offset + 800);
          const instruction = ix(
            1,
            [meta(buffer.publicKey, true), meta(payer.publicKey, false, true)],
            Buffer.concat([u32(offset), u64(chunk.length), chunk]),
          );
          const written = [payer.publicKey, buffer.publicKey].sort((a, b) =>
            a.toBase58().localeCompare(b.toBase58()),
          );
          const price = launchPriorityPrice(
            await rpc.getRecentPrioritizationFees({
              lockedWritableAccounts: written,
            }),
            profile.maxComputeUnitPriceMicroLamports,
          );
          const tx = new VersionedTransaction(
            new TransactionMessage({
              payerKey: payer.publicKey,
              recentBlockhash: latest.blockhash,
              instructions: [
                ComputeBudgetProgram.setComputeUnitLimit({ units: 10000 }),
                ComputeBudgetProgram.setComputeUnitPrice({
                  microLamports: price,
                }),
                instruction,
              ],
            }).compileToV0Message(),
          );
          assert(tx.serialize().length <= 1232);
          tx.sign([payer]);
          entry = journal[label] = {
            signature: utils.bytes.bs58.encode(tx.signatures[0]),
            raw: Buffer.from(tx.serialize()).toString("base64"),
            lastValidBlockHeight: latest.lastValidBlockHeight,
            microLamports: price.toString(),
            sampledAccounts: written.map(String),
          };
          save();
        }
        try {
          await rpc.sendRawTransaction(Buffer.from(entry.raw, "base64"), {
            skipPreflight: false,
            preflightCommitment: "confirmed",
            maxRetries: 3,
          });
        } catch {
          /* The persisted signature is reconciled below. */
        }
      }),
    );
    let complete = false;
    for (let poll = 0; poll < 120; poll++) {
      const statuses = (
        await rpc.getSignatureStatuses(
          batch.map(
            (offset) => journal[labelFor(`upload/${offset}`)].signature,
          ),
          { searchTransactionHistory: true },
        )
      ).value;
      complete = true;
      for (let i = 0; i < batch.length; i++) {
        const entry = journal[labelFor(`upload/${batch[i]}`)],
          status = statuses[i];
        assert(!status?.err, `Upload transaction failed at ${batch[i]}`);
        if (
          status &&
          ["confirmed", "finalized"].includes(status.confirmationStatus)
        ) {
          entry.slot = status.slot;
          entry.finalized = status.confirmationStatus === "finalized";
          continue;
        }
        complete = false;
        if (!status) {
          assert(
            (await rpc.getBlockHeight("confirmed")) <=
              entry.lastValidBlockHeight,
            `Expired upload ${batch[i]}; rerun to reconcile`,
          );
          try {
            await rpc.sendRawTransaction(Buffer.from(entry.raw, "base64"), {
              skipPreflight: false,
              preflightCommitment: "confirmed",
              maxRetries: 3,
            });
          } catch {
            /* Reconcile the persisted signature on the next pass. */
          }
        }
      }
      save();
      if (complete) break;
      await delay(500);
    }
    assert(complete, "Upload confirmation pending; rerun to reconcile");
    console.log(
      `Uploaded ${Math.min(batchStart + uploadBatchSize, offsets.length)}/${offsets.length} remaining chunks`,
    );
  }
  const lastSlot = Math.max(
    ...Object.entries(journal)
      .filter(([k]) => k.startsWith(labelFor("upload/")))
      .map(([, v]) => v.slot ?? 0),
  );
  while ((await rpc.getSlot()) < lastSlot) await delay(1000);
  const uploaded = await rpc.getAccountInfo(buffer.publicKey);
  assert(uploaded?.data.subarray(37).equals(elf), "Buffer bytes mismatch");
  if (existing) {
    const topup = Math.max(0, rents[1] - priorData.lamports);
    await p3.beforeBroadcast();
    await send(
      "upgrade",
      [
        ...(topup
          ? [
              SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: programData,
                lamports: topup,
              }),
            ]
          : []),
        ix(3, [
          meta(programData, true),
          meta(program.publicKey, true),
          meta(buffer.publicKey, true),
          meta(payer.publicKey, true),
          meta(SYSVAR_RENT_PUBKEY),
          meta(SYSVAR_CLOCK_PUBKEY),
          meta(payer.publicKey, false, true),
        ]),
      ],
      [payer],
      { beforeBroadcast: p3.beforeBroadcast },
    );
  } else {
    await send(
      "deploy",
      [
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: program.publicKey,
          lamports: rents[0],
          space: 36,
          programId: loader,
        }),
        ix(
          2,
          [
            meta(payer.publicKey, true, true),
            meta(programData, true),
            meta(program.publicKey, true),
            meta(buffer.publicKey, true),
            meta(SYSVAR_RENT_PUBKEY),
            meta(SYSVAR_CLOCK_PUBKEY),
            meta(SystemProgram.programId),
            meta(payer.publicKey, false, true),
          ],
          u64(maxLen),
        ),
      ],
      [payer, program],
    );
  }
}
const data = await rpc.getAccountInfo(programData);
assert(data?.owner.equals(loader));
assert.equal(data.data.length, maxLen + 45);
assert.equal(data.data.readUInt32LE(0), 3);
assert.equal(data.data[12], 1);
assert(new PublicKey(data.data.subarray(13, 45)).equals(payer.publicKey));
assert(data.data.subarray(45, 45 + elf.length).equals(elf));
assert(data.data.subarray(45 + elf.length).every((x) => x === 0));
if (p3) await p3.activate(Number(data.data.readBigUInt64LE(4)));
const result = {
  program: program.publicKey.toBase58(),
  programData: programData.toBase58(),
  authority: payer.publicKey.toBase58(),
  slot: Number(data.data.readBigUInt64LE(4)),
  maxLen,
  sha256: createHash("sha256").update(elf).digest("hex"),
  balance: await rpc.getBalance(payer.publicKey),
  buffer: buffer.publicKey.toBase58(),
  bufferBalance: await rpc.getBalance(buffer.publicKey),
};
writeFileSync(
  args.upgrade
    ? "reports/devnet/upgrade.json"
    : "reports/devnet/deployment.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
