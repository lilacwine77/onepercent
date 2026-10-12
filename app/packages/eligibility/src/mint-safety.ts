import {
  getExtensionTypes,
  unpackMint,
  ExtensionType,
  MINT_SIZE,
  type Mint,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { FEED_RULES, PROGRAM_IDS } from "./params.js";
import { accountInfo } from "./raw.js";
import type { MintFailureCode, RawAccount } from "./types.js";
export type MintSafety =
  | {
      ok: true;
      program: "spl" | "token2022";
      decimals: number;
      extensions: number[];
    }
  | { ok: false; code: MintFailureCode };
/** Validate bounds before the library enumerates TLV headers (including unknown types). */
export function extensionTypes(tlv: Uint8Array): number[] {
  let offset = 0;
  while (offset < tlv.length) {
    if (tlv.subarray(offset).every((byte) => byte === 0)) break;
    if (offset + 4 > tlv.length) throw new Error("Incomplete extension header");
    const length = tlv[offset + 2]! | (tlv[offset + 3]! << 8);
    offset += 4 + length;
    if (offset > tlv.length) throw new Error("Incomplete extension value");
  }
  return getExtensionTypes(Buffer.from(tlv.subarray(0, offset))).filter(
    (type) => type !== ExtensionType.Uninitialized,
  );
}
function unpackRawMint(raw: RawAccount): {
  mint: Mint;
  program: "spl" | "token2022";
} {
  if (raw.owner !== PROGRAM_IDS.splToken && raw.owner !== PROGRAM_IDS.token2022)
    throw new Error("Unsupported token program");
  const program = raw.owner === PROGRAM_IDS.splToken ? "spl" : "token2022";
  if (program === "spl" && raw.data.length !== MINT_SIZE)
    throw new Error("Invalid SPL mint layout");
  const mint = unpackMint(
    new PublicKey(raw.address),
    accountInfo(raw),
    new PublicKey(raw.owner),
  );
  return { mint, program };
}
export function decodeMint(raw: RawAccount): {
  mint: Mint;
  extensions: number[];
  program: "spl" | "token2022";
} {
  const { mint, program } = unpackRawMint(raw);
  return {
    mint,
    program,
    extensions: program === "token2022" ? extensionTypes(mint.tlvData) : [],
  };
}
export function mintIsSafe(raw: RawAccount): MintSafety {
  if (raw.owner !== PROGRAM_IDS.splToken && raw.owner !== PROGRAM_IDS.token2022)
    return { ok: false, code: "unknown_program" };
  let decoded: ReturnType<typeof unpackRawMint>;
  try {
    decoded = unpackRawMint(raw);
  } catch {
    return { ok: false, code: "mint_unparseable" };
  }
  const { mint, program } = decoded;
  if (mint.decimals > FEED_RULES.maxMintDecimals)
    return { ok: false, code: "decimals" };
  if (mint.mintAuthority !== null) return { ok: false, code: "mint_authority" };
  if (mint.freezeAuthority !== null)
    return { ok: false, code: "freeze_authority" };
  let extensions: number[];
  try {
    extensions = program === "token2022" ? extensionTypes(mint.tlvData) : [];
  } catch {
    return { ok: false, code: "mint_unparseable" };
  }
  const allowed = FEED_RULES.allowedToken2022Extensions.map(
    (name) => ExtensionType[name],
  );
  if (extensions.some((type) => !allowed.includes(type)))
    return { ok: false, code: "token_extensions" };
  return { ok: true, program, decimals: mint.decimals, extensions };
}
