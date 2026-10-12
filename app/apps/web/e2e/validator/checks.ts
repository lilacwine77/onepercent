import { PROGRAM_ID } from "../../../../packages/sdk/tests/program-id.js";
import assert from "node:assert/strict";
import { DRAW_TAGS } from "@onepercent/config";
import { setTimeout as delay } from "node:timers/promises";
import {
  Keypair,
  PublicKey,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import {
  buildBuyPacksTransaction,
  buildRedeemTransactions,
  buildRefundTransaction,
  buildSettleTransaction,
  fetchBinder,
  fetchMintDecimals,
  fetchPayees,
  fetchPull,
  pullPda,
  type BuiltTransaction,
  type SettleInput,
} from "@onepercent/sdk";
import { identifyCards, cardRows } from "../../src/adapters/cards.js";
import { readMachine } from "../../src/data/chain.js";
import { editionLiveFlags, editionModels } from "../../src/adapters/edition.js";
import { loadPullEvidence } from "../../src/data/pull.js";
import { crossCheckReveal } from "../../src/tx/watch-pull.js";
import { loadVerify } from "../../src/data/verify.js";
import { ripResult } from "../../src/adapters/rip-result.js";
import { fulfillLocal } from "../helpers/vrf.js";
import { randomnessForTier } from "../helpers/validator.js";
import type { Manifest } from "../../../../scripts/e2e-validator.js";

/** These assertions execute SDK transactions, not browser interactions. */
export async function validatorSdkChecks(rpc: Connection, manifest: Manifest) {
  assert.equal(new URL(rpc.rpcEndpoint).hostname, "127.0.0.1");
  const buyer = Keypair.fromSecretKey(
    Uint8Array.from(manifest.wallets.buyer.secretKey),
  );
  const queue = new PublicKey(manifest.queue);
  const signatures: string[] = [];
  const options = async () => ({
    wallet: buyer.publicKey,
    blockhash: (await rpc.getLatestBlockhash("confirmed")).blockhash,
  });
  const send = async (transaction: BuiltTransaction) => {
    if (transaction instanceof Transaction) transaction.sign(buyer);
    else transaction.sign([buyer]);
    const signature = await rpc.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 0,
    });
    signatures.push(signature);
    const end = Date.now() + 20_000;
    while (Date.now() < end) {
      const status = (await rpc.getSignatureStatuses([signature])).value[0];
      assert(!status?.err, JSON.stringify(status?.err));
      if (
        status?.confirmationStatus === "confirmed" ||
        status?.confirmationStatus === "finalized"
      )
        return signature;
      await delay(100);
    }
    throw new Error("SDK transaction confirmation timed out");
  };
  assert(manifest.pull, "Use the pre-aged refund fixture");
  const aged = new PublicKey(manifest.pull);
  const pending = await fetchPull(PROGRAM_ID, rpc, aged);
  assert(pending?.status === 1);
  const [payee] = await fetchPayees(rpc, [buyer.publicKey]);
  await send(
    buildRefundTransaction(PROGRAM_ID, {
      ...(await options()),
      pull: aged,
      seq: pending.seq,
      buyer: payee!,
    }),
  );
  assert.equal(await fetchPull(PROGRAM_ID, rpc, aged), null);
  const results: {
    tier: number;
    seq: string;
    pull: string;
    callback: string;
    amount: string;
  }[] = [];
  for (const tier of [6, 5, 1, 2, 3, 4]) {
    const nonce = (await fetchBinder(PROGRAM_ID, rpc, buyer.publicKey))!
      .pull_nonce;
    const address = pullPda(PROGRAM_ID, buyer.publicKey, nonce)[0];
    const requestIndex = (await rpc.getAccountInfo(queue))!.data.readUInt32LE(
      0,
    );
    await send(
      buildBuyPacksTransaction(PROGRAM_ID, {
        ...(await options()),
        edition: 0,
        qty: 1,
        pullNonce: nonce,
        oracleQueue: queue,
      }),
    );
    const request = await fetchPull(PROGRAM_ID, rpc, address);
    assert(request?.status === 1);
    assert.equal(
      await loadPullEvidence(rpc, address, request.seq, request, PROGRAM_ID),
      null,
    );
    const state = await readMachine(rpc, PROGRAM_ID);
    const live = editionLiveFlags(
      editionModels({
        ...state,
        deckLen: state.deck.len,
        vrf: {
          queue: manifest.queue,
          occupancyBps: 0,
          oldestItemAgeSeconds: 0,
          busy: false,
        },
      })[0]!,
    );
    const randomness = randomnessForTier(request.seq, 0, tier, live);
    const callback = await fulfillLocal(
      rpc,
      buyer,
      queue,
      address,
      requestIndex,
      randomness,
    );
    signatures.push(callback);
    const revealed = await fetchPull(PROGRAM_ID, rpc, address);
    assert(revealed?.status === 2);
    const evidence = await loadPullEvidence(
      rpc,
      address,
      request.seq,
      revealed,
      PROGRAM_ID,
    );
    assert(evidence);
    const packs = await crossCheckReveal(
      evidence,
      { buyer: buyer.publicKey.toBase58(), edition: 0, qty: 1 },
      revealed,
      PROGRAM_ID,
    );
    assert.equal(packs[0]!.tier, tier);
    assert.equal(
      ripResult(packs[0]!, { items: [] }).hit.tier,
      ["silver", "blue", "holo", "black", "jackpot", "one_pct"][tier - 1],
    );
    assert(
      (await loadVerify(rpc, address.toBase58(), null, PROGRAM_ID))?.check?.ok,
    );
    const binder = await fetchBinder(PROGRAM_ID, rpc, buyer.publicKey);
    assert(binder);
    const rows = cardRows({ binder, ...state, feed: true, sell: true });
    assert.deepEqual(
      rows.map((row) => row.cardId),
      identifyCards(binder.cards).map((row) => row.cardId),
    );
    if (tier >= 5) {
      const row = rows.find(
        (row) =>
          row.seq === `${revealed.seq}` &&
          row.kind === (tier === 5 ? "jackpot" : "one_pct"),
      );
      assert(row?.actions.redeem.open);
      assert.equal(row.actions.sellBack.open, false);
      assert.equal(row.actions.feedBack.open, false);
    }
    results.push({
      tier,
      seq: `${revealed.seq}`,
      pull: address.toBase58(),
      callback,
      amount: packs[0]!.hit_amount.toString(),
    });
    const record = revealed.packs[0]!;
    const flags = await fetchPayees(rpc, [
      buyer.publicKey,
      revealed.referrer,
      ...record.royalties.map((row) => row.depositor),
    ]);
    const settle = buildSettleTransaction(PROGRAM_ID, {
      ...(await options()),
      packs: [
        {
          pull: address,
          seq: revealed.seq,
          pack: 0,
          buyer: flags[0]!,
          referrer: revealed.referrer.equals(PublicKey.default)
            ? undefined
            : flags[1],
          wallets: record.royalties.map((_, index) =>
            record.house_mask & (1 << index) ? null : flags[index + 2]!,
          ) as unknown as SettleInput["wallets"],
        },
      ],
    });
    const signature = await send(settle);
    assert.equal(await fetchPull(PROGRAM_ID, rpc, address), null);
    const transaction = await rpc.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    assert(
      transaction?.meta?.logMessages?.some((line) =>
        line.includes(`${DRAW_TAGS.royaltyMemoPrefix}${revealed.seq}`),
      ),
      "Settle must retain its royalty memo",
    );
  }
  const redeem = async (keep: number, expectedTransactions?: number) => {
    const binder = await fetchBinder(PROGRAM_ID, rpc, buyer.publicKey);
    assert(binder);
    const cards = await Promise.all(
      binder.cards
        .map((card, cardIndex) => ({ ...card, cardIndex }))
        .slice(keep)
        .map(async (card) => ({
          ...card,
          tokenProgram: (await fetchMintDecimals(rpc, card.mint)).tokenProgram,
        })),
    );
    const transactions = buildRedeemTransactions(PROGRAM_ID, {
      ...(await options()),
      cards,
    });
    if (expectedTransactions !== undefined)
      assert.equal(transactions.length, expectedTransactions);
    for (const transaction of transactions) await send(transaction);
    assert.equal(
      (await fetchBinder(PROGRAM_ID, rpc, buyer.publicKey))!.len,
      keep,
    );
  };
  await redeem(9);
  await redeem(0, 2);
  return {
    result: "passed",
    browserVerified: false,
    injectedTiers: results,
    signatures,
    checks: [
      "Pre-aged Pull refunded on chain",
      "All six tiers match confirmed events and reveal adapters",
      "Special cards expose Redeem only",
      "Verify accepts every injected callback",
      "Binder identities equal My cards props",
      "Settle lands without a keeper and retains the royalty memo",
      "Nine Redeems use two descending transactions",
    ],
  };
}
