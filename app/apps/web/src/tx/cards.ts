import { webDeployment } from "../data/deployment";
import {
  BPS_DENOMINATOR,
  HIT_TIERS,
  SELL_BACK,
  TX_LIMITS,
} from "@onepercent/config";
import { PublicKey, SIGNATURE_LENGTH_IN_BYTES } from "@solana/web3.js";
import {
  buildRedeemTransactions,
  closeBinderIx,
  ed25519Instruction,
  feedBackIx,
  sellBackIx,
  sellBackMessage,
  serializedSize,
  transaction,
  withdrawOwedIx,
  type BuiltTransaction,
} from "@onepercent/sdk/browser";
import type { SellBackQuoteResponse } from "@onepercent/sdk/api";
import {
  binderClosable,
  cardBatches,
  sellRefusal,
  type Binder,
  type SelectedCard,
} from "../adapters/cards";
import { EngineError } from "./engine/errors";

export interface CardBuildOptions {
  wallet: PublicKey;
  blockhash: string;
}
export type CardToken = SelectedCard & { tokenProgram: PublicKey };
const bytes = (base64: string) =>
  Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

/** Refuse a malformed or stale service reply before it can reach the wallet. */
export function checkedSellQuote(input: {
  response: SellBackQuoteResponse;
  wallet: PublicKey;
  cards: readonly SelectedCard[];
  binder: Binder;
  signer: PublicKey;
  nowTs: bigint;
}) {
  const { response, cards, binder, wallet, signer, nowTs } = input;
  if (!response.ok) throw new EngineError(sellRefusal(response.reason));
  const q = response.quote;
  if (
    !cards.length ||
    cards.length > TX_LIMITS.redeemPerTx ||
    cards.some(
      (card) =>
        card.kind < 1 ||
        card.kind > HIT_TIERS.length ||
        !card.mint.equals(cards[0]!.mint),
    ) ||
    q.owner !== wallet.toBase58() ||
    q.signer !== signer.toBase58() ||
    q.mint !== cards[0]!.mint.toBase58() ||
    q.nonce !== binder.sb_nonce ||
    q.cards.length !== cards.length ||
    q.cards.some(
      (card, index) =>
        card.index !== cards[index]!.cardIndex ||
        BigInt(card.amount) !== cards[index]!.amount,
    )
  )
    throw new EngineError("errors.cardMoved");
  const expiry = BigInt(q.expiry);
  const ttl =
    q.bucketClass === "MAJOR"
      ? SELL_BACK.quoteTtlSeconds.major
      : SELL_BACK.quoteTtlSeconds.trending;
  if (expiry < nowTs || expiry > nowTs + BigInt(ttl))
    throw new EngineError("feed.state.quoteExpired");
  const totalAmount = cards.reduce((sum, card) => sum + card.amount, 0n);
  const stocked = cards.reduce((sum, card) => sum + card.value, 0n);
  const quoteLamports = BigInt(q.quoteLamports);
  const value = stocked < quoteLamports ? stocked : quoteLamports;
  const payout =
    (value * BigInt(SELL_BACK.payoutBps)) / BigInt(BPS_DENOMINATOR);
  const message = sellBackMessage({
    programId: webDeployment().programId,
    owner: wallet,
    mint: cards[0]!.mint,
    cards: cards.map((card) => ({
      index: card.cardIndex,
      amount: card.amount,
    })),
    totalAmount,
    quoteLamports,
    expiry,
    nonce: binder.sb_nonce,
  });
  if (
    BigInt(q.totalAmount) !== totalAmount ||
    BigInt(q.stockedValueLamports) !== stocked ||
    BigInt(q.valueLamports) !== value ||
    BigInt(q.payoutLamports) !== payout ||
    payout <= 0n ||
    !sameBytes(bytes(q.message), message) ||
    bytes(q.signature).length !== SIGNATURE_LENGTH_IN_BYTES
  )
    throw new EngineError("errors.generic");
  return {
    ...q,
    expiry,
    payoutLamports: payout,
    quoteLamports,
    message,
    signature: bytes(q.signature),
  };
}
export type CheckedSellQuote = ReturnType<typeof checkedSellQuote>;

function checked(tx: BuiltTransaction) {
  if (serializedSize(tx) > TX_LIMITS.maxTxBytes)
    throw new EngineError("errors.generic");
  return tx;
}

/** P0 defines these instructions; P2 supplies measured CU limits after merge. */
export function buildCardSell(
  input: CardBuildOptions & {
    cards: readonly CardToken[];
    quote: CheckedSellQuote;
  },
) {
  return checked(
    transaction(input, [
      ed25519Instruction({
        publicKey: new PublicKey(input.quote.signer),
        message: input.quote.message,
        signature: input.quote.signature,
      }),
      sellBackIx(webDeployment().programId, {
        owner: input.wallet,
        mint: input.cards[0]!.mint,
        tokenProgram: input.cards[0]!.tokenProgram,
        cards: input.quote.cards.map((card) => ({
          index: card.index,
          amount: BigInt(card.amount),
        })),
        quoteLamports: input.quote.quoteLamports,
        expiry: input.quote.expiry,
        nonce: input.quote.nonce,
        attIx: 0,
      }),
    ]),
  );
}

export function buildCardRedeems(
  input: CardBuildOptions & { cards: readonly CardToken[] },
) {
  return buildRedeemTransactions(webDeployment().programId, {
    ...input,
    cards: [...input.cards].sort((a, b) => b.cardIndex - a.cardIndex),
  });
}

export function buildCardFeeds(
  input: CardBuildOptions & { cards: readonly SelectedCard[] },
) {
  if (input.cards.some((card) => card.kind !== 0))
    throw new EngineError("errors.cardMoved");
  return cardBatches(input.cards).map((cards) =>
    checked(
      transaction(input, [
        feedBackIx(webDeployment().programId, {
          owner: input.wallet,
          cardIndices: cards.map((card) => card.cardIndex),
        }),
      ]),
    ),
  );
}

/** Exits deliberately need no Config, Machine, flags, service or attestation. */
export function buildCardsExit(
  input: CardBuildOptions & {
    binder: Binder;
    action: "withdraw_owed" | "close_my_cards";
  },
) {
  if (input.action === "close_my_cards" && !binderClosable(input.binder))
    throw new EngineError("errors.cardMoved");
  return checked(
    transaction(input, [
      input.action === "withdraw_owed"
        ? withdrawOwedIx(webDeployment().programId, { owner: input.wallet })
        : closeBinderIx(webDeployment().programId, { owner: input.wallet }),
    ]),
  );
}
