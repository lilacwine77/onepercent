import { DEVNET_GENESIS_HASH } from "../packages/config/dist/genesis.js";
// Public reads only. Reproduce two finalized pre-upgrade user operations exactly;
// never copy current account bytes into the historical baseline.
import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";
import { utils } from "@anchor-lang/core";
import { ACCOUNT_SIZES } from "../packages/config/dist/index.js";
import * as sdk from "../packages/sdk/dist/index.js";
import { createDevnetFetch } from "./devnet-fetch.mjs";

const PROGRAM = new PublicKey("DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr");
const OWNER = "4BbHoUmkLRKt2zrUTQMRFzxBUsYKM6nxFyAEAahXUvwr";
const MINT = "5SatqsL5EZPmsonD7Xt9Y3t3cC3wCVwE3PQpohBYfmUf";
export const KNOWN_SIGNATURES = [
  "5iazUcsLXW8PKtxf1VBjLRgXGa7qLNDdate2Ak7dL57TUz5rCpQjYKvoCs7f7Ag9goe6gnz1Fp66w3skwh6kqz4B",
  "aoRPj1XmcsoDXRdqKnpg51udiVDTqhqCRnnZ7ky6HvwiZ1EXSPwUkCEz9RRn4KUKj6xUpxwJbz1vSY6x8Es1Ari",
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const discriminator = (name) =>
  createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const stringify = (value) =>
  JSON.stringify(
    value,
    (_, item) => (typeof item === "bigint" ? String(item) : item),
    2,
  );
const clean = (value) => JSON.parse(stringify(value));
const ADDRESSES = {
  Deck: String(sdk.deckPda(PROGRAM)[0]),
  Binder: String(sdk.binderPda(PROGRAM, new PublicKey(OWNER))[0]),
  MintLedger: String(sdk.ledgerPda(PROGRAM, new PublicKey(MINT))[0]),
};

export function receiptProof(signature, value) {
  assert(
    value?.meta && value.meta.err === null,
    "Successful finalized receipt required",
  );
  assert.equal(value.transaction.signatures[0], signature);
  const message = value.transaction.message;
  const keys = message.getAccountKeys({
    accountKeysFromLookups: value.meta.loadedAddresses,
  });
  const serialized = message.serialize();
  for (let index = 0; index < message.header.numRequiredSignatures; index++) {
    const publicKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        keys.get(index).toBuffer(),
      ]),
      format: "der",
      type: "spki",
    });
    assert(
      verify(
        null,
        serialized,
        publicKey,
        utils.bytes.bs58.decode(value.transaction.signatures[index]),
      ),
      "Invalid transaction signature",
    );
  }
  const instructions = message.compiledInstructions.map((ix) => ({
    program: String(keys.get(ix.programIdIndex)),
    dataHex: Buffer.from(ix.data).toString("hex"),
    accounts: ix.accountKeyIndexes.map((index) => ({
      address: String(keys.get(index)),
      writable: message.isAccountWritable(index),
      signer: message.isAccountSigner(index),
      before: value.meta.preBalances[index],
      after: value.meta.postBalances[index],
    })),
  }));
  const parsed = sdk.parseOnepercentLogs({
    logs: value.meta.logMessages,
    err: value.meta.err,
    programId: String(PROGRAM),
    topLevelProgramIds: instructions.map((ix) => ix.program),
  });
  assert(!parsed.truncated && !parsed.malformed && !parsed.unknownEvent);
  const ours = instructions.filter((ix) => ix.program === String(PROGRAM));
  assert.equal(ours.length, 1, "Exactly one application instruction required");
  assert.equal(
    parsed.events.length,
    1,
    "Exactly one application event required",
  );
  assert.equal(parsed.events[0].ixIndex, instructions.indexOf(ours[0]));
  return clean({
    signature,
    slot: value.slot,
    blockTime: value.blockTime,
    messageBase64: Buffer.from(serialized).toString("base64"),
    signatures: value.transaction.signatures,
    instruction: ours[0],
    event: parsed.events[0],
    instructions,
  });
}

/** The only supported replay is this exact, ordered TakeBack and Feed pair.
 * Header offsets follow the existing zero-copy layouts; economics come from
 * signed arguments, baseline entries and actual receipt lamport deltas. */
export function replayKnownTransactions(before, proofs) {
  assert.equal(before.cluster, "devnet");
  assert.equal(before.program, String(PROGRAM));
  assert.deepEqual(
    proofs.map((proof) => proof.signature),
    KNOWN_SIGNATURES,
  );
  assert(before.slot < proofs[0].slot && proofs[0].slot < proofs[1].slot);
  const result = structuredClone(before);
  const rows = Object.fromEntries(
    Object.entries(ADDRESSES).map(([kind, address]) => {
      const row = result.accounts.find((item) => item.address === address);
      assert.equal(row?.kind, kind);
      return [kind, row];
    }),
  );
  const buffers = Object.fromEntries(
    Object.entries(rows).map(([kind, row]) => [
      kind,
      Buffer.from(row.dataBase64, "base64"),
    ]),
  );
  const h = ACCOUNT_SIZES.deckHeader,
    entrySize = ACCOUNT_SIZES.deckEntry;
  assert.equal(h, 64);
  assert.equal(entrySize, 80);
  assert.equal(buffers.Binder.length, ACCOUNT_SIZES.binderHeader);
  assert.equal(buffers.MintLedger.length, ACCOUNT_SIZES.mintLedger);
  assert(new PublicKey(buffers.Binder.subarray(8, 40)).toBase58() === OWNER);
  assert(new PublicKey(buffers.MintLedger.subarray(8, 40)).toBase58() === MINT);
  const receiptBalances = (proof) => {
    for (const [kind, row] of Object.entries(rows)) {
      const account = proof.instruction.accounts.find(
        (item) => item.address === row.address,
      );
      assert(account?.writable && !account.signer, `Missing writable ${kind}`);
      assert.equal(
        row.lamports,
        account.before,
        `Historical lamports mismatch: ${kind}`,
      );
    }
  };
  const confirmBalances = (proof) => {
    for (const row of Object.values(rows)) {
      assert.equal(
        row.lamports,
        proof.instruction.accounts.find((item) => item.address === row.address)
          .after,
      );
    }
  };
  const verifyAccounts = (proof, expected) => {
    assert.deepEqual(
      proof.instruction.accounts.map((item) => item.address),
      expected,
    );
    assert.equal(proof.instruction.accounts[0].signer, true);
    assert.equal(proof.instruction.accounts[0].address, OWNER);
    const writableApplication = proof.instruction.accounts.filter(
      (item) =>
        item.writable &&
        before.accounts.some((row) => row.address === item.address),
    );
    assert.deepEqual(
      writableApplication.map((item) => item.address).sort(),
      Object.values(ADDRESSES).sort(),
    );
  };
  const take = proofs[0],
    feed = proofs[1];
  const takeBytes = Buffer.from(take.instruction.dataHex, "hex");
  assert.equal(takeBytes.length, 20);
  assert(takeBytes.subarray(0, 8).equals(discriminator("take_back")));
  const takeIndex = takeBytes.readUInt32LE(8),
    takeAmount = takeBytes.readBigUInt64LE(12);
  assert.equal(takeIndex, 1);
  assert.equal(takeAmount, 1_000_000_000n);
  assert.equal(take.event.name, "BagTakenBack");
  const event = take.event.data;
  assert.equal(event.depositor, OWNER);
  assert.equal(event.mint, MINT);
  assert.equal(BigInt(event.amount), takeAmount);
  assert.equal(event.deck_index, takeIndex);
  const token = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  const vault = "4HFSugSSuxSuLxLjQSy8o8LFXNDPqNgBn5H7uCTD8e3m";
  const destination = "Fhev98QNm69LdqvCBfD267WrKPzEqT8gPupqcyF7MVUu";
  verifyAccounts(take, [
    OWNER,
    ADDRESSES.Deck,
    ADDRESSES.Binder,
    MINT,
    ADDRESSES.MintLedger,
    vault,
    String(sdk.vaultAuthPda(PROGRAM)[0]),
    destination,
    token,
    String(sdk.machinePda(PROGRAM)[0]),
  ]);
  receiptBalances(take);
  let deck = buffers.Deck;
  const length = deck.readUInt32LE(8),
    cap = deck.readUInt32LE(12);
  assert.equal(length, cap);
  assert.equal(deck.length, h + cap * entrySize);
  assert.equal(event.moved_from, length - 1);
  const position = h + takeIndex * entrySize,
    last = h + (length - 1) * entrySize;
  const entry = Buffer.from(deck.subarray(position, position + entrySize));
  assert.equal(new PublicKey(entry.subarray(0, 32)).toBase58(), OWNER);
  assert.equal(new PublicKey(entry.subarray(32, 64)).toBase58(), MINT);
  assert.equal(entry.readBigUInt64LE(64), takeAmount);
  assert.equal(entry[76], 1, "Expected fresh entry");
  const deposit = entry.readUInt32LE(72);
  assert.equal(
    BigInt(event.refund),
    BigInt(deposit),
    "Full recorded entry deposit returned",
  );
  deck.copy(deck, position, last, last + entrySize);
  deck.fill(0, last, last + entrySize);
  deck = Buffer.from(deck.subarray(0, last));
  deck.writeUInt32LE(length - 1, 8);
  deck.writeUInt32LE(length - 1, 12);
  deck.writeBigUInt64LE(deck.readBigUInt64LE(40) + 1n, 40);
  buffers.Binder.writeUInt16LE(buffers.Binder.readUInt16LE(102) - 1, 102);
  buffers.MintLedger.writeBigUInt64LE(
    buffers.MintLedger.readBigUInt64LE(72) - takeAmount,
    72,
  );
  rows.Deck.lamports -= deposit;
  confirmBalances(take);

  const feedBytes = Buffer.from(feed.instruction.dataHex, "hex");
  assert.equal(feedBytes.length, 33);
  assert(feedBytes.subarray(0, 8).equals(discriminator("feed")));
  assert.equal(feedBytes.readUInt32LE(8), 1);
  const feedAmount = feedBytes.readBigUInt64LE(12),
    nonce = feedBytes.readUInt32LE(28);
  assert.equal(feedAmount, 8_000_000_000n);
  assert.equal(nonce, 2);
  assert.equal(feedBytes[32], 2);
  assert.equal(
    feed.instructions[2].program,
    "Ed25519SigVerify111111111111111111111111111",
  );
  assert.equal(feed.event.name, "BagFed");
  const added = feed.event.data;
  assert.equal(added.depositor, OWNER);
  assert.equal(added.mint, MINT);
  assert.equal(BigInt(added.amount), feedAmount);
  assert.equal(added.deck_index, length - 1);
  assert.equal(BigInt(added.deposit), BigInt(deposit));
  verifyAccounts(feed, [
    OWNER,
    String(sdk.configPda(PROGRAM)[0]),
    String(sdk.machinePda(PROGRAM)[0]),
    ADDRESSES.Deck,
    ADDRESSES.Binder,
    "Sysvar1nstructions1111111111111111111111111",
    "11111111111111111111111111111111",
    MINT,
    vault,
    ADDRESSES.MintLedger,
    "C1MAk1Xmr3EFeYw2HxLVqZZLeoKrspzHsfNs5ehfFZU8",
  ]);
  receiptBalances(feed);
  // This receipt consumes the base nonce with no other window bits set.
  assert.equal(buffers.Binder.readUInt32LE(88), nonce);
  assert.equal(buffers.Binder.readUInt16LE(100), 0);
  buffers.Binder.writeUInt32LE(nonce + 1, 88);
  buffers.Binder.writeUInt16LE(buffers.Binder.readUInt16LE(102) + 1, 102);
  assert.equal(buffers.Binder.readUInt16LE(102), added.fresh_in_deck);
  buffers.MintLedger.writeBigUInt64LE(
    buffers.MintLedger.readBigUInt64LE(72) + feedAmount,
    72,
  );
  const newEntry = Buffer.alloc(entrySize);
  new PublicKey(OWNER).toBuffer().copy(newEntry, 0);
  new PublicKey(MINT).toBuffer().copy(newEntry, 32);
  newEntry.writeBigUInt64LE(feedAmount, 64);
  newEntry.writeUInt32LE(deposit, 72);
  newEntry[76] = 1;
  deck = Buffer.concat([deck, newEntry]);
  deck.writeUInt32LE(length, 8);
  deck.writeUInt32LE(length, 12);
  deck.writeBigUInt64LE(deck.readBigUInt64LE(24) + 1n, 24);
  buffers.Deck = deck;
  rows.Deck.lamports += deposit;
  confirmBalances(feed);
  for (const [kind, row] of Object.entries(rows)) {
    const data = buffers[kind];
    row.dataBase64 = data.toString("base64");
    row.bytes = data.length;
    row.sha256 = sha(data);
    row.state = clean(sdk[`decode${kind}`](data));
  }
  return result;
}

async function completeHistory(rpc, address, initialSlot, upgradeSlot) {
  let before;
  const entries = [];
  for (let page = 0; page < 20; page++) {
    const rows = await rpc.getSignaturesForAddress(
      new PublicKey(address),
      { limit: 1000, ...(before ? { before } : {}) },
      "finalized",
    );
    entries.push(
      ...rows.filter((row) => row.slot > initialSlot && row.slot < upgradeSlot),
    );
    if (rows.length === 0 || rows.at(-1).slot <= initialSlot) {
      const successful = entries.filter((row) => row.err === null);
      assert.deepEqual(
        successful.map((row) => row.signature).sort(),
        [...KNOWN_SIGNATURES].sort(),
        `Unexpected intervening transaction: ${address}`,
      );
      return {
        address,
        initialSlot,
        upgradeSlot,
        reachedInitialSlot: true,
        entries,
      };
    }
    before = rows.at(-1).signature;
  }
  throw Error(`Incomplete account history: ${address}`);
}

export async function reconcile({ write = false } = {}) {
  const originalPath = "reports/devnet/upgrade2-before.json";
  const originalBytes = readFileSync(originalPath),
    original = JSON.parse(originalBytes);
  const rpc = new Connection("https://api.devnet.solana.com", {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: createDevnetFetch(),
  });
  assert.equal(await rpc.getGenesisHash(), DEVNET_GENESIS_HASH);
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const pd = await rpc.getAccountInfo(
    new PublicKey(original.programData),
    "finalized",
  );
  assert(pd?.owner.equals(loader) && pd.data.readUInt32LE(0) === 3);
  const upgradeSlot = Number(pd.data.readBigUInt64LE(4));
  assert(upgradeSlot > original.slot);
  const proofs = [];
  for (const signature of KNOWN_SIGNATURES) {
    const value = await rpc.getTransaction(signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    const proof = receiptProof(signature, value);
    assert(proof.slot > original.slot && proof.slot < upgradeSlot);
    proofs.push(proof);
  }
  const histories = [];
  for (const address of Object.values(ADDRESSES))
    histories.push(
      await completeHistory(rpc, address, original.slot, upgradeSlot),
    );
  const result = replayKnownTransactions(original, proofs);
  result.reconciliation = {
    status: "PASS",
    originalPath,
    originalSha256: sha(originalBytes),
    upgradeSlot,
    explanation:
      "Exact TakeBack and Feed replay from finalized signed instructions and events; original snapshot is preserved. No observed post-upgrade bytes enter the replay.",
    unchangedAccountCount: original.accounts.length - 3,
    replayedAccounts: Object.values(ADDRESSES),
    receipts: proofs,
    histories,
    sourceSha256: Object.fromEntries(
      [
        "instructions/take_back.rs",
        "instructions/feed.rs",
        "state/views.rs",
        "util/dynamic.rs",
        "checks/nonce.rs",
      ].map((path) => [
        path,
        sha(readFileSync(`programs/onepercent/src/${path}`)),
      ]),
    ),
  };
  if (write)
    writeFileSync(
      "reports/devnet/upgrade2-reconciled-before.json",
      `${stringify(result)}\n`,
      { flag: "wx" },
    );
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = await reconcile({ write: true });
  console.log(
    stringify({
      status: "PASS",
      originalSlot: result.slot,
      upgradeSlot: result.reconciliation.upgradeSlot,
      unchangedAccountCount: result.reconciliation.unchangedAccountCount,
      replayedAccounts: result.reconciliation.replayedAccounts,
      signatures: KNOWN_SIGNATURES,
    }),
  );
}
