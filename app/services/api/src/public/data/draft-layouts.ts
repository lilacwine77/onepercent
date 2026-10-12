import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { machineLayout } from "@onepercent/sdk";

/** Read-only M1 draft adapter. Offsets are ABI facts, never economic defaults.
 * Source: M1 onepercent.json bytemuck layouts, checked against state/*.rs.
 * IDL SHA-256: d8afb48e46bfe7bec8d8d90989120a937fbf6be42c15ef528c6b9a248020a83b.
 * Replace with the published SDK layouts after G1; no other worktree is imported.
 */
export class PublicDataUnavailable extends Error {
  constructor(readonly reason = "data_unavailable") {
    super(reason);
    this.name = "PublicDataUnavailable";
  }
}
export function safeNumber(value: bigint | string | number): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    throw new PublicDataUnavailable("unsafe_integer");
  return n;
}
function checked(data: Buffer, name: string, size: number, exact = true) {
  const discriminator = createHash("sha256")
    .update(`account:${name}`)
    .digest()
    .subarray(0, 8);
  if (
    data.length < size ||
    (exact && data.length !== size) ||
    !data.subarray(0, 8).equals(discriminator)
  )
    throw new PublicDataUnavailable("account_layout_mismatch");
  return data;
}
const key = (data: Buffer, at: number) =>
  new PublicKey(data.subarray(at, at + 32)).toBase58();
const uint = (data: Buffer, at: number) => data.readBigUInt64LE(at);
const ts = (data: Buffer, at: number) => safeNumber(data.readBigInt64LE(at));

export function decodeConfig(data: Buffer) {
  checked(data, "Config", 872);
  const activeIndex = data.readUInt8(738);
  if (activeIndex >= 4 || data.readUInt8(736) !== 1)
    throw new PublicDataUnavailable("account_version_mismatch");
  return {
    roles: {
      keeper: key(data, 104),
      executor: key(data, 136),
      intakeSigner: key(data, 168),
      quoteSigner: key(data, 200),
      teamWallet: key(data, 264),
      teamWallets: Array.from({ length: 8 }, (_, i) => key(data, 296 + i * 32)),
    },
    vrf: {
      queues: Array.from({ length: 4 }, (_, i) => key(data, 584 + i * 32)),
      activeIndex,
    },
    vrfProgram: key(data, 744),
    snapshotSlot: uint(data, 712).toString(),
    snapshotTs: ts(data, 720),
    stockUpTs: ts(data, 728),
    paused: data.readUInt8(740) | data.readUInt8(741),
    disabledRoles: data.readUInt8(742),
  };
}

export function decodeMachine(data: Buffer) {
  checked(data, "Machine", 3808);
  if (data.readUInt8(8) !== 1)
    throw new PublicDataUnavailable("account_version_mismatch");
  return {
    phase: data.readUInt8(10),
    season: machineLayout.decode(data),
    pendingPulls: uint(data, 24),
    reservedDust: uint(data, 32),
    powerOnTs: ts(data, 40),
    onAirTs: ts(data, 48),
    endTs: ts(data, 56),
    finalTs: ts(data, 64),
    stockSol: uint(data, 72),
    jackpotSol: uint(data, 80),
    hourIndex: uint(data, 120),
    hitOutThisHour: uint(data, 128),
    hitOutLastHour: uint(data, 136),
    sbPaidHour: uint(data, 144),
    solAtHourStart: uint(data, 152),
    buckets: Array.from({ length: 16 }, (_, index) => {
      const at = 224 + index * 128;
      const bucket = {
        index,
        mint: key(data, at),
        amount: uint(data, at + 64),
        cost: uint(data, at + 72),
        reserved: uint(data, at + 80),
        cap: uint(data, at + 88),
        class: data.readUInt8(at + 109),
        enabled: data.readUInt8(at + 110),
      };
      if (
        bucket.class > 2 ||
        bucket.enabled > 1 ||
        bucket.reserved > bucket.cost
      )
        throw new PublicDataUnavailable("invalid_bucket");
      return bucket;
    }),
    jackpotTokens: uint(data, 2272),
    jackpotCost: uint(data, 2280),
    onePct: Array.from({ length: 4 }, (_, i) => ({
      amount: uint(data, 2336 + i * 16).toString(),
      state: data.readUInt8(2344 + i * 16),
    })),
  };
}
export type DraftMachine = ReturnType<typeof decodeMachine>;

export function decodeDeckHeader(data: Buffer) {
  checked(data, "Deck", 64);
  const len = data.readUInt32LE(8);
  if (len > data.readUInt32LE(12) || data.readUInt8(49) !== 1)
    throw new PublicDataUnavailable("invalid_deck");
  return { len };
}

export const BINDER_HEADER_BYTES = 112;
export const BINDER_CARD_BYTES = 56;

export function decodeBinderHeader(data: Buffer, owner: string) {
  checked(data, "Binder", BINDER_HEADER_BYTES);
  const len = data.readUInt16LE(104),
    cap = data.readUInt16LE(106),
    reserved = data.readUInt16LE(108);
  if (len + reserved > cap || key(data, 8) !== owner)
    throw new PublicDataUnavailable("invalid_binder");
  const seasonSpend = uint(data, 72),
    solOwed = uint(data, 80),
    freshInDeck = data.readUInt16LE(102),
    flags = data.readUInt8(111);
  return {
    owner,
    referrer: key(data, 40),
    seasonSpend: seasonSpend.toString(),
    solOwed: solOwed.toString(),
    feedNonceBase: data.readUInt32LE(88),
    sbNonce: data.readUInt32LE(92),
    pullNonce: data.readUInt32LE(96),
    feedNonceBits: data.readUInt16LE(100),
    freshInDeck,
    len,
    cap,
    reserved,
    bump: data.readUInt8(110),
    flags,
    closable:
      len === 0 &&
      reserved === 0 &&
      freshInDeck === 0 &&
      solOwed === 0n &&
      (seasonSpend === 0n || (flags & 3) === 3),
  };
}

export function decodeBinderCards(data: Buffer, firstIndex: number) {
  if (data.length % BINDER_CARD_BYTES !== 0)
    throw new PublicDataUnavailable("invalid_binder");
  return Array.from({ length: data.length / BINDER_CARD_BYTES }, (_, i) => {
    const at = i * BINDER_CARD_BYTES;
    return {
      index: firstIndex + i,
      mint: key(data, at),
      amount: uint(data, at + 32).toString(),
      value: uint(data, at + 40).toString(),
      kind: data.readUInt8(at + 48),
      edition: data.readUInt8(at + 49),
      flags: data.readUInt8(at + 50),
      seqLo: data.readUInt32LE(at + 52),
    };
  });
}

export function decodeBinder(data: Buffer, owner: string) {
  const header = decodeBinderHeader(
    data.subarray(0, BINDER_HEADER_BYTES),
    owner,
  );
  if (data.length !== BINDER_HEADER_BYTES + header.cap * BINDER_CARD_BYTES)
    throw new PublicDataUnavailable("invalid_binder");
  return {
    ...header,
    cards: decodeBinderCards(
      data.subarray(
        BINDER_HEADER_BYTES,
        BINDER_HEADER_BYTES + header.len * BINDER_CARD_BYTES,
      ),
      0,
    ),
  };
}

export function decodePullHeader(data: Buffer) {
  checked(data, "Pull", 176, false);
  const qty = data.readUInt8(143);
  if (data.length !== 176 + qty * 200 || data.readUInt8(147) !== 1)
    throw new PublicDataUnavailable("invalid_pull");
  return {
    seq: uint(data, 8).toString(),
    buyer: key(data, 16),
    buyerNonce: data.readUInt32LE(136),
    qty,
    status: data.readUInt8(144),
    settledMask: data.readUInt16LE(140),
  };
}
