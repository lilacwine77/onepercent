import { PublicKey, type AccountInfo } from "@solana/web3.js";
import type { RawAccount } from "./types.js";
export function accountInfo(raw: RawAccount): AccountInfo<Buffer> {
  return {
    data: Buffer.from(raw.data),
    owner: new PublicKey(raw.owner),
    lamports: Number(raw.lamports),
    executable: false,
    rentEpoch: 0,
  };
}
