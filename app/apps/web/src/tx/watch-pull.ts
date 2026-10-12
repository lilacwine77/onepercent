import { webDeployment } from "../data/deployment";
import { CARDS_PER_PACK, VRF, WEB } from "@onepercent/config";
import { PULL_STATUS, type Pull } from "@onepercent/sdk/browser";
import { verifyPull } from "@onepercent/sdk/verify";
import type { PackRevealed } from "@onepercent/sdk/events";
import type { ValuesOutput } from "@onepercent/web-api";
import type { RipResult } from "../experience/index";
import type { PullEvidence } from "../data/pull";
import { ripResult } from "../adapters/rip-result";
import { EngineError } from "./engine/errors";

export interface PullWatchPort {
  read(): Promise<Pull | null>;
  evidence(seq?: bigint, current?: Pull): Promise<PullEvidence | null>;
  display(items: { mint: string; amount: string }[]): Promise<ValuesOutput>;
  sell?(
    packs: readonly PackRevealed[],
  ): Promise<Map<number, { payout: bigint }>>;
  chainNow(): Promise<bigint>;
  /** A hint only schedules a fresh confirmed account read. */
  subscribeHint?(listener: () => void): () => void;
}
export type WatchedPull =
  | {
      state: "revealed";
      evidence: PullEvidence;
      results: RipResult[];
      sell: Map<number, { payout: bigint }>;
    }
  | { state: "refundable"; pull: Pull }
  | { state: "refunded"; evidence: PullEvidence };

export async function crossCheckReveal(
  evidence: PullEvidence,
  expected: { buyer: string; edition: number; qty: number },
  current?: Pull,
  programId = webDeployment().programId,
) {
  const { header, packs } = evidence;
  if (
    header.buyer !== expected.buyer ||
    header.edition !== expected.edition ||
    header.qty !== expected.qty ||
    (current &&
      (BigInt(header.seq) !== current.seq ||
        header.buyer !== current.buyer.toBase58()))
  )
    throw new EngineError("errors.generic");
  if (evidence.refunded) throw new EngineError("errors.generic");
  if (current?.status === PULL_STATUS.revealed) {
    const randomness =
      typeof header.randomness === "string"
        ? Uint8Array.from(header.randomness.match(/../g) ?? [], (byte) =>
            Number(BigInt(`0x${byte}`)),
          )
        : header.randomness;
    if (
      randomness.length !== current.randomness.length ||
      randomness.some((byte, i) => byte !== current.randomness[i])
    )
      throw new EngineError("errors.generic");
    for (const pack of packs) {
      const record = current.packs[pack.pack];
      if (
        !record ||
        pack.tier !== record.tier ||
        pack.hit_bucket !== record.carved_bucket ||
        pack.house_mask !== record.house_mask ||
        pack.dust.some(
          (pick, slot) =>
            pick.depositor !== record.royalties[slot]?.depositor.toBase58(),
        )
      )
        throw new EngineError("errors.generic");
    }
  }
  const checked = await verifyPull({
    pull: header,
    packs: packs.map((pack) => ({
      seq: pack.seq,
      pack: pack.pack,
      edition: pack.edition,
      liveFlags: pack.live_flags,
      holder: pack.holder,
      t: pack.t,
      widths: pack.widths,
      tier: pack.tier,
      hitBucket: pack.hit_bucket,
      dust: pack.dust.map((pick) => ({
        deckLenBefore: pick.deck_len_before,
        index: pick.index,
      })),
    })),
    programId: programId.toBase58(),
  });
  if (
    !checked.ok ||
    !checked.complete ||
    packs.some((pack) => pack.dust.length !== CARDS_PER_PACK.dust)
  )
    throw new EngineError("errors.generic");
  return [...packs].sort((a, b) => a.pack - b.pack);
}

/** Only this verified path resolves results for the experience's Promise adapter. */
export async function watchPull(
  port: PullWatchPort,
  expected: { buyer: string; edition: number; qty: number },
  options: { signal?: AbortSignal; now?: () => number } = {},
): Promise<WatchedPull> {
  const now = options.now ?? Date.now;
  const start = now();
  let last: Pull | undefined;
  let nudge: (() => void) | undefined;
  const unsubscribe = port.subscribeHint?.(() => nudge?.());
  const pause = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        nudge = undefined;
        resolve();
      };
      const abort = () => {
        clearTimeout(timer);
        nudge = undefined;
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(finish, ms);
      nudge = finish;
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  try {
    for (;;) {
      if (options.signal?.aborted)
        throw new DOMException("Aborted", "AbortError");
      const current = await port.read().catch(() => undefined);
      if (current === undefined) {
        await pause(WEB.pullPollSlowMs);
        continue;
      }
      if (current) last = current;
      if (!current || current.status === PULL_STATUS.revealed) {
        const evidence = await port.evidence(last?.seq, current ?? last);
        if (evidence?.refunded) {
          if (
            current?.status === PULL_STATUS.revealed ||
            evidence.header.buyer !== expected.buyer ||
            evidence.header.edition !== expected.edition ||
            evidence.header.qty !== expected.qty
          )
            throw new EngineError("errors.generic");
          return { state: "refunded", evidence };
        }
        if (evidence) {
          const packs = await crossCheckReveal(
            evidence,
            expected,
            current ?? undefined,
          );
          // One tier-independent batch for the whole Pull, bounded at fifty cards.
          const items = packs.flatMap((pack) => [
            ...pack.dust.map((pick) => ({
              mint: pick.mint,
              amount: pick.amount.toString(),
            })),
            { mint: pack.hit_mint, amount: pack.hit_amount.toString() },
          ]);
          let display: ValuesOutput = { items: [] };
          let sell = new Map<number, { payout: bigint }>();
          let deadline: ReturnType<typeof setTimeout> | undefined;
          // Metadata and an optional Sell quote share one deadline. A missing
          // quote never delays the reveal or changes the verified cards.
          await Promise.race([
            Promise.all([
              Promise.resolve()
                .then(() => port.display(items))
                .then((value) => {
                  display = value;
                })
                .catch(() => undefined),
              Promise.resolve()
                .then(() => port.sell?.(packs))
                .then((value) => {
                  if (value) sell = value;
                })
                .catch(() => undefined),
            ]),
            new Promise<void>((resolve) => {
              deadline = setTimeout(resolve, WEB.revealDataDeadlineMs);
            }),
          ]).finally(() => clearTimeout(deadline));
          if (options.signal?.aborted)
            throw new DOMException("Aborted", "AbortError");
          return {
            state: "revealed",
            evidence,
            sell,
            results: packs.map((pack) =>
              ripResult(pack, display, sell.get(pack.pack)),
            ),
          };
        }
      }
      if (
        current?.status === PULL_STATUS.pending &&
        (await port.chainNow()) >=
          current.created_ts + BigInt(VRF.timeoutSeconds)
      )
        return { state: "refundable", pull: current };
      await pause(
        now() - start < WEB.pullPollFastForMs
          ? WEB.pullPollFastMs
          : WEB.pullPollSlowMs,
      );
    }
  } finally {
    unsubscribe?.();
  }
}
