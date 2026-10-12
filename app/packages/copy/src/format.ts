// X1 UI mirror until M1 consolidates config (PARAMS §19).
const UI = { tickerMaxChars: 10 } as const;

export function amountToUi(amount: bigint, decimals: number): string {
  if (
    amount < 0n ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  ) {
    throw new RangeError("Invalid unsigned amount or decimals");
  }
  if (decimals === 0) return amount.toString();
  const digits = amount.toString().padStart(decimals + 1, "0");
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return `${digits.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}
export const lamportsToSol = (lamports: bigint): string =>
  amountToUi(lamports, 9);
export function solToLamports(sol: string): bigint {
  if (!/^\d+(\.\d{1,9})?$/.test(sol))
    throw new RangeError("Invalid SOL amount");
  const [whole = "0", fraction = ""] = sol.split(".");
  return BigInt(whole + fraction.padEnd(9, "0"));
}
export const shortAddress = (address: string): string =>
  `${address.slice(0, 4)}…${address.slice(-4)}`;
export function cleanText(value: string, max: number): string {
  const cleaned = value
    .replace(
      // eslint-disable-next-line no-control-regex -- Metadata must exclude control characters.
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200b-\u200f\ufeff]/g,
      "",
    )
    .trim();
  let result = "";
  for (const character of cleaned) {
    if (result.length + character.length > max) break;
    result += character;
  }
  return result;
}
export function cardTicker(symbol: string, mint: string): string {
  return (
    symbol
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, UI.tickerMaxChars) || mint.slice(0, 4)
  );
}
/** Bigints are lamports; strings are exact decimal SOL. Rounds down. */
export function formatSolDisplay(value: bigint | string): string {
  const lamports = typeof value === "bigint" ? value : solToLamports(value);
  if (lamports < 0n) throw new RangeError("Invalid unsigned SOL amount");
  if (lamports >= 1_000_000_000n)
    return lamportsToSol((lamports / 10_000_000n) * 10_000_000n);
  if (lamports >= 10_000_000n)
    return `0.${(lamports / 10_000_000n).toString().padStart(2, "0")}`;
  if (lamports === 0n) return "0";
  const places = Math.max(0, lamports.toString().length - 2);
  const divisor = 10n ** BigInt(places);
  const [whole, fraction = ""] = lamportsToSol(
    (lamports / divisor) * divisor,
  ).split(".");
  return `${whole}.${fraction.padEnd(11 - lamports.toString().length, "0")}`;
}
export const formatPct = (drawdownPct: number): string =>
  `${drawdownPct === 0 ? "" : "−"}${Math.abs(drawdownPct).toFixed(1)}%`;

/** X3 §3.4: a wallet address or the documented lowercase alias format. */
export function referralCode(
  value: string | null | undefined,
): string | undefined {
  return value != null &&
    (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) ||
      /^[a-z0-9_]{3,16}$/.test(value))
    ? value
    : undefined;
}

/** DA display precision: two decimals, or three significant digits below 0.01 SOL. */
function displaySol(value: bigint | string, ceil: boolean): string {
  const lamports = typeof value === "bigint" ? value : solToLamports(value);
  if (lamports < 0n) throw new RangeError("Invalid unsigned SOL amount");
  if (lamports === 0n) return "0";
  const places =
    lamports >= 10_000_000n ? 7 : Math.max(0, lamports.toString().length - 3);
  const divisor = 10n ** BigInt(places);
  return lamportsToSol(
    ((lamports + (ceil ? divisor - 1n : 0n)) / divisor) * divisor,
  );
}

/** Bigints are lamports; strings are exact decimal SOL. Receipts round down. */
export const sol = (value: bigint | string): string => displaySol(value, false);
/** Costs round up, so a displayed requirement never understates the lamports due. */
export const solCost = (value: bigint | string): string =>
  displaySol(value, true);
/** Exact pack price, with two decimal places. Never rounds a price. */
export function packPrice(lamports: bigint): string {
  if (lamports < 0n || lamports % 10_000_000n !== 0n)
    throw new RangeError("Pack price must have at most two decimals");
  const [whole, fraction = ""] = lamportsToSol(lamports).split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}
/** Display precision only. Keep the full bigint amount for transaction planning. */
function costAtPrecision(lamports: bigint, decimals: number): string {
  if (lamports < 0n) throw new RangeError("Invalid unsigned SOL amount");
  const unit = 10n ** BigInt(9 - decimals);
  return lamportsToSol(((lamports + unit - 1n) / unit) * unit);
}
export const depositCost = (lamports: bigint): string =>
  costAtPrecision(lamports, 6);
export const ripTotal = (lamports: bigint): string =>
  costAtPrecision(lamports, 3);
export const solExact = (value: bigint | string): string =>
  lamportsToSol(typeof value === "bigint" ? value : solToLamports(value));
/** Negative net figures round away from zero, so a cost never appears smaller. */
export function solSigned(value: bigint): string {
  const magnitude = value < 0n ? solCost(-value) : sol(value);
  const [whole, fraction = ""] = magnitude.split(".");
  return `${value < 0n ? "−" : "+"}${whole}.${fraction.padEnd(2, "0")}`;
}
export function pct(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError("Invalid percentage");
  return `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}%`;
}
/** Basis points to a formatted percentage; this is a display-unit conversion. */
export const pctBps = (value: number): string => pct(value / 100);
export function mult(value: number): string {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError("Invalid multiplier");
  return `×${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
export const short = shortAddress;
export const shortTv = (address: string): string =>
  `${address.slice(0, 3)}…${address.slice(-2)}`;
export const ticker = (symbol: string, mint = ""): string =>
  `$${cardTicker(symbol, mint)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")}`;

function integer(value: bigint | number): bigint {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))
    throw new RangeError("Invalid count");
  const result = BigInt(value);
  if (result < 0n) throw new RangeError("Invalid count");
  return result;
}
export const count = (value: bigint | number, grouping = true): string =>
  integer(value).toLocaleString("en-US", { useGrouping: grouping });
export const countUngrouped = (value: bigint | number): string =>
  count(value, false);
export function amount(value: bigint, decimals = 0): string {
  const [whole = "0", fraction] = amountToUi(value, decimals).split(".");
  return `${BigInt(whole).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

function validDate(value: Date | string | number): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid date");
  return date;
}
/** Numeric dates use Unix milliseconds; callers convert chain timestamps explicitly. */
export const dateUtc = (value: Date | string | number): string =>
  validDate(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
export const timeUtc = (value: Date | string | number): string =>
  `${validDate(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
/** Remaining seconds, clamped to zero. Never reads the device clock. */
export function countdown(seconds: number): string {
  if (!Number.isFinite(seconds)) throw new RangeError("Invalid countdown");
  const total = Math.max(0, Math.ceil(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const remaining = total % 60;
  return `${days ? `${count(days)}d ` : ""}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}
