import { U64String } from "./primitives.js";
export function parseRoyaltyMemo(memo: string): bigint | null {
  const match = /^1pct:roy:(\d{1,20})$/.exec(memo);
  const result = U64String.safeParse(match?.[1]);
  return result.success && match?.[0] === memo ? result.data : null;
}
