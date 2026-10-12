import { unpackAccount, getTransferFeeAmount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { curveDisplayState } from "./curve-cap.js";
import {
  decodeMint,
  extensionTypes,
  mintIsSafe,
  type MintSafety,
} from "./mint-safety.js";
import { checkPumpOrigin } from "./origin.js";
import { PROGRAM_IDS, WSOL_MINT, XRAY } from "./params.js";
import { accountInfo } from "./raw.js";
import { evaluateSnapshot } from "./snapshot.js";
import type { RawAccount, ReasonCode, SnapshotEvidence } from "./types.js";
import { estimateValueLamports } from "./value.js";
import type { Bucket } from "./xray-result.js";
export interface ParsedTokenAccount {
  mint: string;
  amount: bigint;
  owner: string;
  raw: RawAccount;
  isFrozen: boolean;
  tokenProgram: "spl" | "token2022";
  closeAuthority: string | null;
  withheldAmount: bigint;
}
export function parseTokenAccounts(tokenAccounts: RawAccount[]): {
  accounts: ParsedTokenAccount[];
  skipped: number;
} {
  const accounts: ParsedTokenAccount[] = [];
  let skipped = 0;
  for (const raw of tokenAccounts) {
    try {
      if (
        raw.owner !== PROGRAM_IDS.splToken &&
        raw.owner !== PROGRAM_IDS.token2022
      )
        throw new Error("Unsupported token account owner");
      const account = unpackAccount(
        new PublicKey(raw.address),
        accountInfo(raw),
        new PublicKey(raw.owner),
      );
      if (!account.isInitialized)
        throw new Error("Uninitialized token account");
      extensionTypes(account.tlvData);
      accounts.push({
        mint: account.mint.toBase58(),
        amount: account.amount,
        owner: account.owner.toBase58(),
        raw,
        isFrozen: account.isFrozen,
        tokenProgram: raw.owner === PROGRAM_IDS.splToken ? "spl" : "token2022",
        closeAuthority: account.closeAuthority?.toBase58() ?? null,
        withheldAmount: getTransferFeeAmount(account)?.withheldAmount ?? 0n,
      });
    } catch {
      skipped += 1;
    }
  }
  return { accounts, skipped };
}
export function nonEmptyMints(tokenAccounts: RawAccount[]): string[] {
  return [
    ...new Set(
      parseTokenAccounts(tokenAccounts)
        .accounts.filter(
          (account) => account.amount > 0n && account.mint !== WSOL_MINT,
        )
        .map((account) => account.mint),
    ),
  ];
}
export interface ClassifiedBag {
  mint: string;
  amountRaw: bigint;
  decimals: number | null;
  tokenProgram: "spl" | "token2022";
  buckets: Bucket[];
  reason?: ReasonCode;
  valueLamports?: bigint;
  priceAgeSlots?: number;
}
export interface ClassifyWalletInput {
  owner: string;
  tokenAccounts: RawAccount[];
  /** Reuse only the token-account parse from this same scan. */
  parsedTokenAccounts?: ReturnType<typeof parseTokenAccounts>;
  mints: Map<string, RawAccount | null>;
  /** Per-scan safety results keyed by the exact account object that was checked. */
  mintSafety?: ReadonlyMap<RawAccount, MintSafety>;
  curves: Map<string, RawAccount | null>;
  prices: Record<
    string,
    { usdPrice: number; ageSlots: number; blockId?: number } | undefined
  >;
  solUsd: number;
  /** X2 getExitCap output after its fee haircut; absence never permits a value. */
  exitCaps?: ReadonlyMap<string, bigint | null>;
  /** On-chain sale values for the full held amount; missing entries stay unvalued. */
  reserveValues?: ReadonlyMap<string, { lamports: bigint; slot: number }>;
  slotS?: number;
  snapshot?: Map<string, SnapshotEvidence>;
  excludedMints?: ReadonlySet<string>;
}
export interface ClassifiedWallet {
  bags: ClassifiedBag[];
  empties: { address: string; mint: string; rentLamports: bigint }[];
  skippedTokenAccounts: number;
}
export function classifyWallet(input: ClassifyWalletInput): ClassifiedWallet {
  const parsed =
    input.parsedTokenAccounts ?? parseTokenAccounts(input.tokenAccounts);
  const empties: ClassifiedWallet["empties"] = [];
  const grouped = new Map<
    string,
    { amount: bigint; frozen: boolean; program: "spl" | "token2022" }
  >();
  let skippedTokenAccounts = parsed.skipped;
  for (const account of parsed.accounts) {
    if (account.owner !== input.owner) {
      skippedTokenAccounts += 1;
      continue;
    }
    if (account.amount === 0n) {
      if (
        !account.isFrozen &&
        (account.closeAuthority === null ||
          account.closeAuthority === input.owner) &&
        account.withheldAmount === 0n
      )
        empties.push({
          address: account.raw.address,
          mint: account.mint,
          rentLamports: account.raw.lamports,
        });
      continue;
    }
    if (account.mint === WSOL_MINT) continue;
    const previous = grouped.get(account.mint);
    grouped.set(account.mint, {
      amount: (previous?.amount ?? 0n) + account.amount,
      frozen: account.isFrozen || previous?.frozen === true,
      program: account.tokenProgram,
    });
  }
  const excluded = input.excludedMints ?? new Set([WSOL_MINT]);
  const bags: ClassifiedBag[] = [];
  for (const [mint, group] of grouped) {
    const rawMint = input.mints.get(mint),
      curve = input.curves.get(mint);
    const origin = checkPumpOrigin(mint, curve),
      safety = rawMint
        ? (input.mintSafety?.get(rawMint) ?? mintIsSafe(rawMint))
        : null;
    let decoded: { decimals: number; extensions: number[] } | undefined;
    if (safety?.ok) {
      decoded = { decimals: safety.decimals, extensions: safety.extensions };
    } else if (rawMint) {
      try {
        const details = decodeMint(rawMint);
        decoded = {
          decimals: details.mint.decimals,
          extensions: details.extensions,
        };
      } catch {
        /* Missing mint details suppress the display estimate. */
      }
    }
    const bag: ClassifiedBag = {
      mint,
      amountRaw: group.amount,
      decimals: decoded?.decimals ?? null,
      tokenProgram: group.program,
      buckets: [],
    };
    // DECISIONS.md D8: distinguish absent accounts from unreadable safety failures.
    if (!rawMint) bag.reason = "mint_missing";
    else if (!decoded)
      bag.reason = safety && !safety.ok ? safety.code : "mint_unparseable";
    else if (excluded.has(mint)) bag.reason = "excluded";
    else if (!origin) bag.reason = "not_pump_fun";
    else if (safety && !safety.ok) bag.reason = safety.code;
    if (bag.reason) bag.buckets.push("not_in_set");
    else {
      const status = evaluateSnapshot(input.slotS, input.snapshot?.get(mint));
      if (status === "not_held") {
        bag.buckets.push("not_feedable_season");
        bag.reason = "snapshot_not_held";
      } else {
        bag.buckets.push("feedable");
        if (status !== "held") bag.reason = "snapshot_at_feed";
      }
    }
    const price =
      input.reserveValues === undefined ? input.prices[mint] : undefined;
    if (price) bag.priceAgeSlots = price.ageSlots;
    const curveState = origin && curve ? curveDisplayState(curve) : undefined;
    const skipCurve =
      origin &&
      (!curveState || (!curveState.complete && !curveState.solQuoted));
    const skipValue =
      bag.buckets.includes("not_in_set") ||
      group.frozen ||
      !decoded ||
      decoded.extensions.includes(25) ||
      decoded.extensions.includes(10) ||
      skipCurve;
    const reserveValue = input.reserveValues?.get(mint);
    const value =
      input.reserveValues === undefined
        ? estimateValueLamports({
            amountRaw: group.amount,
            decimals: bag.decimals,
            usdPrice: price?.usdPrice,
            ageSlots: price?.ageSlots,
            solUsd: input.solUsd,
            exitCapLamports: input.exitCaps?.get(mint),
            skip: skipValue,
          })
        : !skipValue &&
            reserveValue &&
            reserveValue.lamports >= 0n &&
            Number.isSafeInteger(reserveValue.slot) &&
            reserveValue.slot >= 0
          ? reserveValue.lamports
          : undefined;
    if (value !== undefined) bag.valueLamports = value;
    if (!group.frozen && value !== undefined && value >= XRAY.sellMinLamports)
      bag.buckets.push("sell");
    bags.push(bag);
  }
  const rank = (bag: ClassifiedBag) =>
    bag.buckets.includes("feedable")
      ? 0
      : bag.buckets.includes("not_feedable_season")
        ? 1
        : 2;
  const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  bags.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      ((a.valueLamports ?? 0n) > (b.valueLamports ?? 0n)
        ? -1
        : (a.valueLamports ?? 0n) < (b.valueLamports ?? 0n)
          ? 1
          : lexical(a.mint, b.mint)),
  );
  empties.sort((a, b) =>
    a.rentLamports > b.rentLamports
      ? -1
      : a.rentLamports < b.rentLamports
        ? 1
        : lexical(a.address, b.address),
  );
  return { bags, empties, skippedTokenAccounts };
}
