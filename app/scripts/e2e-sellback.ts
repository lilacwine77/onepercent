import assert from "node:assert/strict";
import { SystemProgram, Transaction } from "@solana/web3.js";
import type { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { SELL_BACK } from "../packages/config/src/index.js";
import {
  attestationExpiry,
  binderPda,
  buildCloseBinderTransaction,
  buildFeedBackTransactions,
  buildRedeemTransactions,
  buildSellBackTransaction,
  buildTakeBackTransactions,
  buildWithdrawOwedTransaction,
  decodeBinder,
  decodeDeck,
  DECK_FLAGS,
  deckPda,
  fetchConfig,
  fetchMachine,
  fetchMintDecimals,
  fetchMintLedger,
  machinePda,
  sellBackEconomics,
  sellBackMessage,
  userAta,
  vaultAta,
} from "../packages/sdk/src/index.js";
import type {
  BuiltTransaction,
  ClusterDeployment,
  TransactionOptions,
} from "../packages/sdk/src/index.js";
import type { FixtureWallet, Manifest } from "./e2e-validator.js";

export interface SellBackFlowContext {
  deployment: ClusterDeployment;
  localSigner(wallet: FixtureWallet): Keypair;
  attest(signer: Keypair, message: Uint8Array): Buffer;
  send(
    connection: Connection,
    transaction: BuiltTransaction,
    signer: Keypair,
  ): Promise<string>;
  options(
    connection: Connection,
    wallet: PublicKey,
  ): Promise<TransactionOptions>;
}

/** E5 uses only the exported local fixture and client-owned transaction builders. */
export async function runSellBack(
  connection: Connection,
  manifest: Manifest,
  context: SellBackFlowContext,
): Promise<void> {
  const programId = context.deployment.programId;
  const buyer = context.localSigner(manifest.wallets.buyer);
  const quoteSigner = context.localSigner(manifest.wallets.intake);
  const owner = buyer.publicKey;
  const binderAddress = binderPda(programId, owner)[0];
  const binderInfo = await connection.getAccountInfo(
    binderAddress,
    "confirmed",
  );
  assert(binderInfo);
  const binder = decodeBinder(binderInfo.data);
  assert(binder.owner.equals(owner));
  assert.equal(binder.cards.length, 25);
  assert.equal(binder.fresh_in_deck, 0);
  assert.equal(binder.reserved, 0);
  assert.equal(binder.season_spend, 0n);
  assert.equal(binder.sol_owed, 100_000n);
  assert.deepEqual(
    binder.cards.slice(0, 9).map((card) => card.kind),
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
  );
  const mint = binder.cards[0]!.mint;
  assert(
    binder.cards.every(
      (card) => card.mint.equals(mint) && card.amount === 1000n,
    ),
  );
  const { tokenProgram } = await fetchMintDecimals(connection, mint);
  const vault = vaultAta(programId, mint, tokenProgram);
  const destination = userAta(owner, mint, tokenProgram);
  const config = await fetchConfig(programId, connection);
  assert(config?.quote_signer.equals(quoteSigner.publicKey));

  const opts = () => context.options(connection, owner);
  async function snapshot() {
    const [
      machine,
      ledger,
      rawBinder,
      rawDeck,
      rawMachine,
      rawVault,
      rawOwnerTokens,
      ownerLamports,
    ] = await Promise.all([
      fetchMachine(programId, connection),
      fetchMintLedger(programId, connection, mint),
      connection.getAccountInfo(binderAddress, "confirmed"),
      connection.getAccountInfo(deckPda(programId)[0], "confirmed"),
      connection.getAccountInfo(machinePda(programId)[0], "confirmed"),
      connection.getAccountInfo(vault, "confirmed"),
      connection.getAccountInfo(destination, "confirmed"),
      connection.getBalance(owner, "confirmed"),
    ]);
    assert(machine && ledger && rawDeck && rawMachine && rawVault);
    const absent =
      !rawBinder ||
      (rawBinder.owner.equals(SystemProgram.programId) &&
        rawBinder.data.length === 0 &&
        !rawBinder.executable);
    if (!absent)
      assert(rawBinder.owner.equals(programId) && !rawBinder.executable);
    return {
      machine,
      ledger,
      binder: absent ? null : decodeBinder(rawBinder.data),
      deck: decodeDeck(rawDeck.data),
      ownerLamports: BigInt(ownerLamports),
      binderLamports: BigInt(rawBinder?.lamports ?? 0),
      binderBytes: rawBinder?.data.length ?? 0,
      deckLamports: BigInt(rawDeck.lamports),
      machineLamports: BigInt(rawMachine.lamports),
      vaultTokens: rawVault.data.readBigUInt64LE(64),
      ownerTokens: rawOwnerTokens?.data.readBigUInt64LE(64) ?? 0n,
    };
  }
  type Snapshot = Awaited<ReturnType<typeof snapshot>>;
  function assertAccounting(state: Snapshot) {
    const inStock = state.machine.buckets
      .filter((bucket) => bucket.mint.equals(mint))
      .reduce((sum, bucket) => sum + bucket.amount, 0n);
    const inCards =
      state.binder?.cards
        .filter((card) => card.mint.equals(mint))
        .reduce((sum, card) => sum + card.amount, 0n) ?? 0n;
    const inDeck = state.deck.entries
      .filter((entry) => entry.mint.equals(mint))
      .reduce((sum, entry) => sum + entry.amount, 0n);
    assert.equal(state.ledger.accounted, inStock + inCards + inDeck);
    assert(state.vaultTokens >= state.ledger.accounted);
    assert.equal(state.binder?.fresh_in_deck ?? 0, 0);
    assert.equal(state.machine.exec.kind, 0);
  }
  async function send(tx: BuiltTransaction): Promise<bigint> {
    const message =
      tx instanceof Transaction ? tx.compileMessage() : tx.message;
    const fee = (await connection.getFeeForMessage(message, "confirmed")).value;
    assert(fee !== null);
    await context.send(connection, tx, buyer);
    return BigInt(fee);
  }
  const rent = async (bytes: number) =>
    BigInt(
      await connection.getMinimumBalanceForRentExemption(bytes, "confirmed"),
    );
  const initial = await snapshot();
  assertAccounting(initial);
  const bucketIndex = initial.machine.buckets.findIndex(
    (bucket) => bucket.class !== 0 && bucket.mint.equals(mint),
  );
  assert(bucketIndex >= 0);
  const originalBucket = initial.machine.buckets[bucketIndex]!;

  const cardsToSell = Array.from({ length: 8 }, (_, index) => ({
    index: 24 - index,
    amount: binder.cards[24 - index]!.amount,
  }));
  const totalAmount = cardsToSell.reduce((sum, card) => sum + card.amount, 0n);
  const stockedValue = cardsToSell.reduce(
    (sum, card) => sum + binder.cards[card.index]!.value,
    0n,
  );
  const blockTime = await connection.getBlockTime(
    await connection.getSlot("confirmed"),
  );
  assert(blockTime !== null);
  const quote = {
    programId,
    owner,
    mint,
    cards: cardsToSell,
    totalAmount,
    quoteLamports: stockedValue,
    nonce: binder.sb_nonce,
    expiry: attestationExpiry(
      BigInt(blockTime),
      SELL_BACK.quoteTtlSeconds.major,
    ),
  };
  const expectedSale = sellBackEconomics(
    initial.machine,
    originalBucket,
    stockedValue,
    quote.quoteLamports,
    BigInt(blockTime),
  );
  const sellFee = await send(
    buildSellBackTransaction(programId, {
      ...(await opts()),
      ...quote,
      tokenProgram,
      quoteSigner: quoteSigner.publicKey,
      signature: context.attest(quoteSigner, sellBackMessage(quote)),
    }),
  );
  const sold = await snapshot();
  assertAccounting(sold);
  assert(sold.binder);
  assert.equal(sold.binder.len, 17);
  assert.equal(sold.binder.sb_nonce, binder.sb_nonce + 1);
  assert.equal(sold.machine.stock_sol, expectedSale.stock_sol);
  assert.equal(sold.machine.team_sol, expectedSale.team_sol);
  assert.equal(sold.machine.sb_paid_hour, expectedSale.sb_paid_hour);
  assert.equal(
    sold.machine.buckets[bucketIndex]!.amount,
    originalBucket.amount + totalAmount,
  );
  assert.equal(
    sold.machine.buckets[bucketIndex]!.cost,
    expectedSale.bucket_cost,
  );
  assert.equal(sold.vaultTokens, initial.vaultTokens);
  assert.equal(sold.ledger.accounted, initial.ledger.accounted);
  assert.equal(
    initial.machineLamports - sold.machineLamports,
    expectedSale.payout,
  );
  const sellSlotRefund = initial.binderLamports - sold.binderLamports;
  assert.equal(
    sellSlotRefund,
    initial.binderLamports -
      (await rent(sold.binderBytes)) -
      sold.binder.sol_owed,
  );
  assert.equal(
    sold.ownerLamports,
    initial.ownerLamports + expectedSale.payout + sellSlotRefund - sellFee,
  );

  const feedIndices = Array.from({ length: 8 }, (_, index) => 16 - index);
  const fedCards = feedIndices.map((index) => sold.binder!.cards[index]!);
  let feedFees = 0n;
  for (const tx of buildFeedBackTransactions(programId, {
    ...(await opts()),
    cardIndices: feedIndices,
  }))
    feedFees += await send(tx);
  const fed = await snapshot();
  assertAccounting(fed);
  assert(fed.binder);
  assert.equal(fed.binder.len, 9);
  assert.equal(fed.binder.sb_nonce, sold.binder.sb_nonce);
  assert.equal(fed.deck.len, sold.deck.len + fedCards.length);
  assert.equal(
    fed.deck.total_fed,
    sold.deck.total_fed + BigInt(fedCards.length),
  );
  const refed = fed.deck.entries.slice(sold.deck.len);
  assert.equal(refed.length, fedCards.length);
  for (const [index, entry] of refed.entries()) {
    assert(entry.depositor.equals(owner) && entry.mint.equals(mint));
    assert.equal(entry.amount, fedCards[index]!.amount);
    assert.equal(entry.flags, DECK_FLAGS.refed);
  }
  const entryDeposits = refed.reduce(
    (sum, entry) => sum + BigInt(entry.deposit),
    0n,
  );
  const feedSlotRefund = sold.binderLamports - fed.binderLamports;
  assert.equal(
    feedSlotRefund,
    sold.binderLamports - (await rent(fed.binderBytes)) - fed.binder.sol_owed,
  );
  assert.equal(fed.deckLamports, sold.deckLamports + entryDeposits);
  assert.equal(
    fed.ownerLamports,
    sold.ownerLamports + feedSlotRefund - entryDeposits - feedFees,
  );
  assert.equal(fed.ledger.accounted, sold.ledger.accounted);
  assert.equal(fed.vaultTokens, sold.vaultTokens);
  assert.deepEqual(fed.machine, sold.machine);

  const owed = fed.binder.sol_owed;
  const owedFee = await send(
    buildWithdrawOwedTransaction(programId, await opts()),
  );
  const withdrawn = await snapshot();
  assertAccounting(withdrawn);
  assert(withdrawn.binder);
  assert.equal(withdrawn.binder.sol_owed, 0n);
  assert.equal(withdrawn.binderLamports, fed.binderLamports - owed);
  assert.equal(withdrawn.ownerLamports, fed.ownerLamports + owed - owedFee);

  const redeemCards = withdrawn.binder.cards.map((card, cardIndex) => ({
    mint: card.mint,
    amount: card.amount,
    tokenProgram,
    cardIndex,
  }));
  assert.deepEqual(
    withdrawn.binder.cards.map((card) => card.kind),
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
  );
  for (const tx of buildRedeemTransactions(programId, {
    ...(await opts()),
    cards: redeemCards,
  })) {
    await send(tx);
    assertAccounting(await snapshot());
  }
  const redeemed = await snapshot();
  const redeemedTokens = redeemCards.reduce(
    (sum, card) => sum + card.amount,
    0n,
  );
  assert(redeemed.binder);
  assert.equal(redeemed.binder.len, 0);
  assert.equal(redeemed.ownerTokens, withdrawn.ownerTokens + redeemedTokens);
  assert.equal(redeemed.vaultTokens, withdrawn.vaultTokens - redeemedTokens);
  assert.equal(
    redeemed.ledger.accounted,
    withdrawn.ledger.accounted - redeemedTokens,
  );

  const closeFee = await send(
    buildCloseBinderTransaction(programId, await opts()),
  );
  const closed = await snapshot();
  assertAccounting(closed);
  assert.equal(closed.binder, null);
  assert.equal(
    await connection.getAccountInfo(binderAddress, "confirmed"),
    null,
  );
  assert.equal(
    closed.ownerLamports,
    redeemed.ownerLamports + redeemed.binderLamports - closeFee,
  );

  for (const tx of buildTakeBackTransactions(programId, {
    ...(await opts()),
    entries: refed.map((entry, index) => ({
      mint: entry.mint,
      amount: entry.amount,
      tokenProgram,
      deckIndex: sold.deck.len + index,
    })),
  })) {
    await send(tx);
    assertAccounting(await snapshot());
  }
  const taken = await snapshot();
  const takenTokens = refed.reduce((sum, entry) => sum + entry.amount, 0n);
  assert.equal(taken.binder, null);
  assert.equal(taken.deck.len, initial.deck.len);
  assert.equal(
    taken.deck.total_taken_back,
    initial.deck.total_taken_back + BigInt(refed.length),
  );
  assert.equal(taken.ledger.accounted, redeemed.ledger.accounted - takenTokens);
  assert.equal(taken.vaultTokens, redeemed.vaultTokens - takenTokens);
  assert.equal(taken.ownerTokens, redeemed.ownerTokens + takenTokens);
  assert.equal(
    taken.ownerTokens + taken.vaultTokens,
    initial.ownerTokens + initial.vaultTokens,
  );
  assert.equal(
    taken.ledger.accounted,
    taken.machine.buckets[bucketIndex]!.amount,
  );

  // A third party may fund the canonical address after closure. It remains absent.
  const donor = context.localSigner(manifest.wallets.payer);
  assert(!donor.publicKey.equals(owner));
  const donation = await rent(0);
  const donorOptions = await context.options(connection, donor.publicKey);
  await context.send(
    connection,
    new Transaction({
      feePayer: donor.publicKey,
      recentBlockhash: donorOptions.blockhash,
    }).add(
      SystemProgram.transfer({
        fromPubkey: donor.publicKey,
        toPubkey: binderAddress,
        lamports: donation,
      }),
    ),
    donor,
  );
  const prefunded = await connection.getAccountInfo(binderAddress, "confirmed");
  assert(
    prefunded &&
      prefunded.owner.equals(SystemProgram.programId) &&
      !prefunded.executable &&
      prefunded.data.length === 0,
  );
  assert.equal(BigInt(prefunded.lamports), donation);
  for (const build of [
    buildWithdrawOwedTransaction,
    buildCloseBinderTransaction,
  ]) {
    const before = await snapshot();
    const fee = await send(build(programId, await opts()));
    const after = await snapshot();
    assertAccounting(after);
    assert.equal(after.binder, null);
    assert.equal(after.ownerLamports, before.ownerLamports - fee);
    assert.deepEqual(
      await connection.getAccountInfo(binderAddress, "confirmed"),
      prefunded,
    );
  }
  console.log(
    "E5 PASS: Sell x8 -> Feed back x8 -> owed SOL -> Redeem all nine kinds -> close My cards -> REFED take-back with absent Binder; prefunded exits remain no-ops",
  );
}
