import { warnCause } from "@onepercent/service-kit";
import {
  decodeMint,
  PROGRAM_IDS,
  type RawAccount,
} from "@onepercent/eligibility";
import { PublicKey } from "@solana/web3.js";

const TOKEN_METADATA_EXTENSION = 19;
const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Read inline Token-2022 metadata only; URI points to JSON and is never fetched here. */
export function token2022Metadata(
  raw: RawAccount | null | undefined,
): { symbol?: string; name?: string; uri?: string } | undefined {
  if (raw?.owner !== PROGRAM_IDS.token2022) return undefined;
  try {
    const { mint } = decodeMint(raw);
    if (!mint.isInitialized) return undefined;
    const tlv = mint.tlvData;
    let data: Buffer | undefined;
    for (let offset = 0; offset + 4 <= tlv.length;) {
      const type = tlv.readUInt16LE(offset);
      const length = tlv.readUInt16LE(offset + 2);
      if (type === TOKEN_METADATA_EXTENSION) {
        if (data) return undefined;
        data = tlv.subarray(offset + 4, offset + 4 + length);
      }
      offset += 4 + length;
    }
    if (!data || data.length < 64) return undefined;
    if (new PublicKey(data.subarray(32, 64)).toBase58() !== raw.address)
      return undefined;
    let offset = 64;
    const u32 = () => {
      const value = data.readUInt32LE(offset);
      offset += 4;
      return value;
    };
    const string = () => {
      const length = u32();
      if (length > data.length - offset)
        throw new Error("Invalid metadata length");
      const value = utf8.decode(data.subarray(offset, offset + length));
      offset += length;
      return value;
    };
    // SPL TokenMetadata: update authority, associated mint, Borsh strings, then pairs.
    const name = string();
    const symbol = string();
    const uri = string();
    const pairs = u32();
    if (pairs > (data.length - offset) / 8) return undefined;
    for (let index = 0; index < pairs; index += 1) {
      string();
      string();
    }
    if (offset !== data.length) return undefined;
    return {
      ...(symbol ? { symbol } : {}),
      ...(name ? { name } : {}),
      ...(uri ? { uri } : {}),
    };
  } catch (error) {
    warnCause("xray_metadata_invalid", error);
    return undefined;
  }
}
