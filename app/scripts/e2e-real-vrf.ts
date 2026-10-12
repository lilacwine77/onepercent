import { DEVNET_GENESIS_HASH } from "../packages/config/src/genesis.js";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { ATTESTATIONS, VRF_QUEUES } from "../packages/config/src/index.js";
import {
  attestationExpiry,
  buildBuyPacksTransaction,
  EXTERNAL_IDS,
  holdMessage,
  programError,
} from "../packages/sdk/src/index.js";
import { PROGRAM_ID } from "../packages/sdk/tests/program-id.js";
import { runValidatorFlow } from "./e2e-validator.js";

const app = dirname(dirname(fileURLToPath(import.meta.url)));
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const align8 = (n: number) => Math.ceil(n / 8) * 8;
const sourceRevision = "52b103c5d55d72e07456a445044b3c006cb87c1a";
const source = `https://github.com/magicblock-labs/solana-vrf/blob/${sourceRevision}/api/src/state/queue.rs`;
interface Entry {
  offset: number;
  end: number;
  next: number;
  used: number;
  span: number;
}
function queueState(data: Buffer) {
  assert.equal(data.subarray(0, 8).toString("hex"), "0300000000000000");
  const body = data.subarray(8),
    count = body.readUInt32LE(0),
    cursor = body.readUInt32LE(4);
  assert(cursor <= body.length && cursor >= 16);
  const entries: Entry[] = [];
  let used = 0;
  for (let offset = 16; offset + 96 <= cursor;) {
    const discriminatorBytes = body.readUInt16LE(offset + 84),
      metas = body.readUInt16LE(offset + 86),
      argsBytes = body.readUInt16LE(offset + 88);
    const end = offset + 96 + discriminatorBytes + metas * 33 + argsBytes,
      next = align8(end);
    assert.equal(body.readUInt32LE(offset + 72), offset + 96);
    assert.equal(
      body.readUInt32LE(offset + 76),
      offset + 96 + discriminatorBytes,
    );
    assert.equal(body.readUInt32LE(offset + 80), end - argsBytes);
    assert(end <= body.length && next > offset);
    const active = body[offset + 91]!;
    assert(active === 0 || active === 1);
    used += active;
    entries.push({ offset, end, next, used: active, span: next - offset });
    offset = next;
  }
  assert.equal(
    used,
    count,
    "Queue schema/count mismatch; re-check the deployed interface",
  );
  return {
    itemCount: count,
    cursor,
    index: body[8]!,
    paused: body[9]!,
    dataBytes: data.length,
    bodyBytes: body.length,
    entries,
  };
}
function prefix(data: Buffer, keep: number) {
  const parsed = queueState(data),
    kept = parsed.entries.slice(0, keep),
    end = kept.at(-1)?.end ?? 16;
  const out = Buffer.from(data);
  out.fill(0, 8 + end);
  out.writeUInt32LE(
    kept.reduce((n, e) => n + e.used, 0),
    8,
  );
  out.writeUInt32LE(end, 12);
  return out;
}
function requestFits(data: Buffer) {
  const q = queueState(data),
    bytes = 96 + 8 + 4 * 33 + 8;
  return (
    q.bodyBytes - align8(q.cursor) >= bytes ||
    q.entries.some((e) => e.used === 0 && e.span === align8(bytes))
  );
}
interface SnapshotAccount {
  pubkey: string;
  account: {
    lamports: number;
    data: [string, string];
    owner: string;
    executable: boolean;
    rentEpoch: number;
  };
}
interface Sample {
  variant: string;
  deckLen: number;
  edition: number;
  qty: number;
  hold: boolean;
  feePayer: "buyer" | "sponsor";
  sample: number;
  success: boolean;
  units: number;
  vrfUnits: number | null;
  error: unknown;
  copyKey: string;
  failureLogs: string[];
}
const rows: Sample[] = [];
const directory = join(app, "target/real-vrf");
await mkdir(directory, { recursive: true, mode: 0o700 });
const endpoint = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
assert.equal(new URL(endpoint).protocol, "https:");
const remote = new Connection(endpoint, "confirmed");
assert.equal(await remote.getGenesisHash(), DEVNET_GENESIS_HASH);
const queueAddress = new PublicKey(VRF_QUEUES.devnetTest);
const snapshotResponse = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getAccountInfo",
    params: [
      queueAddress.toBase58(),
      { encoding: "base64", commitment: "confirmed" },
    ],
  }),
});
assert(snapshotResponse.ok);
const snapshotJson = await snapshotResponse.text();
const wire = JSON.parse(snapshotJson) as {
  error?: unknown;
  result: {
    context: { slot: number };
    value: {
      owner: string;
      lamports: number;
      data: [string, string];
      executable: boolean;
    };
  };
};
assert(!wire.error && wire.result.value);
const rentEpochLiteral = /"rentEpoch"\s*:\s*(\d+)/.exec(snapshotJson)?.[1];
assert(rentEpochLiteral && BigInt(rentEpochLiteral) <= 0xffffffffffffffffn);
const snapshot = {
  context: wire.result.context,
  value: {
    ...wire.result.value,
    owner: new PublicKey(wire.result.value.owner),
    data: Buffer.from(wire.result.value.data[0], "base64"),
  },
};
assert(snapshot.value?.owner.equals(EXTERNAL_IDS.magicblockVrf));
const queue = snapshot.value!;
const queueParsed = queueState(queue.data);
const program = await remote.getAccountInfo(
  EXTERNAL_IDS.magicblockVrf,
  "confirmed",
);
assert(program?.executable);
const programDataAddress = new PublicKey(program.data.subarray(4, 36));
const programData = await remote.getAccountInfo(
  programDataAddress,
  "confirmed",
);
assert(programData);
const elf = programData.data.subarray(45);
assert.equal(elf.subarray(0, 4).toString("hex"), "7f454c46");
const vrfPath = join(directory, "vrf.so");
await writeFile(vrfPath, elf);
const canonical = await readFile(join(app, "target/deploy/onepercent.so"));
assert.equal(canonical.readUInt32LE(48), 3);
const original: SnapshotAccount = {
  pubkey: queueAddress.toBase58(),
  account: {
    lamports: queue.lamports,
    data: [queue.data.toString("base64"), "base64"],
    owner: queue.owner.toBase58(),
    executable: queue.executable,
    rentEpoch: 0,
  },
};
// Keep the RPC's exact u64 integer; JSON.parse would round rentEpoch above 2^53.
const accountJson = (value: SnapshotAccount) =>
  JSON.stringify(value).replace(
    '"rentEpoch":0',
    `"rentEpoch":${rentEpochLiteral}`,
  );
await writeFile(join(directory, "queue-snapshot.json"), accountJson(original));
let maxFit = queueParsed.entries.length;
while (maxFit > 0 && !requestFits(prefix(queue.data, maxFit))) maxFit--;
const variants = [
  { name: "snapshot-exact", data: queue.data, transformation: "none" },
  ...[0, Math.floor(queueParsed.entries.length / 2), maxFit]
    .filter((n, i, a) => a.indexOf(n) === i)
    .map((n) => ({
      name: `controlled-prefix-${n}`,
      data: prefix(queue.data, n),
      transformation: `Local fixture only: retain first ${n} records; preserve allocation and record bytes`,
    })),
];
const report: { [key: string]: unknown } = {
  runtime:
    "solana-test-validator 4.3.0; local simulation with signature verification",
  devnetBuyPacksExecuted: false,
  source,
  sourceRevision,
  provenance: {
    recordedAt: new Date().toISOString(),
    queue: queueAddress.toBase58(),
    snapshotSlot: snapshot.context.slot,
    queueSha256: sha(queue.data),
    vrfProgram: EXTERNAL_IDS.magicblockVrf.toBase58(),
    programData: programDataAddress.toBase58(),
    deploymentSlot: programData.data.readBigUInt64LE(4).toString(),
    elfSha256: sha(elf),
    elfBytes: elf.length,
    elfFlags: elf.readUInt32LE(48),
    onepercentElfSha256: sha(canonical),
    onepercentElfBytes: canonical.length,
    onepercentElfFlags: canonical.readUInt32LE(48),
  },
  fixture: {
    source: "programs/onepercent/tests/export_fixtures.rs",
    signers:
      "Runtime-generated local fixture signers; 32 distinct buyers per variant and Deck size",
    seed: null,
  },
  occupancy: {
    ...queueParsed,
    entries: undefined,
    requiredRequestBytes: 244,
    requiredAlignedSpan: 248,
    requestFits: requestFits(queue.data),
  },
  variants: variants.map((v) => ({
    name: v.name,
    transformation: v.transformation,
    sha256: sha(v.data),
    ...queueState(v.data),
    entries: undefined,
    requestFits: requestFits(v.data),
  })),
  samples: rows,
};
const output = join(app, "fixtures/reports/real-vrf.json");
if (process.env.VRF_SNAPSHOT_ONLY === "1") {
  await writeFile(
    join(directory, "snapshot-metadata.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      state: "snapshot-only",
      provenance: report.provenance,
      occupancy: report.occupancy,
    }),
  );
} else {
  for (const variant of variants) {
    const queuePath = join(directory, `${variant.name}.json`);
    await writeFile(
      queuePath,
      accountJson({
        ...original,
        account: {
          ...original.account,
          data: [variant.data.toString("base64"), "base64"],
        },
      }),
    );
    for (const deckLen of [100, 120_000]) {
      await runValidatorFlow("rip", {
        deckLen,
        queueAddress: queueAddress.toBase58(),
        queueFile: queuePath,
        vrfArtifact: vrfPath,
        run: async (connection, manifest) => {
          const intake = Keypair.fromSecretKey(
            Uint8Array.from(manifest.wallets.intake.secretKey),
          );
          const sponsor = Keypair.fromSecretKey(
            Uint8Array.from(manifest.wallets.payer.secretKey),
          );
          const signingKey = createPrivateKey({
            key: Buffer.concat([
              Buffer.from("302e020100300506032b657004220420", "hex"),
              Buffer.from(intake.secretKey.subarray(0, 32)),
            ]),
            format: "der",
            type: "pkcs8",
          });
          for (const [sample, wallet] of manifest.buyers!.entries()) {
            const buyer = Keypair.fromSecretKey(
              Uint8Array.from(wallet.secretKey),
            );
            const clock = await connection.getAccountInfo(
              SYSVAR_CLOCK_PUBKEY,
              "confirmed",
            );
            assert(clock);
            const expiry = attestationExpiry(
              clock.data.readBigInt64LE(32),
              ATTESTATIONS.holdTtlSeconds,
            );
            for (const [edition, qty] of [
              [0, 1],
              [0, 10],
              [3, 5],
            ] as const)
              for (const hold of [false, true])
                for (const sponsored of [false, true]) {
                  const tx = buildBuyPacksTransaction(PROGRAM_ID, {
                    wallet: buyer.publicKey,
                    blockhash: (
                      await connection.getLatestBlockhash("confirmed")
                    ).blockhash,
                    edition,
                    qty,
                    pullNonce: 0,
                    oracleQueue: queueAddress,
                    hold: hold
                      ? {
                          expiry,
                          signer: intake.publicKey,
                          signature: sign(
                            null,
                            holdMessage({
                              programId: PROGRAM_ID,
                              wallet: buyer.publicKey,
                              expiry,
                            }),
                            signingKey,
                          ),
                        }
                      : undefined,
                  });
                  assert(tx instanceof Transaction);
                  // The SDK instruction shape is kept; only the measuring ceiling is raised to collect an untruncated total.
                  tx.instructions[0] = ComputeBudgetProgram.setComputeUnitLimit(
                    { units: 1_400_000 },
                  );
                  if (sponsored) {
                    tx.feePayer = sponsor.publicKey;
                    tx.sign(buyer, sponsor);
                  } else tx.sign(buyer);
                  const result = await connection.simulateTransaction(
                    VersionedTransaction.deserialize(tx.serialize()),
                    { sigVerify: true, commitment: "confirmed" },
                  );
                  const logs = result.value.logs ?? [];
                  const vrfLog = logs.find((line) =>
                    line.startsWith(
                      `Program ${EXTERNAL_IDS.magicblockVrf} consumed `,
                    ),
                  );
                  const match = vrfLog?.match(/consumed (\d+) of/);
                  const classified = programError(
                    { err: result.value.err, logs },
                    { programId: PROGRAM_ID, instruction: "buy_packs" },
                  );
                  assert(result.value.unitsConsumed !== undefined);
                  const row: Sample = {
                    variant: variant.name,
                    deckLen,
                    edition,
                    qty,
                    hold,
                    feePayer: sponsored ? "sponsor" : "buyer",
                    sample,
                    success: result.value.err === null,
                    units: result.value.unitsConsumed,
                    vrfUnits: match ? Number(match[1]) : null,
                    error: result.value.err,
                    copyKey:
                      result.value.err === null ? "none" : classified.copyKey,
                    failureLogs: logs.filter(
                      (line) =>
                        line.includes("failed") || line.includes("Error"),
                    ),
                  };
                  rows.push(row);
                  if (requestFits(variant.data))
                    assert(row.success, JSON.stringify(row));
                  else
                    assert(
                      !row.success &&
                        row.copyKey === "busy" &&
                        row.vrfUnits !== null,
                      JSON.stringify(row),
                    );
                }
          }
        },
      });
      console.log(
        JSON.stringify({
          variant: variant.name,
          deckLen,
          samples: rows.length,
        }),
      );
    }
  }
  const max = (many: boolean) =>
    Math.max(
      ...rows.filter((row) => row.qty > 1 === many).map((row) => row.units),
    );
  const measured = [max(false), max(true)];
  report.measured = { buyPacks: measured };
  report.limits = {
    buyPacks: {
      x1: Math.ceil((measured[0]! * 1.25) / 1000) * 1000,
      x10: Math.ceil((measured[1]! * 1.25) / 1000) * 1000,
    },
  };
  assert(measured.every((value) => value > 0 && value * 1.25 <= 1_400_000));
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      report: output,
      measured: report.measured,
      limits: report.limits,
      samples: rows.length,
    }),
  );
}
