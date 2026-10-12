import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

import { bagsHash } from "@onepercent/sdk";
export { attestationExpiry, bagsHash, feedNonces } from "@onepercent/sdk";

type Bag = { mint: PublicKey; amount: bigint };
// The signer accepts an explicitly validated domain; M1's feedMessage instead
// binds its compiled domain. Keep this domain-aware adapter until those APIs match.
/** Domain is supplied exclusively by the validated config, never by HTTP. */
export function feedMessage(
  input: {
    programId: PublicKey;
    wallet: PublicKey;
    nonce: number;
    expiry: bigint;
    bags: readonly Bag[];
  },
  domain: string,
): Buffer {
  z.number().int().min(1).max(255).parse(input.bags.length);
  z.number().int().min(0).max(0xffffffff).parse(input.nonce);
  const suffix = Buffer.alloc(13);
  suffix.writeUInt32LE(input.nonce);
  suffix.writeBigInt64LE(input.expiry, 4);
  suffix.writeUInt8(input.bags.length, 12);
  return Buffer.concat([
    Buffer.from(domain),
    input.programId.toBuffer(),
    input.wallet.toBuffer(),
    suffix,
    bagsHash(input.bags),
  ]);
}
