import { PublicKey } from "@solana/web3.js";
import { PROGRAM_IDS, PUMP_LAYOUTS, XRAY } from "./params.js";
import type { RawAccount } from "./types.js";
const pump = new PublicKey(PROGRAM_IDS.pumpFun);
const discriminator = Buffer.from(
  PUMP_LAYOUTS.bondingCurveDiscriminatorHex,
  "hex",
);
// Only deterministic addresses are cached; every origin check still verifies live bytes.
const curveAddresses = new Map<string, Uint8Array>();
export function bondingCurvePda(mint: string | PublicKey): PublicKey {
  const id = typeof mint === "string" ? mint : mint.toBase58();
  const cached = curveAddresses.get(id);
  if (cached) {
    curveAddresses.delete(id);
    curveAddresses.set(id, cached);
    return new PublicKey(cached);
  }
  const address = PublicKey.findProgramAddressSync(
    [
      Buffer.from(PUMP_LAYOUTS.bondingCurveSeed),
      new PublicKey(mint).toBuffer(),
    ],
    pump,
  )[0];
  curveAddresses.set(id, address.toBytes());
  if (curveAddresses.size > XRAY.cacheMaxEntries) {
    const oldest = curveAddresses.keys().next().value;
    if (oldest !== undefined) curveAddresses.delete(oldest);
  }
  return address;
}
export function checkPumpOrigin(
  mint: string | PublicKey,
  curve: RawAccount | null | undefined,
): boolean {
  if (
    !curve ||
    curve.owner !== PROGRAM_IDS.pumpFun ||
    curve.data.length < discriminator.length
  )
    return false;
  try {
    return (
      curve.address === bondingCurvePda(mint).toBase58() &&
      discriminator.every((byte, index) => curve.data[index] === byte)
    );
  } catch {
    return false;
  }
}
