export const fromBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
export const toBase64 = (value: Uint8Array): string =>
  btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join(""));
export const equalBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length &&
  left.every((byte, index) => byte === right[index]);
export function base58(value: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const byte of value) number = number * 256n + BigInt(byte);
  let encoded = "";
  while (number) {
    encoded = alphabet[Number(number % 58n)] + encoded;
    number /= 58n;
  }
  for (const byte of value) {
    if (byte !== 0) break;
    encoded = "1" + encoded;
  }
  return encoded;
}
