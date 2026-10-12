import type { JsonRpcClient } from "@onepercent/service-kit";
import { z } from "zod";
import {
  analyzeWalletHistory,
  createWalletHistorySnapshot,
  normalizeHistoryTransaction,
  EvidenceUnavailableError,
  type IntakeTransaction,
  type NormalizeHistoryOptions,
  type WalletHistorySnapshot,
} from "@onepercent/service-kit/intake";

export interface IntakeHistoryCacheOptions {
  evidenceCacheSeconds: number;
  now?: () => number;
}

/** Complete evidence: only the immutable prefix <= S is cached; every live tail is read again. */
export function createIntakeHistoryReader(
  rpc: Pick<JsonRpcClient, "request">,
  normalization: NormalizeHistoryOptions = {},
  cacheOptions?: IntakeHistoryCacheOptions,
) {
  if (
    cacheOptions &&
    (!Number.isSafeInteger(cacheOptions.evidenceCacheSeconds) ||
      cacheOptions.evidenceCacheSeconds <= 0)
  )
    throw new EvidenceUnavailableError();
  const now = cacheOptions?.now ?? Date.now;
  const cache = new Map<
    string,
    { expires: number; snapshot: WalletHistorySnapshot }
  >();
  // Resource bound only; eviction never changes a verdict or skips the live read.
  const maxCachedWalletMints = 256;
  async function readRange(
    wallet: string,
    mint: string,
    throughSlot: number,
    minContextSlot: number,
    commitment: "confirmed" | "finalized",
    afterSlot?: number,
    signal?: AbortSignal,
  ) {
    const transactions: IntakeTransaction[] = [];
    const tokens = new Set<string>();
    let paginationToken: string | undefined;
    do {
      signal?.throwIfAborted();
      const page = await rpc.request(
        "getTransactionsForAddress",
        [
          wallet,
          {
            transactionDetails: "full",
            encoding: "jsonParsed",
            sortOrder: "asc",
            maxSupportedTransactionVersion: 1,
            commitment,
            minContextSlot,
            filters: {
              slot: {
                lte: throughSlot,
                ...(afterSlot === undefined ? {} : { gt: afterSlot }),
              },
              tokenAccounts: "balanceChanged",
              // Helius permits this filter only for finalized history. The
              // short confirmed tail still includes every token account.
              ...(commitment === "finalized"
                ? { tokenTransfer: { mint } }
                : {}),
            },
            ...(paginationToken ? { paginationToken } : {}),
          },
        ],
        z.object({
          data: z.array(z.unknown()),
          paginationToken: z.string().min(1).nullable(),
        }),
        signal,
      );
      for (const raw of page.data) {
        const transaction = normalizeHistoryTransaction(raw, normalization);
        if (!transaction) continue;
        if (
          transaction.slot > throughSlot ||
          (afterSlot !== undefined && transaction.slot <= afterSlot)
        )
          throw new EvidenceUnavailableError();
        transactions.push(transaction);
      }
      paginationToken = page.paginationToken ?? undefined;
      if (paginationToken) {
        if (!page.data.length || tokens.has(paginationToken))
          throw new EvidenceUnavailableError();
        tokens.add(paginationToken);
      }
    } while (paginationToken);
    const counts = new Map<number, number>();
    for (const tx of transactions)
      counts.set(tx.slot, (counts.get(tx.slot) ?? 0) + 1);
    for (const [slot, count] of counts)
      if (count > 1) {
        signal?.throwIfAborted();
        const block = await rpc.request(
          "getBlock",
          [
            slot,
            {
              commitment,
              transactionDetails: "signatures",
              rewards: false,
              maxSupportedTransactionVersion: 1,
            },
          ],
          z.object({ signatures: z.array(z.string().min(1)) }),
          signal,
        );
        for (const tx of transactions.filter((row) => row.slot === slot)) {
          const index = block.signatures.indexOf(tx.signature);
          if (index < 0) throw new EvidenceUnavailableError();
          tx.transactionIndex = index;
        }
      }
    signal?.throwIfAborted();
    return transactions;
  }
  return async (
    wallet: string,
    mint: string,
    snapshotSlot: number,
    throughSlot: number,
    signal?: AbortSignal,
  ) => {
    if (
      !Number.isSafeInteger(snapshotSlot) ||
      snapshotSlot < 0 ||
      !Number.isSafeInteger(throughSlot) ||
      throughSlot < snapshotSlot
    )
      throw new EvidenceUnavailableError();
    signal?.throwIfAborted();
    const finalizedSlot = await rpc.request(
      "getSlot",
      [{ commitment: "finalized" }],
      z.number().int().nonnegative().safe(),
      signal,
    );
    if (snapshotSlot > finalizedSlot) throw new EvidenceUnavailableError();
    const finalizedThrough = Math.min(finalizedSlot, throughSlot);
    const liveTail = async (afterSlot: number) => {
      const transactions =
        finalizedThrough > afterSlot
          ? await readRange(
              wallet,
              mint,
              finalizedThrough,
              finalizedThrough,
              "finalized",
              afterSlot,
              signal,
            )
          : [];
      if (throughSlot > finalizedThrough)
        transactions.push(
          ...(await readRange(
            wallet,
            mint,
            throughSlot,
            throughSlot,
            "confirmed",
            finalizedThrough,
            signal,
          )),
        );
      return transactions;
    };
    if (!cacheOptions)
      return analyzeWalletHistory({
        wallet,
        mint,
        snapshotSlot,
        transactions: [
          ...(await readRange(
            wallet,
            mint,
            finalizedThrough,
            finalizedThrough,
            "finalized",
            undefined,
            signal,
          )),
          ...(await liveTail(finalizedThrough)),
        ],
        complete: true,
      });
    signal?.throwIfAborted();
    const cacheKey = `${wallet}:${mint}:${snapshotSlot}`;
    let entry = cache.get(cacheKey);
    if (entry && entry.expires <= now()) {
      cache.delete(cacheKey);
      entry = undefined;
    }
    if (!entry) {
      const transactions = await readRange(
        wallet,
        mint,
        snapshotSlot,
        finalizedThrough,
        "finalized",
        undefined,
        signal,
      );
      const snapshot = createWalletHistorySnapshot({
        wallet,
        mint,
        snapshotSlot,
        transactions,
        complete: true,
      });
      signal?.throwIfAborted();
      entry = {
        snapshot,
        expires: now() + cacheOptions.evidenceCacheSeconds * 1000,
      };
      cache.set(cacheKey, entry);
      while (cache.size > maxCachedWalletMints)
        cache.delete(cache.keys().next().value!);
    } else {
      cache.delete(cacheKey);
      cache.set(cacheKey, entry);
    }
    const transactions = await liveTail(snapshotSlot);
    return analyzeWalletHistory({
      wallet,
      mint,
      snapshotSlot,
      transactions,
      complete: true,
      snapshot: entry.snapshot,
    });
  };
}
