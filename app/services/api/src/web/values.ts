import { warnCause } from "@onepercent/service-kit";
import { BPS_DENOMINATOR, MARKET } from "@onepercent/config";
import { cleanText, estimateValueLamports } from "@onepercent/eligibility";
import type { PriceSource, ValueExitCap, ValueNow } from "@onepercent/market";
import type { ValuesInput, ValuesOutput } from "@onepercent/web-api";
export interface TokenMetadata {
  symbol: string;
  name: string;
  decimals: number | null;
  logoURI?: string;
}
export interface WebValueSources {
  metadata(mints: string[]): Promise<Record<string, TokenMetadata | undefined>>;
  prices: Pick<PriceSource, "getPrices" | "getSolUsd">;
  getExitCap(mint: string): Promise<ValueExitCap>;
  valueNow: ValueNow;
}
const unavailable = (reason: string) => ({
  status: "unavailable" as const,
  reason,
});
export class WebValues {
  constructor(readonly sources: WebValueSources) {}
  async get(input: ValuesInput): Promise<ValuesOutput> {
    const mints = [...new Set(input.items.map((item) => item.mint))];
    const metadata = await this.sources.metadata(mints).catch((error) => {
      warnCause("web_metadata_unavailable", error);
      return {} as Record<string, TokenMetadata | undefined>;
    });
    const display =
      input.mode === "est"
        ? await Promise.allSettled([
            this.sources.prices.getPrices(mints),
            this.sources.prices.getSolUsd(),
          ] as const)
        : null;
    for (const result of display ?? [])
      if (result.status === "rejected")
        warnCause("web_price_unavailable", result.reason);
    const caps = new Map<string, Promise<ValueExitCap>>();
    return {
      items: await Promise.all(
        input.items.map(async ({ mint, amount }) => {
          const token = metadata[mint];
          const base = {
            mint,
            amount,
            symbol: cleanText(token?.symbol ?? "", 16),
            name: cleanText(token?.name ?? "", 32),
            decimals: token?.decimals ?? null,
            logo: token?.logoURI ? `/api/logo/${mint}` : null,
          };
          try {
            if (input.mode === "now") {
              const quote = await this.sources.valueNow(mint, amount);
              return {
                ...base,
                value:
                  quote.status === "ok"
                    ? {
                        status: "ok" as const,
                        lamports: quote.lamports,
                        capped: quote.capped,
                        label: "if_sold_now" as const,
                      }
                    : quote,
              };
            }
            if (
              !display ||
              display[0].status !== "fulfilled" ||
              display[1].status !== "fulfilled"
            )
              return { ...base, value: unavailable("PRICE_UNAVAILABLE") };
            if (!caps.has(mint)) caps.set(mint, this.sources.getExitCap(mint));
            const cap = await caps.get(mint)!;
            if (
              cap.kind === "none" ||
              !cap.solQuote ||
              cap.realQuoteLamports < 0n ||
              !Number.isSafeInteger(cap.feeBps) ||
              cap.feeBps < 0 ||
              cap.feeBps > BPS_DENOMINATOR ||
              !Number.isSafeInteger(cap.slot) ||
              cap.slot < 0
            )
              return { ...base, value: unavailable("CAP_UNAVAILABLE") };
            const capLamports =
              (cap.realQuoteLamports * BigInt(BPS_DENOMINATOR - cap.feeBps)) /
              BigInt(BPS_DENOMINATOR);
            const price = display[0].value[mint];
            if (price && price.ageSlots > MARKET.price.maxAgeSlots)
              return { ...base, value: unavailable("PRICE_UNAVAILABLE") };
            const args = {
              amountRaw: amount,
              decimals: base.decimals,
              usdPrice: price?.usdPrice,
              ageSlots: price?.ageSlots,
              solUsd: display[1].value,
            };
            const lamports = estimateValueLamports({
              ...args,
              exitCapLamports: capLamports,
            });
            const uncapped = estimateValueLamports({
              ...args,
              exitCapLamports: (1n << 64n) - 1n,
            });
            return {
              ...base,
              value:
                lamports === undefined
                  ? unavailable("PRICE_UNAVAILABLE")
                  : {
                      status: "ok" as const,
                      lamports,
                      capped: uncapped !== undefined && uncapped > capLamports,
                      label: "est" as const,
                    },
            };
          } catch (error) {
            warnCause("web_value_unavailable", error);
            return { ...base, value: unavailable("PROVIDER_ERROR") };
          }
        }),
      ),
    };
  }
}
