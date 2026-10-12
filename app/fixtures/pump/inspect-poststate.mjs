import { PublicKey } from "@solana/web3.js";
import { TOKEN_1PCT } from "../../packages/config/src/index.ts";

export function inspectLaunchPoststate(
  mintAccount,
  curveAccount,
  buyerAccount,
  feeIn,
  globalSupply,
) {
  const mint = Buffer.from(mintAccount.data[0], "base64");
  const curve = Buffer.from(curveAccount.data[0], "base64");
  const buyer = Buffer.from(buyerAccount.data[0], "base64");
  const extensions = [];
  for (let offset = 166; offset < mint.length;) {
    if (offset + 4 > mint.length) throw new Error("Truncated mint extension");
    const type = mint.readUInt16LE(offset);
    const length = mint.readUInt16LE(offset + 2);
    if (offset + 4 + length > mint.length)
      throw new Error("Truncated mint extension data");
    extensions.push(type);
    offset += 4 + length;
  }
  const out = {
    mintBytes: mint.length,
    token2022:
      mintAccount.owner === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    mintAuthority: mint.readUInt32LE(0),
    freezeAuthority: mint.readUInt32LE(46),
    decimals: mint[44],
    supply: mint.readBigUInt64LE(36).toString(),
    extensions,
    curveBytes: curve.length,
    creator: new PublicKey(curve.subarray(49, 81)).toBase58(),
    mayhem: curve[81],
    cashback: curve[82],
    quoteMint: new PublicKey(curve.subarray(83, 115)).toBase58(),
    holderReward: curve[124],
    waitingCreatorFee: curve.readBigUInt64LE(125).toString(),
    virtualQuoteReserves: curve.readBigUInt64LE(16).toString(),
    buyerAmount: buyer.readBigUInt64LE(64).toString(),
  };
  if (
    !out.token2022 ||
    out.mintAuthority !== 0 ||
    out.freezeAuthority !== 0 ||
    out.decimals !== TOKEN_1PCT.decimals ||
    out.supply !== globalSupply.toString() ||
    extensions.sort().join(",") !== "18,19" ||
    out.creator !== feeIn.toString() ||
    out.mayhem ||
    out.cashback ||
    out.holderReward ||
    out.quoteMint !== PublicKey.default.toBase58() ||
    out.buyerAmount !== TOKEN_1PCT.devBuyAmount.toString()
  )
    throw new Error("Launch prefix post-state mismatch");
  return out;
}
