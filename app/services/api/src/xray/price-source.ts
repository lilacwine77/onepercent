import { warnCause } from "@onepercent/service-kit";
import {
  WSOL_MINT,
  XRAY,
  XRAY_PRICE_MAX_AGE_SLOTS,
} from "@onepercent/eligibility";
import { z } from "zod";
import { MARKET } from "@onepercent/config";
import type { ChainSource, PriceSource } from "./provider-types.js";

const priceSchema = z.record(
  z.string(),
  z
    .object({
      // Jupiter lists unpriced tokens with only metadata (createdAt, decimals…):
      // such an entry means "no price", never a malformed batch.
      usdPrice: z.number().finite().nonnegative().optional(),
      blockId: z.number().int().nonnegative().safe().nullish(),
    })
    .passthrough(),
);
const tokenSchema = z.array(
  z
    .object({
      id: z.string(),
      symbol: z.string(),
      name: z.string(),
      icon: z.string().nullish(),
      launchpad: z.string().nullish(),
    })
    .passthrough(),
);

export class PriceSourceError extends Error {
  constructor() {
    super("Price provider request failed");
    this.name = "PriceSourceError";
  }
}
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void work.catch((error) => {
      warnCause("xray_late_price_failed", error);
    });
    return Promise.reject(new PriceSourceError());
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new PriceSourceError());
    signal.addEventListener("abort", abort, { once: true });
    work
      .then(resolve, (error: unknown) => {
        if (signal.aborted) warnCause("xray_late_price_failed", error);
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
  } catch (error) {
    warnCause("xray_price_unavailable", error);
    throw new PriceSourceError();
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

export class JupiterPriceSource implements PriceSource {
  private nextAt = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly intervalMs: number;
  private readonly fetcher: typeof fetch;
  private readonly tokenInfo = new Map<
    string,
    {
      value: NonNullable<
        Awaited<ReturnType<PriceSource["getTokenInfo"]>>[string]
      >;
      expiresAt: number;
    }
  >();
  constructor(
    private readonly chain: Pick<ChainSource, "getSlot">,
    private readonly options: {
      apiKey?: string;
      maxRps?: number;
      fetch?: typeof fetch;
      // The manual recorder receives response bodies only; never request URLs or keys.
      record?: (
        kind: "prices" | "tokens" | "recent",
        response: unknown,
      ) => void | Promise<void>;
    } = {},
  ) {
    const rps = options.maxRps ?? (options.apiKey ? 1 : 0.5);
    if (!Number.isFinite(rps) || rps <= 0) throw new PriceSourceError();
    this.intervalMs = 1000 / rps;
    this.fetcher = options.fetch ?? fetch;
  }
  private request(
    path: string,
    kind: "prices" | "tokens" | "recent",
    signal: AbortSignal,
    expiresAt: number,
  ): Promise<unknown> {
    const task = this.queue.then(async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (signal.aborted || Date.now() >= expiresAt)
          throw new PriceSourceError();
        const wait = Math.max(0, this.nextAt - Date.now());
        if (wait > 0) await delay(wait, signal);
        if (signal.aborted || Date.now() >= expiresAt)
          throw new PriceSourceError();
        this.nextAt = Date.now() + this.intervalMs;
        const outcome = await bounded(
          async (callSignal) => {
            const response = await this.fetcher(`https://api.jup.ag${path}`, {
              headers: this.options.apiKey
                ? { "x-api-key": this.options.apiKey }
                : {},
              signal: callSignal,
            });
            if (!response.ok) {
              if (
                attempt === 0 &&
                (response.status === 429 || response.status >= 500)
              )
                return { retry: true } as const;
              throw new PriceSourceError();
            }
            const body: unknown = await response.json();
            await this.options.record?.(kind, body);
            return { retry: false, body } as const;
          },
          5000,
          signal,
        );
        if (!outcome.retry) return outcome.body;
        await delay(100 + Math.random() * 200, signal);
      }
      throw new PriceSourceError();
    });
    // Expired requests are removed when they reach the head, without spending quota.
    this.queue = task.catch(() => undefined);
    return abortable(task, signal);
  }
  getPrices(
    mints: string[],
    parent?: AbortSignal,
  ): ReturnType<PriceSource["getPrices"]> {
    const expiresAt = Date.now() + 10_000;
    return bounded(
      async (signal) => {
        const result: Awaited<ReturnType<PriceSource["getPrices"]>> = {};
        if (mints.length === 0) return result;
        for (
          let start = 0;
          start < mints.length;
          start += XRAY.priceIdsPerCall
        ) {
          const chunk = mints.slice(start, start + XRAY.priceIdsPerCall);
          const parsed = priceSchema.safeParse(
            await this.request(
              `/price/v3?ids=${encodeURIComponent(chunk.join(","))}`,
              "prices",
              signal,
              expiresAt,
            ),
          );
          if (!parsed.success) throw new PriceSourceError();
          // Read the slot after receiving prices, so time queued is included in age.
          const slot = await abortable(this.chain.getSlot(signal), signal);
          if (!Number.isSafeInteger(slot) || slot < 0)
            throw new PriceSourceError();
          for (const mint of chunk) {
            const price = parsed.data[mint];
            // A future block is not evidence of a fresh price from this RPC view.
            result[mint] =
              price?.usdPrice == null ||
              price.blockId == null ||
              price.blockId > slot
                ? undefined
                : {
                    usdPrice: price.usdPrice,
                    blockId: price.blockId,
                    ageSlots: slot - price.blockId,
                  };
          }
        }
        return result;
      },
      10_000,
      parent,
    );
  }
  getTokenInfo(
    mints: string[],
    parent?: AbortSignal,
  ): ReturnType<PriceSource["getTokenInfo"]> {
    const expiresAt = Date.now() + 10_000;
    return bounded(
      async (signal) => {
        const result: Awaited<ReturnType<PriceSource["getTokenInfo"]>> = {};
        if (signal.aborted) throw new PriceSourceError();
        const missing: string[] = [];
        for (const mint of new Set(mints)) {
          const cached = this.tokenInfo.get(mint);
          if (cached && cached.expiresAt > Date.now()) {
            this.tokenInfo.delete(mint);
            this.tokenInfo.set(mint, cached);
            result[mint] = { ...cached.value };
          } else {
            this.tokenInfo.delete(mint);
            missing.push(mint);
          }
        }
        for (
          let start = 0;
          start < missing.length;
          start += MARKET.jupiter.tokensMintsPerCall
        ) {
          const chunk = missing.slice(
            start,
            start + MARKET.jupiter.tokensMintsPerCall,
          );
          const parsed = tokenSchema.safeParse(
            await this.request(
              `/tokens/v2/search?query=${encodeURIComponent(chunk.join(","))}`,
              "tokens",
              signal,
              expiresAt,
            ),
          );
          if (!parsed.success || signal.aborted) throw new PriceSourceError();
          for (const mint of chunk) result[mint] = undefined;
          for (const token of parsed.data) {
            if (!chunk.includes(token.id)) continue;
            const value = {
              symbol: token.symbol,
              name: token.name,
              ...(token.icon ? { logoURI: token.icon } : {}),
              ...(token.launchpad ? { launchpad: token.launchpad } : {}),
            };
            result[token.id] = { ...value };
            this.tokenInfo.delete(token.id);
            this.tokenInfo.set(token.id, {
              value,
              expiresAt: Date.now() + MARKET.tokenInfo.cacheTtlMs,
            });
            if (this.tokenInfo.size > XRAY.cacheMaxEntries) {
              const oldest = this.tokenInfo.keys().next().value;
              if (oldest !== undefined) this.tokenInfo.delete(oldest);
            }
          }
        }
        return result;
      },
      10_000,
      parent,
    );
  }
  async getSolUsd(signal?: AbortSignal): Promise<number> {
    const sol = (await this.getPrices([WSOL_MINT], signal))[WSOL_MINT];
    if (!sol || sol.usdPrice <= 0 || sol.ageSlots > XRAY_PRICE_MAX_AGE_SLOTS)
      throw new PriceSourceError();
    return sol.usdPrice;
  }
  /** Manual fixture discovery only. This keeps every Jupiter call in this adapter. */
  getRecentForRecording(): Promise<z.infer<typeof tokenSchema>> {
    const expiresAt = Date.now() + 10_000;
    return bounded(async (signal) => {
      const parsed = tokenSchema.safeParse(
        await this.request("/tokens/v2/recent", "recent", signal, expiresAt),
      );
      if (!parsed.success) throw new PriceSourceError();
      return parsed.data;
    }, 10_000);
  }
}
