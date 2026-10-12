import {
  isRpcNodeLagCode,
  rpcNodeLagDelayMs,
  warnCause,
} from "@onepercent/service-kit";
import { SERVICES } from "@onepercent/config";
import {
  PROGRAM_IDS,
  XRAY,
  type RawAccount,
  type SnapshotEvidence,
} from "@onepercent/eligibility";
import { z } from "zod";
import type { ChainSource } from "./provider-types.js";

const number = z.number().int().nonnegative().safe();
const accountSchema = z
  .object({
    owner: z.string(),
    lamports: number,
    data: z.tuple([z.string(), z.literal("base64")]),
  })
  .passthrough();
const accountsSchema = z
  .object({
    context: z.object({ slot: number }).passthrough(),
    value: z.array(accountSchema.nullable()),
  })
  .passthrough();
const tokensSchema = z
  .object({
    context: z.object({ slot: number }).passthrough(),
    value: z.array(
      z.object({ pubkey: z.string(), account: accountSchema }).passthrough(),
    ),
  })
  .passthrough();
export const assetsSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string(),
          content: z
            .object({
              metadata: z
                .object({
                  symbol: z.string().optional(),
                  name: z.string().optional(),
                })
                .passthrough()
                .optional(),
              links: z
                .object({ image: z.string().optional() })
                .passthrough()
                .optional(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const balanceSchema = z
  .object({
    owner: z.string().optional(),
    mint: z.string(),
    uiTokenAmount: z
      .object({ amount: z.string().regex(/^\d+$/) })
      .passthrough(),
  })
  .passthrough();
const historySchema = z
  .object({
    data: z.array(
      z
        .object({
          slot: number,
          meta: z
            .object({
              postTokenBalances: z.array(balanceSchema).nullable().optional(),
            })
            .passthrough()
            .nullable(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const envelopeSchema = z
  .object({
    result: z.unknown().optional(),
    error: z.object({ code: z.number() }).passthrough().optional(),
  })
  .passthrough();
function raw(
  address: string,
  value: z.infer<typeof accountSchema>,
): RawAccount {
  return {
    address,
    owner: value.owner,
    lamports: BigInt(value.lamports),
    data: Buffer.from(value.data[0], "base64"),
  };
}
export class ChainSourceError extends Error {
  constructor() {
    super("Chain provider request failed");
    this.name = "ChainSourceError";
  }
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void work.catch((error) => {
      warnCause("xray_late_rpc_failed", error);
    });
    return Promise.reject(new ChainSourceError());
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new ChainSourceError());
    signal.addEventListener("abort", abort, { once: true });
    work
      .then(resolve, (error: unknown) => {
        if (signal.aborted) warnCause("xray_late_rpc_failed", error);
        reject(error);
      })
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
async function bounded<T>(
  run: (signal: AbortSignal) => Promise<T>,
  milliseconds: number,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const signal = parent
    ? AbortSignal.any([controller.signal, parent])
    : controller.signal;
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await abortable(run(signal), signal);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await abortable(
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, milliseconds);
      }),
      signal,
    );
  } finally {
    clearTimeout(timer);
  }
}

export class HeliusChainSource implements ChainSource {
  private readonly fetcher: typeof fetch;
  private activeAccountBatches = 0;
  private readonly accountWaiters: (() => void)[] = [];
  constructor(
    private readonly options: { rpcUrl: string; fetch?: typeof fetch },
  ) {
    this.fetcher = options.fetch ?? fetch;
  }
  private async accountBatch<T>(
    run: () => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) throw new ChainSourceError();
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener("abort", cancel);
        this.activeAccountBatches += 1;
        resolve();
      };
      const cancel = () => {
        const index = this.accountWaiters.indexOf(start);
        if (index >= 0) this.accountWaiters.splice(index, 1);
        reject(new ChainSourceError());
      };
      if (this.activeAccountBatches < 4) start();
      else {
        this.accountWaiters.push(start);
        signal.addEventListener("abort", cancel, { once: true });
      }
    });
    try {
      if (signal.aborted) throw new ChainSourceError();
      return await run();
    } finally {
      this.activeAccountBatches -= 1;
      this.accountWaiters.shift()?.();
    }
  }
  private async rpc<T>(
    method: string,
    params: unknown,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let transportRetries = 0;
    let nodeLagRetries = 0;
    for (;;) {
      if (signal?.aborted) throw new ChainSourceError();
      const outcome = await bounded(
        async (callSignal) => {
          try {
            const response = await this.fetcher(this.options.rpcUrl, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
              signal: callSignal,
            });
            if (!response.ok) {
              if (
                transportRetries === 0 &&
                (response.status === 429 || response.status >= 500)
              ) {
                transportRetries += 1;
                return {
                  retry: true,
                  delayMs: 100 + Math.random() * 200,
                } as const;
              }
              throw new ChainSourceError();
            }
            const envelope = envelopeSchema.parse(await response.json());
            if (envelope.error) {
              if (
                isRpcNodeLagCode(envelope.error.code) &&
                nodeLagRetries < SERVICES.transport.rpcNodeLagMaxAttempts - 1
              )
                return {
                  retry: true,
                  delayMs: rpcNodeLagDelayMs(nodeLagRetries++),
                } as const;
              throw new ChainSourceError();
            }
            return {
              retry: false,
              data: schema.parse(envelope.result),
            } as const;
          } catch (error) {
            warnCause("xray_rpc_failed", error);
            throw new ChainSourceError();
          }
        },
        5000,
        signal,
      );
      if (!outcome.retry) return outcome.data;
      // These are reads only. Keep transport and node-lag retry budgets bounded
      // and let the caller's total deadline cancel either backoff.
      await bounded(
        (retrySignal) => delay(outcome.delayMs, retrySignal),
        Math.max(500, SERVICES.transport.rpcNodeLagBackoffMaxMs + 100),
        signal,
      );
    }
  }
  getTokenAccounts(owner: string, parent?: AbortSignal): Promise<RawAccount[]> {
    return bounded(
      async (signal) => {
        const pages = await Promise.all(
          [PROGRAM_IDS.splToken, PROGRAM_IDS.token2022].map((programId) =>
            this.rpc(
              "getTokenAccountsByOwner",
              [
                owner,
                { programId },
                { encoding: "base64", commitment: "confirmed" },
              ],
              tokensSchema,
              signal,
            ),
          ),
        );
        return pages.flatMap((page) =>
          page.value.map(({ pubkey, account }) => raw(pubkey, account)),
        );
      },
      10_000,
      parent,
    );
  }
  async getAccounts(
    addresses: string[],
    parent?: AbortSignal,
  ): Promise<Map<string, RawAccount | null>> {
    const result = await this.getAccountsPartial(addresses, parent);
    if (result.failed.length) throw new ChainSourceError();
    return result.accounts;
  }
  async getAccountsPartial(
    addresses: string[],
    parent?: AbortSignal,
  ): Promise<{ accounts: Map<string, RawAccount | null>; failed: string[] }> {
    const received = new Map<string, RawAccount | null>();
    let next = 0;
    try {
      await bounded(
        async (signal) => {
          const worker = async () => {
            while (next < addresses.length && !signal.aborted) {
              const start = next;
              next += XRAY.accountsPerBatch;
              const chunk = addresses.slice(start, next);
              try {
                const page = await this.accountBatch(
                  () =>
                    this.rpc(
                      "getMultipleAccounts",
                      [chunk, { encoding: "base64", commitment: "confirmed" }],
                      accountsSchema,
                      signal,
                    ),
                  signal,
                );
                if (page.value.length !== chunk.length || signal.aborted)
                  continue;
                chunk.forEach((address, index) => {
                  const account = page.value[index];
                  received.set(address, account ? raw(address, account) : null);
                });
              } catch (error) {
                warnCause("xray_account_batch_failed", error);
                // Failed batches stay absent; successful nulls mean no account.
              }
            }
          };
          await Promise.all(
            Array.from(
              {
                length: Math.min(
                  4,
                  Math.ceil(addresses.length / XRAY.accountsPerBatch),
                ),
              },
              worker,
            ),
          );
        },
        10_000,
        parent,
      );
    } catch (error) {
      warnCause("xray_accounts_incomplete", error);
      // The caller can retain completed batches when its deadline expires.
    }
    return {
      accounts: new Map(
        addresses
          .filter((address) => received.has(address))
          .map((address) => [address, received.get(address)!]),
      ),
      failed: addresses.filter((address) => !received.has(address)),
    };
  }
  async getMetadata(
    owner: string,
    parent?: AbortSignal,
  ): ReturnType<ChainSource["getMetadata"]> {
    const result: Awaited<ReturnType<ChainSource["getMetadata"]>> = new Map();
    try {
      await bounded(
        async (signal) => {
          for (let page = 1; ; page += 1) {
            const data = await this.rpc(
              "getAssetsByOwner",
              {
                ownerAddress: owner,
                page,
                limit: 1000,
                options: { showFungible: true, showZeroBalance: true },
              },
              assetsSchema,
              signal,
            );
            for (const asset of data.items) {
              const metadata = asset.content?.metadata;
              result.set(asset.id, {
                ...(metadata?.symbol ? { symbol: metadata.symbol } : {}),
                ...(metadata?.name ? { name: metadata.name } : {}),
                ...(asset.content?.links?.image
                  ? { image: asset.content.links.image }
                  : {}),
              });
            }
            if (data.items.length < 1000) return;
          }
        },
        1500,
        parent,
      );
    } catch (error) {
      warnCause("xray_metadata_incomplete", error);
      // Names are optional; keep completed DAS pages after its short deadline.
    }
    return result;
  }
  getSlot(parent?: AbortSignal): Promise<number> {
    return bounded(
      (signal) =>
        this.rpc("getSlot", [{ commitment: "confirmed" }], number, signal),
      10_000,
      parent,
    );
  }
  getBlockTime(slot: number, parent?: AbortSignal): Promise<number | null> {
    return bounded(
      (signal) => this.rpc("getBlockTime", [slot], number.nullable(), signal),
      10_000,
      parent,
    );
  }
  async getSnapshotEvidence(
    owner: string,
    mints: string[],
    slotS: number,
    parent?: AbortSignal,
  ): Promise<Map<string, SnapshotEvidence>> {
    const result = new Map<string, SnapshotEvidence>(
      mints.map((mint) => [mint, { balanceAtS: null }]),
    );
    if (mints.length === 0) return result;
    let next = 0;
    try {
      await bounded(
        async (signal) => {
          const worker = async () => {
            while (next < mints.length && !signal.aborted) {
              const mint = mints[next++];
              if (!mint) break;
              try {
                // Helius documents full legacy/v0/v1 results; meta is on each data item.
                const data = await this.rpc(
                  "getTransactionsForAddress",
                  [
                    owner,
                    {
                      transactionDetails: "full",
                      encoding: "jsonParsed",
                      sortOrder: "desc",
                      commitment: "finalized",
                      limit: 1,
                      maxSupportedTransactionVersion: 1,
                      filters: {
                        slot: { lte: slotS },
                        tokenAccounts: "balanceChanged",
                        tokenTransfer: { mint },
                      },
                    },
                  ],
                  historySchema,
                  signal,
                );
                if (signal.aborted) continue;
                if (data.data.length === 0)
                  result.set(mint, { balanceAtS: 0n });
                else {
                  const transaction = data.data[0];
                  const balances = transaction?.meta?.postTokenBalances;
                  if (transaction && transaction.slot <= slotS && balances)
                    result.set(mint, {
                      balanceAtS: balances
                        .filter(
                          (balance) =>
                            balance.owner === owner && balance.mint === mint,
                        )
                        .reduce(
                          (sum, balance) =>
                            sum + BigInt(balance.uiTokenAmount.amount),
                          0n,
                        ),
                    });
                }
              } catch (error) {
                warnCause("xray_evidence_batch_failed", error);
                /* Evidence is advisory; unsupported plans and failures stay unknown. */
              }
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(8, mints.length) }, worker),
          );
        },
        2500,
        parent,
      );
    } catch (error) {
      warnCause("xray_evidence_incomplete", error);
      /* The total evidence budget expires without failing the scan. */
    }
    return result;
  }
}
