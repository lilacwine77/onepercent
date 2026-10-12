import { DEVNET_GENESIS_HASH } from "../packages/config/dist/genesis.js";
// Public RPC reads only. Run before deployment and immediately after activation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";
import { PAUSE_BITS } from "../packages/config/dist/index.js";
import * as sdk from "../packages/sdk/dist/index.js";
import { createDevnetFetch } from "./devnet-fetch.mjs";

const PROGRAM = new PublicKey("DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr");
const PAYER = new PublicKey("DpMXTAcBPhEpNA2joqP6eEgJkfetjzRiQyVUfQoqZG93");
const TEST_USER = new PublicKey("77jH6NwGHobGetQYQPyJrmBz9bsrhaSKk86RmA3KFypG");
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const PROGRAM_DATA = PublicKey.findProgramAddressSync(
  [PROGRAM.toBuffer()],
  LOADER,
)[0];
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const json = (value) =>
  JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? item.toString() : item),
    2,
  );

export function p3Fields(data) {
  assert.equal(data.length, 3808, "Unexpected Machine length");
  return {
    last_reveal_ts: {
      offset: 2656,
      value: data.readBigInt64LE(2656).toString(),
    },
    sb_paid_prev_hour: {
      offset: 2664,
      value: data.readBigUInt64LE(2664).toString(),
    },
    keeper_history_version: {
      offset: 2672,
      value: data.readBigUInt64LE(2672).toString(),
    },
    keeper_history_started_ts: {
      offset: 2680,
      value: data.readBigInt64LE(2680).toString(),
    },
    bucket_history: Array.from({ length: 16 }, (_, index) => {
      const offset = 2688 + 24 * index;
      return {
        index,
        offset,
        listed_ts: data.readBigInt64LE(offset).toString(),
        sb_inflow_hour: data.readBigUInt64LE(offset + 8).toString(),
        sb_inflow_prev_hour: data.readBigUInt64LE(offset + 16).toString(),
      };
    }),
    unsettled_reveals: {
      offset: 3072,
      value: data.readBigUInt64LE(3072).toString(),
    },
  };
}

export function programDataEvidence(data, elfLength) {
  assert.equal(data.readUInt32LE(0), 3, "Invalid ProgramData variant");
  assert.equal(data[12], 1, "Upgrade authority must remain present");
  assert(
    Number.isSafeInteger(elfLength) &&
      elfLength > 0 &&
      data.length >= 45 + elfLength,
  );
  assert(
    data.subarray(45 + elfLength).every((byte) => byte === 0),
    "Nonzero bytes beyond the known ELF length",
  );
  return {
    deploymentSlot: data.readBigUInt64LE(4).toString(),
    authority: new PublicKey(data.subarray(13, 45)).toBase58(),
    elfLength,
    maxLen: data.length - 45,
    sha256: sha256(data.subarray(45, 45 + elfLength)),
  };
}

/** Activation changes only the conservative timestamp on this OnAir Machine.
 * Any phase, special-slot or hour transition requires separate review; it is
 * never silently omitted from the byte-preservation proof. */
export function compareAccounts(before, after) {
  assert.deepEqual(
    after.map(({ address }) => address),
    before.map(({ address }) => address),
    "Account inventory changed",
  );
  const changes = [];
  for (let index = 0; index < before.length; index++) {
    const old = before[index],
      current = after[index];
    assert.equal(current.kind, old.kind);
    assert.equal(current.bytes, old.bytes);
    assert.equal(
      current.lamports,
      old.lamports,
      `Lamports changed: ${old.address}`,
    );
    const left = Buffer.from(old.dataBase64, "base64"),
      right = Buffer.from(current.dataBase64, "base64");
    const changedOffsets = [...left.keys()].filter(
      (offset) => left[offset] !== right[offset],
    );
    if (old.kind === "Machine") {
      assert(
        left.subarray(2656, 3080).every((byte) => byte === 0),
        "Legacy P3 padding must be zero",
      );
      assert(right.readBigInt64LE(2656) > 0n, "P3 is not activated");
      left.fill(0, 2656, 2664);
      right.fill(0, 2656, 2664);
    } else if (old.kind === "Config") {
      left[741] &= ~PAUSE_BITS.rip;
      right[741] &= ~PAUSE_BITS.rip;
    }
    assert(
      left.equals(right),
      `Unexpected application bytes changed: ${old.kind} ${old.address}`,
    );
    if (changedOffsets.length)
      changes.push({ address: old.address, kind: old.kind, changedOffsets });
  }
  return { checkedAccounts: after.length, allowedChanges: changes };
}

function canonical(kind, state) {
  switch (kind) {
    case "Config":
      return sdk.configPda(PROGRAM)[0];
    case "Machine":
      return sdk.machinePda(PROGRAM)[0];
    case "Deck":
      return sdk.deckPda(PROGRAM)[0];
    case "Binder":
      return sdk.binderPda(PROGRAM, state.owner)[0];
    case "MintLedger":
      return sdk.ledgerPda(PROGRAM, state.mint)[0];
    case "Pull":
      return sdk.pullPda(PROGRAM, state.buyer, state.buyer_nonce)[0];
    default:
      throw Error(`Unsupported application account: ${kind}`);
  }
}

export async function snapshot(stage, { reconciled = false } = {}) {
  assert(!reconciled || stage === "after");
  assert(["before", "after"].includes(stage), "Expected before or after");
  const rpc = new Connection("https://api.devnet.solana.com", {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: createDevnetFetch(),
  });
  assert.equal(await rpc.getGenesisHash(), DEVNET_GENESIS_HASH, "Devnet only");
  const previousUpgrade = JSON.parse(
    readFileSync("fixtures/devnet/upgrade-1.json", "utf8"),
  );
  let before =
    stage === "after"
      ? JSON.parse(readFileSync("reports/devnet/upgrade2-before.json", "utf8"))
      : undefined;
  if (reconciled) {
    const { reconcile } = await import("./devnet-upgrade2-reconcile.mjs");
    const verified = await reconcile();
    const saved = JSON.parse(
      readFileSync("reports/devnet/upgrade2-reconciled-before.json", "utf8"),
    );
    assert.deepEqual(verified, saved, "Reconciliation evidence changed");
    before = verified;
  }
  const idl = JSON.parse(
    readFileSync("packages/sdk/src/idl/onepercent.json", "utf8"),
  );
  const result = await rpc.getProgramAccounts(PROGRAM, {
    commitment: "finalized",
    withContext: true,
    minContextSlot: before?.slot ?? 0,
  });
  const accounts = result.value
    .map(({ pubkey, account }) => {
      assert(account.owner.equals(PROGRAM));
      const kind = idl.accounts.find(({ discriminator }) =>
        Buffer.from(discriminator).equals(account.data.subarray(0, 8)),
      )?.name;
      const decode = sdk[`decode${kind}`];
      assert.equal(typeof decode, "function", `Missing decoder: ${kind}`);
      const state = decode(account.data);
      assert(pubkey.equals(canonical(kind, state)), `Noncanonical ${kind}`);
      const row = {
        address: pubkey.toBase58(),
        kind,
        bytes: account.data.length,
        lamports: account.lamports,
        sha256: sha256(account.data),
        dataBase64: account.data.toString("base64"),
        state,
      };
      if (kind === "Machine") {
        row.p3 = p3Fields(account.data);
        for (const [field, raw] of Object.entries(row.p3)) {
          if (field === "bucket_history")
            assert.equal(
              json(state[field]),
              json(
                raw.map(
                  ({ listed_ts, sb_inflow_hour, sb_inflow_prev_hour }) => ({
                    listed_ts,
                    sb_inflow_hour,
                    sb_inflow_prev_hour,
                  }),
                ),
              ),
            );
          else
            assert.equal(
              String(state[field]),
              raw.value,
              `SDK/raw mismatch: ${field}`,
            );
        }
      }
      return row;
    })
    .sort((a, b) => a.address.localeCompare(b.address));
  assert.equal(accounts.filter(({ kind }) => kind === "Machine").length, 1);
  assert.equal(
    accounts.filter(({ kind }) => kind === "Pull").length,
    0,
    "Pull must be drained before snapshots",
  );
  const reads = await rpc.getMultipleAccountsInfoAndContext(
    [PROGRAM, PROGRAM_DATA, PAYER, TEST_USER],
    { commitment: "finalized", minContextSlot: result.context.slot },
  );
  const [program, pd, payer, testUser] = reads.value;
  assert(
    program?.owner.equals(LOADER) &&
      program.executable &&
      program.data.readUInt32LE(0) === 2,
  );
  assert(new PublicKey(program.data.subarray(4, 36)).equals(PROGRAM_DATA));
  assert(pd?.owner.equals(LOADER) && payer && testUser);
  const elf =
    stage === "after" ? readFileSync("target/deploy/onepercent.so") : undefined;
  const deployment = programDataEvidence(
    pd.data,
    elf?.length ?? previousUpgrade.elfBytes,
  );
  assert.equal(deployment.authority, PAYER.toBase58());
  assert.equal(
    deployment.sha256,
    elf ? sha256(elf) : previousUpgrade.hashAfter,
    "Deployed ELF hash mismatch",
  );
  const machine = accounts.find(({ kind }) => kind === "Machine");
  assert.equal(machine.state.pending_pulls, 0n);
  assert.equal(machine.state.unsettled_reveals, 0n);
  if (stage === "before")
    assert(
      Buffer.from(machine.dataBase64, "base64")
        .subarray(2656, 3080)
        .every((byte) => byte === 0),
    );
  const report = {
    stage,
    cluster: "devnet",
    observedAt: new Date().toISOString(),
    slot: result.context.slot,
    deploymentReadSlot: reads.context.slot,
    program: PROGRAM.toBase58(),
    programData: PROGRAM_DATA.toBase58(),
    ...deployment,
    balances: {
      payer: { address: PAYER.toBase58(), lamports: payer.lamports },
      testUser: { address: TEST_USER.toBase58(), lamports: testUser.lamports },
    },
    accounts,
    ...(before
      ? {
          preservation: compareAccounts(before.accounts, accounts),
          ...(before.reconciliation
            ? { reconciliation: before.reconciliation }
            : {}),
        }
      : {}),
  };
  mkdirSync("reports/devnet", { recursive: true });
  writeFileSync(`reports/devnet/upgrade2-${stage}.json`, `${json(report)}\n`, {
    flag: "wx",
  });
  console.log(
    json({
      ...report,
      accounts: accounts.map(({ address, kind, bytes, p3 }) => ({
        address,
        kind,
        bytes,
        p3,
      })),
    }),
  );
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await snapshot(process.argv[2], {
    reconciled: process.argv[3] === "--reconciled",
  });
