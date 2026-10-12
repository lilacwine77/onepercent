import type { Connection } from "@solana/web3.js";
export const blockhash = (rpc: Connection) =>
  rpc.getLatestBlockhash("confirmed");
export async function blockHeight(rpc: Connection): Promise<number> {
  const height = await rpc.getBlockHeight("confirmed");
  if (!Number.isSafeInteger(height) || height < 0)
    throw new Error("Invalid block height");
  return height;
}
