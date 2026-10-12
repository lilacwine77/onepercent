import { lamportsToSol, solToLamports } from "@onepercent/eligibility/format";
export { formatSolDisplay } from "@onepercent/eligibility/format";
export function formatSol(value: string | bigint): string {
  const lamports = typeof value === "bigint" ? value : solToLamports(value);
  const precision =
    lamports >= 10_000_000n
      ? 10_000_000n
      : 10n ** BigInt(Math.max(0, lamports.toString().length - 3));
  const rounded = ((lamports + precision / 2n) / precision) * precision;
  return lamportsToSol(rounded);
}

export function truncateDisplay(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length > max
    ? `${characters.slice(0, max - 1).join("")}…`
    : text;
}

// Never cut off a money label while fitting the Blink's description budget.
export function joinDescription(segments: string[], max = 140): string {
  let description = "";
  for (const segment of segments.filter(Boolean)) {
    const candidate = description ? `${description} ✳ ${segment}` : segment;
    if (Array.from(candidate).length <= max) description = candidate;
  }
  return description;
}
