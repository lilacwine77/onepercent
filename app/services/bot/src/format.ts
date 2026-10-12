import { lamportsToSol, solToLamports } from "@onepercent/eligibility/format";
import { UI } from "./limits.js";
export { formatSolDisplay } from "@onepercent/eligibility/format";

export function escapeHtml(value: string | number): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
}
export function shortAddress(address: string, hit = false): string {
  return `${address.slice(0, hit ? 3 : 4)}…${address.slice(hit ? -2 : -4)}`;
}
export function formatUnits(value: bigint, decimals: number): string {
  if (value < 0n) throw new RangeError("Expected a nonnegative amount");
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
export function formatSol(value: string | bigint): string {
  const source = typeof value === "bigint" ? lamportsToSol(value) : value;
  if (!/^\d+(\.\d{1,9})?$/.test(source))
    throw new TypeError("Expected exact SOL decimal");
  const amount = solToLamports(source);
  if (amount === 0n) return "0";
  const digits =
    amount >= 10_000_000n ? 2 : Math.min(9, 9 - amount.toString().length + 3);
  const unit = 10n ** BigInt(9 - digits);
  return formatUnits((amount + unit / 2n) / unit, digits);
}
export function sanitizeTicker(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, UI.tickerMaxChars);
}

// TODO(packages/copy): exact M3.1 sol receipt formatter; X-ray snapshots keep X1 formatting.
export function formatSolReceipt(value: bigint): string {
  if (value < 0n) throw new RangeError("Invalid unsigned SOL amount");
  if (value === 0n) return "0";
  const places =
    value >= 10_000_000n ? 7 : Math.max(0, value.toString().length - 3);
  const divisor = 10n ** BigInt(places);
  return lamportsToSol((value / divisor) * divisor);
}
