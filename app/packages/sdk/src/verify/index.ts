import {
  bytes32,
  callerSeed,
  drawTier,
  dustIndex,
  hex,
  readDrawConfig,
  u64,
  unsigned,
} from "./math.js";
import type { RandomBytes, Widths } from "./math.js";

export { VerifyUnavailableError } from "./math.js";
export type { RandomBytes, Widths } from "./math.js";
export { decodeVrfQueue, VrfQueueDecodeError } from "../vrf/index.js";
export type { VrfQueue, VrfQueueOptions } from "../vrf/index.js";

export interface VerifyPullHeader {
  seq: bigint | string;
  buyer: string;
  edition: number;
  qty: number;
  liveFlags: number;
  holder: boolean;
  randomness: RandomBytes;
  /** From the request instruction; omit when that transaction is unavailable. */
  callerSeed?: RandomBytes;
}

export interface VerifyPack {
  seq?: bigint | string;
  pack: number;
  edition?: number;
  /** Exact per-pack state since M4-A2; absent on older API responses. */
  liveFlags?: number;
  holder?: boolean;
  t: number;
  widths: readonly number[];
  tier: number;
  hitBucket: number;
  dust: readonly { deckLenBefore: number; index: number }[];
}

export interface VerifyPackResult {
  pack: number;
  ok: boolean;
  metadataMatches: boolean;
  t: { computed: number; matches: boolean };
  widths: { computed: Widths; matches: boolean };
  tier: { computed: number; matches: boolean };
  dust: { slot: number; computed: number; matches: boolean }[];
  /** Historical free stock capacity is absent from the event. */
  hitBucket: { recorded: number; verified: false };
}

export interface VerifyPullResult {
  ok: boolean;
  complete: boolean;
  callerSeed: { computed: string; matches: boolean | null };
  packs: VerifyPackResult[];
}

/** Pure, browser-compatible recomputation; this does not verify the VRF proof. */
export async function verifyPull({
  pull,
  packs,
  programId,
}: {
  pull: VerifyPullHeader;
  packs: readonly VerifyPack[];
  programId: string;
}): Promise<VerifyPullResult> {
  const params = readDrawConfig();
  unsigned(pull.qty, 0xff, "qty");
  unsigned(pull.liveFlags, 0xff, "liveFlags");
  if (pull.qty === 0) throw new RangeError("A Pull must contain a pack");
  u64(pull.seq);
  const randomness = bytes32(pull.randomness);
  const computedSeed = await callerSeed(
    params,
    programId,
    pull.seq,
    pull.buyer,
  );
  const seedMatches =
    pull.callerSeed === undefined
      ? null
      : hex(bytes32(pull.callerSeed)) === computedSeed;
  const seen = new Set(packs.map(({ pack }) => pack));
  const complete =
    packs.length === pull.qty &&
    seen.size === pull.qty &&
    Array.from({ length: pull.qty }, (_, pack) => seen.has(pack)).every(
      Boolean,
    );
  const results = await Promise.all(
    packs.map(async (pack): Promise<VerifyPackResult> => {
      const liveFlags = pack.liveFlags ?? pull.liveFlags;
      const computed = await drawTier(
        params,
        randomness,
        pull.seq,
        pack.pack,
        pull.edition,
        liveFlags,
        pull.holder,
      );
      const t = { computed: computed.t, matches: computed.t === pack.t };
      const widths = {
        computed: computed.widths,
        matches:
          pack.widths.length === computed.widths.length &&
          computed.widths.every((width, index) => width === pack.widths[index]),
      };
      const tier = {
        computed: computed.tier,
        matches: computed.tier === pack.tier,
      };
      const dust = await Promise.all(
        pack.dust.map(async (pick, slot) => {
          const computed = await dustIndex(
            params,
            randomness,
            pull.seq,
            pack.pack,
            slot,
            pick.deckLenBefore,
          );
          return { slot, computed, matches: computed === pick.index };
        }),
      );
      const metadataMatches =
        pack.pack < pull.qty &&
        (pack.seq === undefined || hex(u64(pack.seq)) === hex(u64(pull.seq))) &&
        (pack.edition === undefined || pack.edition === pull.edition) &&
        (liveFlags & pull.liveFlags) === liveFlags &&
        (pack.holder === undefined || pack.holder === pull.holder);
      return {
        pack: pack.pack,
        ok:
          metadataMatches &&
          t.matches &&
          widths.matches &&
          tier.matches &&
          dust.length === params.dustCards &&
          dust.every((pick) => pick.matches),
        metadataMatches,
        t,
        widths,
        tier,
        dust,
        hitBucket: { recorded: pack.hitBucket, verified: false },
      };
    }),
  );
  return {
    ok: complete && seedMatches !== false && results.every((pack) => pack.ok),
    complete,
    callerSeed: { computed: computedSeed, matches: seedMatches },
    packs: results,
  };
}
