export type ReferralCode = string & { readonly __referral: unique symbol };
export const ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const NAME_PATTERN = /^[^\s/]{1,100}\.sns$/i;
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function isAddress(input: string): boolean {
  if (!ADDRESS_PATTERN.test(input)) return false;
  let value = 0n;
  for (const char of input)
    value = value * 58n + BigInt(alphabet.indexOf(char));
  let bytes = 0;
  while (value > 0n) {
    bytes++;
    value >>= 8n;
  }
  return bytes + (input.match(/^1*/)?.[0].length ?? 0) === 32;
}
export function parseReferral(payload: string): ReferralCode | null {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(payload) || !payload.startsWith("ref_"))
    return null;
  const code = payload.slice(4);
  return ADDRESS_PATTERN.test(code) || /^[a-z0-9_]{3,16}$/.test(code)
    ? (code as ReferralCode)
    : null;
}
export function normalizeXrayInput(input: string): string | null {
  const trimmed = input.trim();
  if (isAddress(trimmed)) return trimmed;
  return NAME_PATTERN.test(trimmed) ? trimmed : null;
}
