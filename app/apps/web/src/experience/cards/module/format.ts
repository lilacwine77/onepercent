/* eslint-disable */
// Synced from experience/cards-lab/src/cards/format.ts by experience/sync-lab.mjs; edit the lab, then re-sync.
// @ts-nocheck
/**
 * Display formatters (COPY §0.5, DA §4.3). In the web app these come from `@onepercent/copy`
 * (`sol`, `solCost`, `count`, `short`, `timeUtc`); the lab keeps byte-compatible local copies.
 * Lamports stay bigint until here (03-M3 §2.11).
 */
import type { Value } from "./types";

const LAMPORTS = 1_000_000_000n;

/** DA §4.3: "0.84 SOL" and "0.0061 SOL": 2 decimals from 0.1, 3 from 0.01, 4 below; 1 from 100. Trailing zeros past 2 trimmed. */
function decimalsFor(abs: bigint): number {
  if (abs >= 100n * LAMPORTS) return 1;
  if (abs >= LAMPORTS / 10n) return 2;
  if (abs >= LAMPORTS / 100n) return 3;
  return 4;
}

function fmtLamports(l: bigint, round: "floor" | "ceil"): string {
  const neg = l < 0n;
  const abs = neg ? -l : l;
  const d = decimalsFor(abs);
  const unit = 10n ** BigInt(9 - d);
  let q = abs / unit;
  if (round === "ceil" && abs % unit !== 0n) q += 1n;
  const whole = q / 10n ** BigInt(d);
  let frac = (q % 10n ** BigInt(d)).toString().padStart(d, "0");
  while (frac.length > 2 && frac.endsWith("0")) frac = frac.slice(0, -1);
  if (d === 1) frac = frac.slice(0, 1);
  const w = Number(whole).toLocaleString("en-US");
  return `${neg ? "−" : ""}${w}${frac ? `.${frac}` : ""}`;
}

/** An amount the user receives: rounded down. */
export const sol = (lamports: bigint) => fmtLamports(lamports, "floor");
/** An amount the user pays: rounded up (03-M3 M3-A7). */
export const solCost = (lamports: bigint) => fmtLamports(lamports, "ceil");
/** en-US grouping. */
export const count = (n: number) => n.toLocaleString("en-US");
/** 4+4 address (`7xKp…d2Qa`). */
export const short = (a: string) =>
  a.length <= 10 ? a : `${a.slice(0, 4)}…${a.slice(-4)}`;
/** `$` + `[A-Z0-9]` (COPY `ticker`). */
export const ticker = (t: string) =>
  `$${t
    .replace(/^\$/, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10)}`;
export function timeUtc(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** Lamports of a Value, or null for `none`. */
export const lamportsOf = (v: Value | null | undefined): bigint | null =>
  v && v.kind !== "none" ? v.lamports : null;

/** Sum of values: `now` only while every part is `now`, else `est`; `none` parts are skipped (and counted). */
export function sumValues(values: (Value | null | undefined)[]): {
  value: Value;
  missing: number;
} {
  let total = 0n;
  let any = false;
  let est = false;
  let missing = 0;
  for (const v of values) {
    if (!v || v.kind === "none") {
      missing++;
      continue;
    }
    any = true;
    total += v.lamports;
    if (v.kind === "est") est = true;
  }
  return {
    value: any
      ? { kind: est ? "est" : "now", lamports: total }
      : { kind: "none" },
    missing,
  };
}
