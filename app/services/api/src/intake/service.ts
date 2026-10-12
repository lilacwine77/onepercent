import { warnCause } from "@onepercent/service-kit";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { SERVICES, WSOL_MINT } from "@onepercent/config";
import {
  evaluateFeedProvenance,
  EvidenceUnavailableError,
  TOKEN_2022_NATIVE_MINT,
  type WalletHistoryEvidence,
  type ConsumptionEvidence,
} from "@onepercent/service-kit/intake";
import { SignerError } from "../internal/error.js";
import { loadIntakeParams, type IntakeParams } from "../internal/params.js";
import {
  feedRequestSchema,
  feedResponseSchema,
  ipHashSchema,
  type FeedBag,
  type FeedAttestResponse,
} from "./schema.js";
import {
  bagsHash,
  feedMessage,
  feedNonces,
  attestationExpiry,
} from "./sdk-adapter.js";
import type { BagRead, FeedState } from "./chain.js";

export interface FeedLogRow {
  messageSha256: string;
  wallet: string;
  nonce: number;
  expiry: number;
  bags: Array<{
    mint: string;
    amount: string;
    path: "self" | "hop";
    via: string | null;
  }>;
  signer: string;
  ipHash: string;
}
export interface IntakeServiceOptions {
  programId: PublicKey;
  params?: IntakeParams;
  signer: {
    publicKey: PublicKey;
    signMessage(message: Uint8Array): Uint8Array;
  };
  guard: { assertAuthorized(): void };
  blockTimeNow(): Promise<number>;
  readState(wallet: string, now: number): Promise<FeedState>;
  readBag(
    wallet: string,
    mint: string,
    minContextSlot: number,
    signal?: AbortSignal,
  ): Promise<BagRead>;
  history(
    wallet: string,
    mint: string,
    snapshotSlot: number,
    throughSlot: number,
    signal?: AbortSignal,
  ): Promise<WalletHistoryEvidence>;
  live(
    wallet: string,
    mint: string,
    holders: string[],
  ): Promise<{
    consumption: ConsumptionEvidence[];
    liveCard: { date: string | null } | null;
  }>;
  /** Timestamp of the last fully indexed confirmed slot, never a slot-to-time estimate. */
  indexerTime(): Promise<number>;
  /** Atomic, insert-only; success precedes every signature in the response. */
  appendLogs(rows: FeedLogRow[]): Promise<void>;
}

async function forEachBounded<T>(
  values: readonly T[],
  run: (value: T) => Promise<void>,
): Promise<void> {
  // Resource scheduling only; accepted bags remain in the original request order.
  const concurrency = 4;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= values.length) return;
        await run(values[index]!);
      }
    }),
  );
}

function abortable<T>(
  signal: AbortSignal,
  slot: () => number | null,
  run: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(new SignerError(503, "evidence_unavailable", undefined, slot()));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    void run().then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export function createIntakeService(options: IntakeServiceOptions) {
  const params = options.params ?? loadIntakeParams();
  const requestSchema = feedRequestSchema(params);
  const assertLag = async (now: number) => {
    const indexedAt = await options.indexerTime();
    if (
      !Number.isSafeInteger(indexedAt) ||
      indexedAt < 0 ||
      now - indexedAt > params.SERVICES.indexer.maxLagSecondsForIntake
    )
      throw new SignerError(503, "indexer_lag");
  };
  return {
    requestSchema,
    async handle(
      input: unknown,
      ipHash: string,
      signal?: AbortSignal,
    ): Promise<FeedAttestResponse> {
      const request = requestSchema.safeParse(input);
      if (!request.success || !ipHashSchema.safeParse(ipHash).success)
        throw new SignerError(400, "invalid_request");
      options.guard.assertAuthorized();
      const { wallet, chunks } = request.data;
      signal = AbortSignal.any([
        AbortSignal.timeout(SERVICES.transport.rpcTimeoutMs),
        ...(signal ? [signal] : []),
      ]);
      let latestSlot: number | null = null;
      return abortable(
        signal,
        () => latestSlot,
        async () => {
          try {
            signal?.throwIfAborted();
            const now = await options.blockTimeNow();
            await assertLag(now);
            const state = await options.readState(wallet, now);
            latestSlot = state.slot;
            let historyUpperSlot = state.slot;
            const history = new Map<
              string,
              { own: WalletHistoryEvidence; sender?: WalletHistoryEvidence }
            >();
            // History tasks share the request deadline. Ordering is applied only
            // when selecting final bags, so latency never changes cap allocation.
            const unavailable = new Set<string>();
            if (state.feedOpen && !state.teamWallets.includes(wallet)) {
              await forEachBounded(chunks.flat(), async ({ mint, amount }) => {
                signal?.throwIfAborted();
                if (
                  mint === state.tokenMint ||
                  mint === WSOL_MINT ||
                  mint === TOKEN_2022_NATIVE_MINT
                )
                  return;
                const preliminary = await options.readBag(
                  wallet,
                  mint,
                  state.slot,
                  signal,
                );
                if (
                  !Number.isSafeInteger(preliminary.slot) ||
                  preliminary.slot < state.slot
                )
                  throw new SignerError(503, "chain_unavailable");
                historyUpperSlot = Math.max(historyUpperSlot, preliminary.slot);
                if (
                  !preliminary.ok ||
                  preliminary.bag.amount === 0n ||
                  (amount !== undefined &&
                    BigInt(amount) !== preliminary.bag.amount)
                )
                  return;
                try {
                  const own = await options.history(
                    wallet,
                    mint,
                    state.snapshotSlot,
                    preliminary.slot,
                    signal,
                  );
                  if (own.first === null) {
                    unavailable.add(mint);
                    return;
                  }
                  const sender =
                    own.first?.kind === "transfer" &&
                    own.first.sender &&
                    own.first.sender !== wallet &&
                    !state.teamWallets.includes(own.first.sender)
                      ? await options.history(
                          own.first.sender,
                          mint,
                          state.snapshotSlot,
                          preliminary.slot,
                          signal,
                        )
                      : undefined;
                  history.set(mint, { own, sender });
                } catch (error) {
                  if (!(error instanceof EvidenceUnavailableError)) throw error;
                  warnCause("evidence_unavailable", error);
                  unavailable.add(mint);
                }
              });
            }
            const blockTime = await options.blockTimeNow();
            signal?.throwIfAborted();
            await assertLag(blockTime);
            const current = await options.readState(wallet, blockTime);
            if (current.slot < state.slot)
              throw new SignerError(503, "chain_unavailable");
            latestSlot = current.slot;
            if (
              current.snapshotSlot !== state.snapshotSlot ||
              current.snapshotDate !== state.snapshotDate
            )
              throw new SignerError(503, "evidence_unavailable");
            const response: FeedAttestResponse = {
              wallet,
              asOfSlot: current.slot,
              signer: options.signer.publicKey.toBase58(),
              snapshotSlot: current.snapshotSlot,
              attestations: [],
              refused: [],
            };
            let room = Math.max(
              0,
              params.FEED_RULES.freshCapPerWallet - current.freshInDeck,
            );
            const accepted: Array<{
              chunk: number;
              bags: FeedBag[];
              logBags: FeedLogRow["bags"];
            }> = [];
            for (const [chunk, requested] of chunks.entries()) {
              const bags: FeedBag[] = [],
                logBags: FeedLogRow["bags"] = [];
              for (const { mint, amount: requestedAmount } of requested) {
                signal?.throwIfAborted();
                const refuse = (
                  reason: FeedAttestResponse["refused"][number]["reason"],
                  date: string | null = null,
                ) => response.refused.push({ mint, reason, date });
                if (!current.feedOpen) {
                  refuse("feed_closed");
                  continue;
                }
                if (current.teamWallets.includes(wallet)) {
                  refuse("team_wallet");
                  continue;
                }
                if (
                  mint === current.tokenMint ||
                  mint === WSOL_MINT ||
                  mint === TOKEN_2022_NATIVE_MINT
                ) {
                  refuse("mint_forbidden");
                  continue;
                }
                const minimumSlot = Math.max(
                  response.asOfSlot,
                  historyUpperSlot,
                );
                const read = await options.readBag(
                  wallet,
                  mint,
                  minimumSlot,
                  signal,
                );
                if (!Number.isSafeInteger(read.slot) || read.slot < minimumSlot)
                  throw new SignerError(503, "chain_unavailable");
                response.asOfSlot = read.slot;
                latestSlot = read.slot;
                if (!read.ok) {
                  refuse(read.reason);
                  continue;
                }
                const { bag } = read;
                if (bag.amount === 0n) {
                  refuse("zero_balance");
                  continue;
                }
                if (
                  requestedAmount !== undefined &&
                  BigInt(requestedAmount) !== bag.amount
                ) {
                  refuse("not_whole_bag");
                  continue;
                }
                const evidence = history.get(mint);
                if (!evidence || unavailable.has(mint)) {
                  refuse("evidence_unavailable");
                  continue;
                }
                const live = await options.live(wallet, mint, [
                  wallet,
                  ...(evidence.own.first?.sender
                    ? [evidence.own.first.sender]
                    : []),
                ]);
                let result: ReturnType<typeof evaluateFeedProvenance>;
                try {
                  result = evaluateFeedProvenance({
                    wallet,
                    mint,
                    snapshotSlot: current.snapshotSlot,
                    snapshotDate: current.snapshotDate,
                    balanceNow: bag.amount,
                    history: evidence.own,
                    senderHistory: evidence.sender,
                    teamWallets: current.teamWallets,
                    ...live,
                  });
                } catch (error) {
                  if (!(error instanceof EvidenceUnavailableError)) throw error;
                  warnCause("evidence_unavailable", error);
                  refuse("evidence_unavailable");
                  continue;
                }
                if (!result.eligible) {
                  refuse(result.reason, result.date);
                  continue;
                }
                if (room === 0) {
                  refuse("fresh_cap");
                  continue;
                }
                room--;
                bags.push({ ...bag, amount: bag.amount.toString() });
                logBags.push({
                  mint,
                  amount: bag.amount.toString(),
                  path: result.path,
                  via: result.via,
                });
              }
              if (bags.length) accepted.push({ chunk, bags, logBags });
            }
            if (!accepted.length) return feedResponseSchema.parse(response);
            // Expiry is taken after evidence and live reads, solely from cluster time.
            const finalTime = await options.blockTimeNow();
            signal?.throwIfAborted();
            await assertLag(finalTime);
            options.guard.assertAuthorized();
            const expiry = Number(
              attestationExpiry(
                BigInt(finalTime),
                params.ATTESTATIONS.feedTtlSeconds,
              ),
            );
            const nonces = feedNonces(
              current.base,
              current.bits,
              accepted.length,
            );
            const prepared = accepted.map(({ chunk, bags, logBags }, i) => {
              const messageBags = bags.map((b) => ({
                mint: new PublicKey(b.mint),
                amount: BigInt(b.amount),
              }));
              const nonce = nonces[i]!;
              const message = feedMessage(
                {
                  programId: options.programId,
                  wallet: new PublicKey(wallet),
                  nonce,
                  expiry: BigInt(expiry),
                  bags: messageBags,
                },
                params.ATTESTATIONS.feedDomain,
              );
              const row: FeedLogRow = {
                messageSha256: createHash("sha256")
                  .update(message)
                  .digest("hex"),
                wallet,
                nonce,
                expiry,
                bags: logBags,
                signer: response.signer,
                ipHash,
              };
              return {
                chunk,
                bags,
                message,
                row,
                bagsHash: bagsHash(messageBags).toString("hex"),
              };
            });
            try {
              signal?.throwIfAborted();
              await options.appendLogs(prepared.map((p) => p.row));
            } catch (error) {
              warnCause("attestation_log_unavailable", error);
              throw new SignerError(503, "attestation_log_unavailable");
            }
            options.guard.assertAuthorized();
            signal?.throwIfAborted();
            for (const p of prepared) {
              const signature = options.signer.signMessage(p.message);
              if (signature.length !== 64)
                throw new SignerError(503, "signer_unavailable");
              response.attestations.push({
                chunk: p.chunk,
                nonce: p.row.nonce,
                expiry,
                bagsHash: p.bagsHash,
                message: p.message.toString("base64"),
                signature: Buffer.from(signature).toString("base64"),
                bags: p.bags,
              });
            }
            return feedResponseSchema.parse(response);
          } catch (error) {
            warnCause("intake_request_failed", error);
            if (error instanceof SignerError)
              throw new SignerError(
                error.status,
                error.reason,
                error.retryAfterS,
                error.asOfSlot ?? latestSlot,
              );
            if (
              error instanceof Error &&
              ["role_mismatch", "role_disabled", "config_unavailable"].includes(
                error.message,
              )
            )
              throw new SignerError(503, error.message, undefined, latestSlot);
            throw new SignerError(
              503,
              "evidence_unavailable",
              undefined,
              latestSlot,
            );
          }
        },
      );
    },
  };
}
export type IntakeService = ReturnType<typeof createIntakeService>;
