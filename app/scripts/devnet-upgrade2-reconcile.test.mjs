import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { PublicKey } from "@solana/web3.js";
import * as sdk from "../packages/sdk/dist/index.js";
import {
  KNOWN_SIGNATURES,
  replayKnownTransactions,
} from "./devnet-upgrade2-reconcile.mjs";

const pid = new PublicKey("DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr");
const owner = new PublicKey("4BbHoUmkLRKt2zrUTQMRFzxBUsYKM6nxFyAEAahXUvwr");
const mint = new PublicKey("5SatqsL5EZPmsonD7Xt9Y3t3cC3wCVwE3PQpohBYfmUf");
const deckAddress = String(sdk.deckPda(pid)[0]);
const binderAddress = String(sdk.binderPda(pid, owner)[0]);
const ledgerAddress = String(sdk.ledgerPda(pid, mint)[0]);
const disc = (name) =>
  createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const json = (value) =>
  JSON.stringify(value, (_, item) =>
    typeof item === "bigint" ? String(item) : item,
  );

function fixture() {
  const entry = {
    depositor: owner,
    mint,
    amount: 1_000_000_000n,
    deposit: 406400,
    flags: 1,
  };
  const deck = sdk.encodeDeck({
    entries: Array.from({ length: 50 }, (_, index) => ({
      ...entry,
      amount: index === 1 ? entry.amount : BigInt(index + 1),
    })),
    total_fed: 54n,
    total_pulled: 4n,
    total_taken_back: 2n,
  });
  // Nonzero reserved bytes must survive replay too.
  deck[62] = 179;
  const binder = sdk.encodeBinder({
    owner,
    fresh_in_deck: 3,
    feed_nonce_base: 2,
  });
  const ledger = sdk.encodeMintLedger({
    mint,
    payer: owner,
    accounted: 9_000_000_000n,
  });
  const row = (address, kind, data, lamports) => ({
    address,
    kind,
    bytes: data.length,
    dataBase64: data.toString("base64"),
    lamports,
  });
  const before = {
    cluster: "devnet",
    program: String(pid),
    slot: 100,
    accounts: [
      row(deckAddress, "Deck", deck, 21295360),
      row(binderAddress, "Binder", binder, 1219200),
      row(ledgerAddress, "MintLedger", ledger, 1056640),
      row(
        String(sdk.machinePda(pid)[0]),
        "Machine",
        Buffer.from([4, 8, 12]),
        500,
      ),
    ],
  };
  const accounts = (addresses, feed) =>
    addresses.map((address) => ({
      address,
      signer: address === String(owner),
      writable: [
        String(owner),
        deckAddress,
        binderAddress,
        ledgerAddress,
      ].includes(address),
      before:
        address === deckAddress
          ? feed
            ? 20888960
            : 21295360
          : address === binderAddress
            ? 1219200
            : address === ledgerAddress
              ? 1056640
              : 0,
      after:
        address === deckAddress
          ? feed
            ? 21295360
            : 20888960
          : address === binderAddress
            ? 1219200
            : address === ledgerAddress
              ? 1056640
              : 0,
    }));
  const vault = "4HFSugSSuxSuLxLjQSy8o8LFXNDPqNgBn5H7uCTD8e3m";
  const takeData = Buffer.alloc(20);
  disc("take_back").copy(takeData);
  takeData.writeUInt32LE(1, 8);
  takeData.writeBigUInt64LE(1_000_000_000n, 12);
  const take = {
    signature: KNOWN_SIGNATURES[0],
    slot: 101,
    instruction: {
      dataHex: takeData.toString("hex"),
      accounts: accounts(
        [
          String(owner),
          deckAddress,
          binderAddress,
          String(mint),
          ledgerAddress,
          vault,
          String(sdk.vaultAuthPda(pid)[0]),
          "Fhev98QNm69LdqvCBfD267WrKPzEqT8gPupqcyF7MVUu",
          "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
          String(sdk.machinePda(pid)[0]),
        ],
        false,
      ),
    },
    event: {
      name: "BagTakenBack",
      data: {
        depositor: String(owner),
        mint: String(mint),
        amount: "1000000000",
        deck_index: 1,
        moved_from: 49,
        refund: "406400",
      },
    },
  };
  const feedData = Buffer.alloc(33);
  disc("feed").copy(feedData);
  feedData.writeUInt32LE(1, 8);
  feedData.writeBigUInt64LE(8_000_000_000n, 12);
  feedData.writeUInt32LE(2, 28);
  feedData[32] = 2;
  const feed = {
    signature: KNOWN_SIGNATURES[1],
    slot: 102,
    instruction: {
      dataHex: feedData.toString("hex"),
      accounts: accounts(
        [
          String(owner),
          String(sdk.configPda(pid)[0]),
          String(sdk.machinePda(pid)[0]),
          deckAddress,
          binderAddress,
          "Sysvar1nstructions1111111111111111111111111",
          "11111111111111111111111111111111",
          String(mint),
          vault,
          ledgerAddress,
          "C1MAk1Xmr3EFeYw2HxLVqZZLeoKrspzHsfNs5ehfFZU8",
        ],
        true,
      ),
    },
    instructions: [
      {},
      {},
      { program: "Ed25519SigVerify111111111111111111111111111" },
    ],
    event: {
      name: "BagFed",
      data: {
        depositor: String(owner),
        mint: String(mint),
        amount: "8000000000",
        deck_index: 49,
        deposit: "406400",
        fresh_in_deck: 3,
      },
    },
  };
  return { before, proofs: [take, feed] };
}

test("exact replay preserves the original and reproduces swap-remove, nonce and ledger changes", () => {
  const { before, proofs } = fixture(),
    original = json(before);
  const result = replayKnownTransactions(before, proofs);
  assert.equal(json(before), original);
  assert.deepEqual(result.accounts[3], before.accounts[3]);
  const deckBytes = Buffer.from(result.accounts[0].dataBase64, "base64"),
    deck = sdk.decodeDeck(deckBytes);
  assert.equal(deck.len, 50);
  assert.equal(deck.cap, 50);
  assert.equal(deck.total_fed, 55n);
  assert.equal(deck.total_pulled, 4n);
  assert.equal(deck.total_taken_back, 3n);
  assert.equal(deck.entries[1].amount, 50n);
  assert.equal(deck.entries[49].amount, 8_000_000_000n);
  assert.equal(deckBytes[62], 179);
  const binder = result.accounts[1].state;
  assert.equal(binder.feed_nonce_base, 3);
  assert.equal(binder.feed_nonce_bits, 0);
  assert.equal(binder.fresh_in_deck, 3);
  assert.equal(result.accounts[2].state.accounted, "16000000000");
  assert.deepEqual(
    result.accounts.map((row) => row.lamports),
    before.accounts.map((row) => row.lamports),
  );
});

test("reconciliation rejects forged events, different instructions, accounts and historical balances", () => {
  const mutations = [
    ({ proofs }) => {
      proofs[0].event.data.amount = "2";
    },
    ({ proofs }) => {
      proofs[0].event.data.moved_from = 48;
    },
    ({ proofs }) => {
      proofs[1].event.data.deposit = "1";
    },
    ({ proofs }) => {
      proofs[1].event.data.fresh_in_deck = 4;
    },
    ({ proofs }) => {
      proofs[0].instruction.accounts[0].signer = false;
    },
    ({ proofs }) => {
      proofs[1].instruction.accounts[3].before += 1;
    },
    ({ proofs }) => {
      proofs[0].instruction.accounts[1].after += 1;
    },
    ({ proofs }) => {
      proofs[1].instruction.accounts[2].writable = true;
    },
    ({ proofs }) => {
      proofs[1].instruction.dataHex =
        proofs[1].instruction.dataHex.slice(0, -2) + "03";
    },
    ({ proofs }) => {
      proofs.reverse();
    },
    ({ before }) => {
      before.slot = 101;
    },
    ({ before }) => {
      before.cluster = "mainnet";
    },
  ];
  for (const change of mutations) {
    const input = fixture();
    change(input);
    assert.throws(() => replayKnownTransactions(input.before, input.proofs));
  }
});

test("unknown nonce windows and altered original entry amounts are never accepted", () => {
  for (const kind of ["Binder", "Deck"]) {
    const { before, proofs } = fixture();
    const row = before.accounts.find((account) => account.kind === kind);
    const bytes = Buffer.from(row.dataBase64, "base64");
    if (kind === "Binder") bytes.writeUInt16LE(2, 100);
    else bytes.writeBigUInt64LE(2n, 64 + 80 + 64);
    row.dataBase64 = bytes.toString("base64");
    assert.throws(() => replayKnownTransactions(before, proofs));
  }
});
