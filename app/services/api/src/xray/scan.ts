import { warnCause } from "@onepercent/service-kit";
import {
  amountToUi,
  bondingCurvePda,
  cardCopy,
  cardTicker,
  checkPumpOrigin,
  classifyWallet,
  cleanText,
  lamportsToSol,
  mintIsSafe,
  parseTokenAccounts,
  WSOL_MINT,
  XRAY_MAX_TOKEN_ACCOUNTS,
  type MintSafety,
  type RawAccount,
} from "@onepercent/eligibility";
import { API_LOGS, reasonText } from "@onepercent/eligibility/copy";
import {
  XrayResultSchema,
  type XrayResult,
} from "@onepercent/eligibility/xray-result";
import { MARKET } from "@onepercent/config";
import type {
  ChainSource,
  PriceSource,
  ExitCapSource,
} from "./provider-types.js";
import type { XrayLogger } from "./turnstile.js";
import { XrayError } from "./error.js";
import { buildShareLinks } from "./share.js";
import { token2022Metadata } from "./mint-metadata.js";

export interface ScanRecord {
  result: XrayResult;
  coins: { ticker: string; drawdownPct: number | null }[];
}
export interface ScanDependencies {
  chain: ChainSource;
  prices: PriceSource;
  exitCaps?: ExitCapSource;
  slotS?: number;
  publicWebUrl: string;
  publicApiUrl: string;
  now?: () => number;
  logger?: XrayLogger;
}
const secureImage = (value: string | undefined): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch (error) {
    warnCause("xray_metadata_url_invalid", error);
    return null;
  }
};
async function chainCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof XrayError) throw error;
    warnCause("xray_chain_failed", error);
    throw new XrayError("upstream_failed", 502);
  }
}
// Operational budget: leave time for classification, serialization and the HTTP response.
const RESPONSE_HEADROOM_MS = 2_000;
const CPU_BATCH_SIZE = 16;
const DEFAULT_SCAN_MS = 10_000;
async function optional<T>(
  run: (signal: AbortSignal) => Promise<T>,
  fallback: T,
  signal: AbortSignal,
): Promise<{ value: T; ok: boolean }> {
  if (signal.aborted) return { value: fallback, ok: false };
  let abort: (() => void) | undefined;
  let abortTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => run(signal))
        .then((value) => ({ value, ok: true })),
      new Promise<{ value: T; ok: boolean }>((resolve) => {
        // Let partial-aware readers finish their abort handlers and return batches
        // already read before falling back for an adapter that ignores cancellation.
        abort = () => {
          abortTimer = setTimeout(
            () => resolve({ value: fallback, ok: false }),
            0,
          );
        };
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } catch (error) {
    warnCause("xray_optional_source_failed", error);
    return { value: fallback, ok: false };
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
    clearTimeout(abortTimer);
  }
}
export async function scanWallet(
  address: string,
  deps: ScanDependencies,
  signal?: AbortSignal,
  deadlineAt = Date.now() + DEFAULT_SCAN_MS,
): Promise<ScanRecord> {
  const active = () => {
    if (signal?.aborted) throw new XrayError("scan_timeout", 504);
  };
  active();
  const tokenAccounts = await chainCall(() =>
    deps.chain.getTokenAccounts(address, signal),
  );
  active();
  if (tokenAccounts.length > XRAY_MAX_TOKEN_ACCOUNTS)
    throw new XrayError("wallet_too_large", 422);
  const parsed = parseTokenAccounts(tokenAccounts);
  const mintIds = [
    ...new Set(
      parsed.accounts
        .filter((account) => account.amount > 0n && account.mint !== WSOL_MINT)
        .map((account) => account.mint),
    ),
  ];
  const controller = new AbortController();
  const enrichmentSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  // Start this stage after the inventory read. A slow inventory must not consume
  // a fixed two-second response allowance before essential reads can even run.
  // Keep the total server deadline, reserving at most 20% of the remaining time.
  const remainingMs = Math.max(0, deadlineAt - Date.now());
  const timer = setTimeout(
    () => controller.abort(),
    remainingMs - Math.min(RESPONSE_HEADROOM_MS, remainingMs / 5),
  );
  try {
    const metadataWork = optional(
      (s) => deps.chain.getMetadata(address, s),
      new Map(),
      enrichmentSignal,
    );
    const slotWork = optional(
      (s) => deps.chain.getSlot(s),
      0,
      enrichmentSignal,
    );
    const readAccounts = (addresses: string[]) =>
      optional(
        async (s) =>
          deps.chain.getAccountsPartial
            ? deps.chain.getAccountsPartial(addresses, s)
            : {
                accounts: await deps.chain.getAccounts(addresses, s),
                failed: [],
              },
        { accounts: new Map(), failed: addresses },
        enrichmentSignal,
      );
    // Start mint reads and optional enrichment before CPU work. Yield each batch
    // so network responses and the server deadline can progress on large wallets.
    const mintSafety = new Map<RawAccount, MintSafety>();
    const embeddedMetadata = new Map<
      string,
      ReturnType<typeof token2022Metadata>
    >();
    const mintWork = readAccounts(mintIds).then((read) => {
      // Prepare every readable mint as soon as its batches arrive. Waiting until
      // optional lookups expire would leave this work on the response's tail.
      for (const account of read.value.accounts.values())
        if (account) {
          mintSafety.set(account, mintIsSafe(account));
          embeddedMetadata.set(account.address, token2022Metadata(account));
        }
      return read;
    });
    const curveAddresses: string[] = [];
    for (let start = 0; start < mintIds.length; start += CPU_BATCH_SIZE) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (enrichmentSignal.aborted) break;
      for (const mint of mintIds.slice(start, start + CPU_BATCH_SIZE))
        curveAddresses.push(bondingCurvePda(mint).toBase58());
    }
    // Independent account reads overlap; the chain source shares its bounded
    // batch workers across both calls.
    const [mintRead, curveRead] = await Promise.all([
      mintWork,
      readAccounts(curveAddresses),
    ]);
    const accountRead = {
      ok:
        mintRead.ok && curveRead.ok && curveAddresses.length === mintIds.length,
      value: {
        accounts: new Map([
          ...mintRead.value.accounts,
          ...curveRead.value.accounts,
        ]),
        failed: [...mintRead.value.failed, ...curveRead.value.failed],
      },
    };
    // D25: unknown membership cannot become a public, shareable clean wallet.
    if (!accountRead.ok || accountRead.value.failed.length)
      throw new XrayError(
        enrichmentSignal.aborted ? "scan_timeout" : "upstream_failed",
        502,
      );
    const mints = accountRead.value.accounts;
    const curves = new Map(
      mintIds.map((mint, index) => [
        mint,
        mints.get(curveAddresses[index]!) ?? null,
      ]),
    );
    const originMints = mintIds.filter((mint) =>
      checkPumpOrigin(mint, curves.get(mint) ?? null),
    );
    const inSetMints = originMints.filter((mint) => {
      const account = mints.get(mint);
      if (!account) return false;
      return mintSafety.get(account)?.ok === true;
    });
    const snapshotWork = deps.slotS
      ? optional(
          (s) =>
            deps.chain.getSnapshotEvidence(address, inSetMints, deps.slotS!, s),
          new Map(),
          enrichmentSignal,
        )
      : Promise.resolve({ value: undefined, ok: true });
    const snapshotTimeWork = deps.slotS
      ? optional(
          (s) => deps.chain.getBlockTime(deps.slotS!, s),
          null,
          enrichmentSignal,
        )
      : Promise.resolve({ value: null, ok: true });
    const amounts = new Map<string, bigint>();
    for (const account of parsed.accounts) {
      if (account.owner === address)
        amounts.set(
          account.mint,
          (amounts.get(account.mint) ?? 0n) + account.amount,
        );
    }
    const slot = inSetMints.length ? await slotWork : { value: 0, ok: false };
    const reserveRead = await optional(
      async (s) =>
        inSetMints.length && deps.exitCaps?.getSellValues
          ? deps.exitCaps.getSellValues(
              inSetMints.map((mint) => ({
                mint,
                amount: amounts.get(mint) ?? 0n,
              })),
              {
                curveAccounts: mints,
                verifiedCurveAddresses: new Map(
                  originMints.map((mint) => [mint, curves.get(mint)!.address]),
                ),
                ...(slot.ok ? { slot: slot.value } : {}),
                signal: s,
              },
            )
          : { values: new Map(), partial: inSetMints.length > 0 },
      { values: new Map(), partial: inSetMints.length > 0 },
      enrichmentSignal,
    );
    const reserveValues = new Map<string, { lamports: bigint; slot: number }>();
    for (const [mint, value] of reserveRead.value.values) {
      if (
        value.lamports !== undefined &&
        value.lamports >= 0n &&
        value.slot !== undefined &&
        Number.isSafeInteger(value.slot) &&
        value.slot >= 0
      )
        reserveValues.set(mint, { lamports: value.lamports, slot: value.slot });
    }
    const infoMints = [...inSetMints]
      .sort((a, b) => {
        const av = reserveValues.get(a)?.lamports ?? 0n;
        const bv = reserveValues.get(b)?.lamports ?? 0n;
        return av > bv ? -1 : av < bv ? 1 : a.localeCompare(b);
      })
      .slice(0, MARKET.jupiter.tokensMintsPerCall);
    const infoWork = optional(
      (s) => deps.prices.getTokenInfo(infoMints, s),
      {},
      enrichmentSignal,
    );
    const [snapshotRead, snapshotTimeRead] = await Promise.all([
      snapshotWork,
      snapshotTimeWork,
    ]);
    // Reserve values need no USD conversion. Finish the account work while
    // optional metadata is still pending, with no repeated token/mint decoding.
    const classification = classifyWallet({
      owner: address,
      tokenAccounts,
      parsedTokenAccounts: parsed,
      mintSafety,
      mints,
      curves,
      prices: {},
      solUsd: 0,
      slotS: deps.slotS,
      snapshot: snapshotRead.value,
      reserveValues,
    });
    const [metadataRead, infoRead] = await Promise.all([
      metadataWork,
      infoWork,
    ]);
    const metadata = metadataRead.value;
    const info = infoRead.value;
    const snapshotTime = snapshotTimeRead.value;
    const valuesPartial =
      inSetMints.length > 0 && (!reserveRead.ok || reserveRead.value.partial);
    if (classification.skippedTokenAccounts)
      deps.logger?.debug(
        { count: classification.skippedTokenAccounts },
        API_LOGS.skippedAccounts,
      );
    const bags: XrayResult["bags"] = classification.bags.map((bag) => {
      const onchain = metadata.get(bag.mint);
      const embedded = embeddedMetadata.get(bag.mint);
      const token = info[bag.mint];
      const symbol =
        cleanText(
          embedded?.symbol ?? onchain?.symbol ?? token?.symbol ?? "",
          16,
        ) || bag.mint.slice(0, 4);
      const name = cleanText(
        embedded?.name ?? onchain?.name ?? token?.name ?? "",
        32,
      );
      return {
        mint: bag.mint,
        symbol,
        name,
        logoUrl: secureImage(token?.logoURI ?? onchain?.image),
        amountUi:
          bag.decimals === null
            ? null
            : amountToUi(bag.amountRaw, bag.decimals),
        decimals: bag.decimals,
        tokenProgram: bag.tokenProgram,
        buckets: bag.buckets,
        ...(bag.reason
          ? {
              reasonCode: bag.reason,
              reason: reasonText(
                bag.reason,
                snapshotTime == null
                  ? undefined
                  : new Date(snapshotTime * 1000),
              ),
            }
          : {}),
        ...(bag.valueLamports !== undefined
          ? { valueSol: lamportsToSol(bag.valueLamports) }
          : {}),
        ...(bag.priceAgeSlots !== undefined
          ? { priceAgeSlots: bag.priceAgeSlots }
          : {}),
      };
    });
    const counts = {
      bags: bags.filter((bag) => !bag.buckets.includes("not_in_set")).length,
      feedable: bags.filter(
        (bag) =>
          bag.buckets.includes("feedable") &&
          bag.reasonCode !== "snapshot_at_feed",
      ).length,
      checkAtFeed: bags.filter((bag) => bag.reasonCode === "snapshot_at_feed")
        .length,
      notFeedable: bags.filter((bag) =>
        bag.buckets.includes("not_feedable_season"),
      ).length,
      sellable: bags.filter((bag) => bag.buckets.includes("sell")).length,
      empty: classification.empties.length,
      notInSet: bags.filter((bag) => bag.buckets.includes("not_in_set")).length,
    };
    const ranked = bags
      .filter((bag) => !bag.buckets.includes("not_in_set"))
      .map((bag) => {
        // Tokens v2 has no ATH; a missing metric must not trigger wallet-wide prices.
        const drawdownPct = null;
        return {
          mint: bag.mint,
          ticker: cardTicker(bag.symbol, bag.mint),
          drawdownPct,
        };
      })
      .sort(
        (a, b) =>
          (b.drawdownPct ?? -1) - (a.drawdownPct ?? -1) ||
          a.mint.localeCompare(b.mint),
      );
    const most = ranked.find((item) => item.drawdownPct !== null);
    const worst = most
      ? { symbol: most.ticker, mint: most.mint, drawdownPct: most.drawdownPct! }
      : null;
    const card = cardCopy({
      address,
      bags: counts.bags,
      // D25: do not select a title or assert a dust count from optional values.
      // Zero disables the price-based title and one-liner in the existing copy API.
      dust: 0,
      empties: counts.empty,
      worst: worst
        ? { ticker: worst.symbol, drawdownPct: worst.drawdownPct }
        : null,
    });
    const scannedAt = new Date((deps.now ?? Date.now)()).toISOString();
    const result = XrayResultSchema.parse({
      address,
      chain: "solana",
      scannedAt,
      cached: false,
      ...(valuesPartial ? { valuesPartial: true } : {}),
      counts,
      totals: {
        sellValueSol: lamportsToSol(
          classification.bags
            .filter((bag) => bag.buckets.includes("sell"))
            .reduce((sum, bag) => sum + (bag.valueLamports ?? 0n), 0n),
        ),
        rentBackSol: lamportsToSol(
          classification.empties.reduce(
            (sum, item) => sum + item.rentLamports,
            0n,
          ),
        ),
      },
      worst,
      bags,
      emptyAccounts: classification.empties.map((item) => ({
        ...item,
        rentLamports: Number(item.rentLamports),
      })),
      card,
      share: buildShareLinks(address, {
        publicWebUrl: deps.publicWebUrl,
        publicApiUrl: deps.publicApiUrl,
        scannedAt,
        bags: counts.bags,
        title: card.title,
      }),
    });
    return {
      result,
      coins: ranked
        .slice(0, 3)
        .map(({ ticker, drawdownPct }) => ({ ticker, drawdownPct })),
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
