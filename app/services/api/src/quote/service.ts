import { warnCause } from "@onepercent/service-kit";
import { createHash } from "node:crypto";
import { SELL_BACK } from "@onepercent/config";
import {
  quoteSellBackBatch,
  type MachineSnapshot,
  type SellBackBatchQuote,
  type SellBackRefusalReason,
  type SellBackResult,
  type ValueNow,
  type ValueNowResult,
} from "@onepercent/market";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { SignerError } from "../internal/error.js";
import {
  attestationExpiry,
  DRAFT_SDK,
  quoteStateSchema,
  rotateHour,
  type QuoteState,
} from "./draft-sdk.js";
import {
  checkedSellBackEncoder,
  type SellBackMessageEncoder,
} from "./encoder.js";
import {
  sellBackQuoteRequestSchema,
  sellBackQuoteResponseSchema,
  timestampSchema,
  type SellBackQuoteRequest,
  type SellBackQuoteResponse,
} from "./schema.js";

export interface QuoteLogRow {
  messageSha256: string;
  owner: string;
  mint: string;
  cardIndices: number[];
  amounts: bigint[];
  totalAmount: bigint;
  quoteLamports: bigint;
  valueLamports: bigint;
  payoutLamports: bigint;
  expiry: Date;
  nonce: number;
  router: string;
  requestId: string;
  signer: string;
  ipHash: string;
}
export interface QuoteServiceOptions {
  programId: PublicKey;
  readState(owner: PublicKey): Promise<QuoteState>;
  blockTimeNow(): Promise<number>;
  valueNow: ValueNow;
  guard: { assertAuthorized(): void };
  signer: {
    publicKey: PublicKey;
    signMessage(message: Uint8Array): Uint8Array;
  };
  appendLog(row: QuoteLogRow): Promise<void>;
  encoder?: SellBackMessageEncoder;
}
export interface QuoteService {
  handle(
    request: unknown,
    ipHash: string,
    signal?: AbortSignal,
  ): Promise<SellBackQuoteResponse>;
}
const ipHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const refused = (
  reason: SellBackRefusalReason,
): Extract<SellBackResult<never>, { ok: false }> => ({
  ok: false,
  reason,
});

async function evaluateState(
  state: QuoteState,
  request: SellBackQuoteRequest,
  now: number,
  valueNow: ValueNow,
): Promise<SellBackResult<SellBackBatchQuote>> {
  if (state.sellBackPaused) return refused("PHASE");
  const selected = request.cardIndices.map(
    (index) => state.binder.cards[index],
  );
  if (selected.some((card) => card === undefined))
    return refused("INVALID_INPUT");
  const cards = selected.map((card, i) => ({
    cardId: `${request.owner}:${request.cardIndices[i]!}`,
    cardIndex: request.cardIndices[i]!,
    mint: card!.mint,
    amount: card!.amount,
    valueLamports: card!.value,
    kind: DRAFT_SDK.kinds[card!.kind] ?? "other",
  }));
  const machine = rotateHour(state.machine, BigInt(now));
  const bucket = machine.buckets.find(
    (entry) => entry.class !== 0 && entry.mint === cards[0]!.mint,
  );
  if (!bucket) return refused("MINT");
  if (machine.end_ts < 0n || machine.end_ts > BigInt(Number.MAX_SAFE_INTEGER))
    return refused("PHASE");
  const snapshot: MachineSnapshot = {
    phase: machine.phase === DRAFT_SDK.onAirPhase ? "OnAir" : "Other",
    endTs: Number(machine.end_ts),
    stockSolLamports: machine.stock_sol,
    stockBookLamports:
      machine.stock_sol +
      machine.buckets.reduce((sum, entry) => sum + entry.cost, 0n),
    hitOutLastHourLamports: machine.hit_out_last_hour,
    sbHourIndex: Number(machine.hour_index),
    sbPaidHourLamports: machine.sb_paid_hour,
    stockSolAtHourStartLamports: machine.sol_at_hour_start,
    bucket: {
      mint: bucket.mint,
      class: bucket.class === 1 ? "MAJOR" : "TRENDING",
      enabled: bucket.enabled,
      bookCostLamports: bucket.cost,
      capLamports: bucket.cap,
    },
  };
  const result = await quoteSellBackBatch(
    { owner: request.owner, cards, nonce: state.binder.sb_nonce, nowTs: now },
    snapshot,
    valueNow,
  );
  // X2 currently permits a floor-rounded zero payout; the program rejects it.
  return result.ok && result.quote.payoutLamports === 0n
    ? refused("INVALID_INPUT")
    : result;
}
function ttlOf(quote: SellBackBatchQuote): number {
  return SELL_BACK.quoteTtlSeconds[
    quote.bucketClass === "MAJOR" ? "major" : "trending"
  ];
}

export function createQuoteService(options: QuoteServiceOptions): QuoteService {
  const encode = checkedSellBackEncoder(options.encoder);
  return {
    async handle(raw, ipHash, signal) {
      let asOfSlot: number | undefined;
      const assertActive = () => {
        if (signal?.aborted) throw new SignerError(503, "request_aborted");
      };
      const respondRefusal = (
        result: Extract<SellBackResult<SellBackBatchQuote>, { ok: false }>,
      ) =>
        sellBackQuoteResponseSchema.parse({
          ok: false,
          reason: result.reason,
          asOfSlot,
        });
      try {
        assertActive();
        const request = sellBackQuoteRequestSchema.safeParse(raw);
        if (!request.success || !ipHashSchema.safeParse(ipHash).success)
          throw new SignerError(400, "invalid_request");
        options.guard.assertAuthorized();
        const owner = new PublicKey(request.data.owner);
        const readState = async () => {
          try {
            const state = quoteStateSchema.parse(
              await options.readState(owner),
            );
            const previousSlot = asOfSlot;
            asOfSlot = state.asOfSlot;
            if (
              state.binder.owner !== request.data.owner ||
              (previousSlot !== undefined && state.asOfSlot < previousSlot)
            )
              throw new Error("chain_unavailable");
            return state;
          } catch (error) {
            warnCause("chain_unavailable", error);
            throw new SignerError(503, "chain_unavailable");
          }
        };
        const readTime = async () => {
          try {
            return timestampSchema.parse(await options.blockTimeNow());
          } catch (error) {
            warnCause("chain_unavailable", error);
            throw new SignerError(503, "chain_unavailable");
          }
        };
        const initial = await readState();
        assertActive();
        const blockTime = await readTime();
        assertActive();
        let live: ValueNowResult | undefined;
        const first = await evaluateState(
          initial,
          request.data,
          blockTime,
          async (mint, amount) => {
            live = await options.valueNow(mint, amount);
            return live;
          },
        );
        assertActive();
        if (!first.ok) return respondRefusal(first);

        // D22: final live read supplies the response slot and the last pause/card/budget checks.
        const current = await readState();
        assertActive();
        const finalTime = await readTime();
        assertActive();
        if (finalTime < blockTime)
          throw new SignerError(503, "chain_unavailable");
        const result = await evaluateState(
          current,
          request.data,
          finalTime,
          async (mint, amount) => {
            // Preserve one executable /order for the original batch total.
            if (
              !live ||
              mint !== first.quote.mint ||
              amount !== first.quote.totalAmount
            )
              return { status: "unavailable", reason: "NO_QUOTE" };
            return live;
          },
        );
        assertActive();
        if (!result.ok) return respondRefusal(result);
        const quote = result.quote;
        // Re-reading chain state must never lengthen the market quote's lifetime.
        const expiry = attestationExpiry(
          BigInt(blockTime),
          Math.min(ttlOf(first.quote), ttlOf(quote)),
        );
        if (BigInt(finalTime) > expiry)
          return respondRefusal(refused("QUOTE_UNAVAILABLE"));
        const descending = quote.cards
          .map(({ cardIndex, amount }) => ({ index: cardIndex, amount }))
          .sort((a, b) => b.index - a.index);
        const message = Buffer.from(
          encode({
            programId: options.programId,
            owner,
            mint: new PublicKey(quote.mint),
            cards: descending,
            totalAmount: quote.totalAmount,
            quoteLamports: quote.quoteLamports,
            expiry,
            nonce: quote.nonce,
          }),
        );
        const response = sellBackQuoteResponseSchema.parse({
          asOfSlot,
          ok: true,
          quote: {
            owner: owner.toBase58(),
            mint: quote.mint,
            cards: descending.map((card) => ({
              index: card.index,
              amount: card.amount.toString(),
            })),
            totalAmount: quote.totalAmount.toString(),
            quoteLamports: quote.quoteLamports.toString(),
            stockedValueLamports: quote.stockedValueLamports.toString(),
            valueLamports: quote.valueLamports.toString(),
            payoutLamports: quote.payoutLamports.toString(),
            expiry: Number(expiry),
            nonce: quote.nonce,
            bucketClass: quote.bucketClass,
            message: message.toString("base64"),
            signature: Buffer.alloc(64).toString("base64"),
            signer: options.signer.publicKey.toBase58(),
            router: quote.router,
            requestId: quote.requestId,
          },
        });
        if (!response.ok) throw new SignerError(503, "signer_unavailable");
        options.guard.assertAuthorized();
        assertActive();
        try {
          await options.appendLog({
            messageSha256: createHash("sha256").update(message).digest("hex"),
            owner: owner.toBase58(),
            mint: quote.mint,
            cardIndices: descending.map((card) => card.index),
            amounts: descending.map((card) => card.amount),
            totalAmount: quote.totalAmount,
            quoteLamports: quote.quoteLamports,
            valueLamports: quote.valueLamports,
            payoutLamports: quote.payoutLamports,
            expiry: new Date(Number(expiry) * 1000),
            nonce: quote.nonce,
            router: quote.router,
            requestId: quote.requestId,
            signer: options.signer.publicKey.toBase58(),
            ipHash,
          });
        } catch (error) {
          warnCause("quote_log_unavailable", error);
          throw new SignerError(503, "quote_log_unavailable");
        }
        assertActive();
        options.guard.assertAuthorized();
        const signature = Buffer.from(options.signer.signMessage(message));
        if (signature.length !== 64)
          throw new SignerError(503, "signer_unavailable");
        response.quote.signature = signature.toString("base64");
        return sellBackQuoteResponseSchema.parse(response);
      } catch (error) {
        warnCause("quote_request_failed", error);
        if (error instanceof SignerError)
          throw new SignerError(
            error.status,
            error.reason,
            error.retryAfterS,
            asOfSlot,
          );
        if (
          error instanceof Error &&
          ["role_mismatch", "role_disabled", "config_unavailable"].includes(
            error.message,
          )
        )
          throw new SignerError(503, error.message, undefined, asOfSlot);
        throw new SignerError(503, "signer_unavailable", undefined, asOfSlot);
      }
    },
  };
}
