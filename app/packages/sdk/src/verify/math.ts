import * as config from "@onepercent/config";
import { PublicKey } from "@solana/web3.js";

export class VerifyUnavailableError extends Error {
  constructor() {
    super("Verify requires the calibrated M1 config and draw constants");
    this.name = "VerifyUnavailableError";
  }
}

export type RandomBytes = Uint8Array | readonly number[] | string;
export type Widths = [number, number, number, number, number, number];

export interface DrawConfig {
  bps: number;
  ppb: number;
  dustCards: number;
  editions: { id: string; priceLamports: bigint }[];
  odds: {
    onePctPriceDivisor: number;
    jackpotPriceDivisor: number;
    blackPpb: number;
    holoPpb: number;
    bluePpb: Record<string, number>;
  };
  holderMultiplierBps: number;
  tags: { tier: string; dust: string; vrfSeed: string };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VerifyUnavailableError();
  }
  return value as Record<string, unknown>;
}

function configNumber(value: unknown, positive = false): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (positive ? 1 : 0)
  ) {
    throw new VerifyUnavailableError();
  }
  return value;
}

function configString(value: unknown): string {
  if (typeof value !== "string" || !value.length) {
    throw new VerifyUnavailableError();
  }
  return value;
}

/** Read final M1 exports; never replace missing calibration with local economics. */
export function readDrawConfig(source: unknown = config): DrawConfig {
  const root = object(source);
  const odds = object(root.HIT_ODDS);
  const tags = object(root.DRAW_TAGS);
  const blue = object(odds.bluePpb);
  const holder = object(object(root.TOKEN_1PCT).holderTier);
  if (!Array.isArray(root.PACK_EDITIONS) || !root.PACK_EDITIONS.length) {
    throw new VerifyUnavailableError();
  }
  const editions = root.PACK_EDITIONS.map((entry: unknown) => {
    const item = object(entry);
    if (typeof item.priceLamports !== "bigint" || item.priceLamports <= 0n) {
      throw new VerifyUnavailableError();
    }
    return { id: configString(item.id), priceLamports: item.priceLamports };
  });
  return {
    bps: configNumber(root.BPS_DENOMINATOR, true),
    ppb: configNumber(root.PPB_DENOMINATOR, true),
    dustCards: configNumber(object(root.CARDS_PER_PACK).dust, true),
    editions,
    odds: {
      onePctPriceDivisor: configNumber(odds.onePctPriceDivisor, true),
      jackpotPriceDivisor: configNumber(odds.jackpotPriceDivisor, true),
      blackPpb: configNumber(odds.blackPpb),
      holoPpb: configNumber(odds.holoPpb),
      bluePpb: Object.fromEntries(
        editions.map(({ id }) => [id, configNumber(blue[id])]),
      ),
    },
    holderMultiplierBps: configNumber(holder.onePctOddsMultiplierBps, true),
    tags: {
      tier: configString(tags.tier),
      dust: configString(tags.dust),
      vrfSeed: configString(tags.vrfSeed),
    },
  };
}

export function unsigned(value: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name} is outside its unsigned range`);
  }
  return value;
}

export function u64(value: bigint | string): Uint8Array {
  if (typeof value === "string" && !/^\d{1,20}$/.test(value)) {
    throw new RangeError("seq must be an unsigned decimal u64");
  }
  const n = BigInt(value);
  if (n < 0n || n >= 1n << 64n) throw new RangeError("seq exceeds u64");
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, n, true);
  return bytes;
}

export function bytes32(value: RandomBytes): Uint8Array {
  let bytes: Uint8Array;
  if (typeof value === "string") {
    if (!/^[a-fA-F0-9]{64}$/.test(value)) {
      throw new RangeError("Expected 32 bytes encoded as hexadecimal");
    }
    bytes = Uint8Array.from(value.match(/../g)!, (part) => parseInt(part, 16));
  } else {
    for (const byte of value) unsigned(byte, 0xff, "byte");
    bytes = Uint8Array.from(value);
  }
  if (bytes.length !== 32) throw new RangeError("Expected exactly 32 bytes");
  return bytes;
}

export const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

async function sha256(parts: readonly Uint8Array[]): Promise<Uint8Array> {
  const bytes = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", bytes),
  );
}

async function sample(
  tag: string,
  randomness: RandomBytes,
  seq: bigint | string,
  pack: number,
  slot?: number,
): Promise<bigint> {
  const parts = [
    new TextEncoder().encode(tag),
    bytes32(randomness),
    u64(seq),
    Uint8Array.of(unsigned(pack, 0xff, "pack")),
  ];
  if (slot !== undefined)
    parts.push(Uint8Array.of(unsigned(slot, 0xff, "slot")));
  const hash = await sha256(parts);
  return new DataView(
    hash.buffer,
    hash.byteOffset,
    hash.byteLength,
  ).getBigUint64(0, true);
}

/** Exact M1 draw.rs mirror. Enum codes and masks are layout, not economics. */
export async function drawTier(
  params: DrawConfig,
  randomness: RandomBytes,
  seq: bigint | string,
  pack: number,
  edition: number,
  liveFlags: number,
  holder: boolean,
): Promise<{ t: number; widths: Widths; tier: number }> {
  unsigned(edition, 0xff, "edition");
  unsigned(liveFlags, 0xff, "liveFlags");
  const selected = params.editions[edition];
  if (!selected) throw new RangeError("Unknown edition");
  const base = selected.priceLamports / BigInt(params.odds.onePctPriceDivisor);
  const widths: Widths = [
    liveFlags & 1
      ? Number(
          holder
            ? (base * BigInt(params.holderMultiplierBps)) / BigInt(params.bps)
            : base,
        )
      : 0,
    0, // D1: this reserved segment is never live in Season 1.
    liveFlags & 4
      ? Number(selected.priceLamports / BigInt(params.odds.jackpotPriceDivisor))
      : 0,
    params.odds.blackPpb,
    params.odds.holoPpb,
    params.odds.bluePpb[selected.id]!,
  ];
  const t = Number(
    ((await sample(params.tags.tier, randomness, seq, pack)) *
      BigInt(params.ppb)) >>
      64n,
  );
  const kinds = [6, 7, 5, 4, 3, 2];
  let cumulative = 0;
  for (let i = 0; i < widths.length; i++) {
    cumulative += widths[i]!;
    if (t < cumulative) return { t, widths, tier: kinds[i]! };
  }
  return { t, widths, tier: 1 };
}

export async function dustIndex(
  params: DrawConfig,
  randomness: RandomBytes,
  seq: bigint | string,
  pack: number,
  slot: number,
  deckLenBefore: number,
): Promise<number> {
  unsigned(deckLenBefore, 0xffffffff, "deckLenBefore");
  return Number(
    ((await sample(params.tags.dust, randomness, seq, pack, slot)) *
      BigInt(deckLenBefore)) >>
      64n,
  );
}

export async function callerSeed(
  params: DrawConfig,
  programId: string,
  seq: bigint | string,
  buyer: string,
): Promise<string> {
  return hex(
    await sha256([
      new TextEncoder().encode(params.tags.vrfSeed),
      new PublicKey(programId).toBytes(),
      u64(seq),
      new PublicKey(buyer).toBytes(),
    ]),
  );
}
