import { PROGRAM_ID } from "../../../../packages/sdk/tests/program-id.js";
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { decodePull, encodePull, PULL_STATUS } from "@onepercent/sdk";
import { parseOnepercentLogs, type PackRevealed } from "@onepercent/sdk/events";
import { WEB, VRF } from "@onepercent/config";
import recorded from "../../../../packages/sdk/src/verify/fixtures/validator-pulls.json";
import type { PullEvidence } from "../data/pull";
import { ripResult } from "../adapters/rip-result";
import { crossCheckReveal, watchPull, type PullWatchPort } from "./watch-pull";

const fixture = recorded.pulls[0]!;
const parsed = parseOnepercentLogs({
  programId: PROGRAM_ID.toBase58(),
  logs: fixture.callback.logs,
  err: null,
});
const packs = parsed.events.flatMap((event) =>
  event.name === "PackRevealed" ? [event.data] : [],
);
const makeEvidence = (): PullEvidence => ({
  header: {
    seq: fixture.header.seq,
    buyer: fixture.header.buyer,
    edition: fixture.header.edition,
    qty: fixture.header.qty,
    liveFlags: fixture.header.live_flags,
    holder: fixture.header.holder !== 0,
    randomness: Uint8Array.from(fixture.header.randomness),
  },
  packs,
  opened: null,
  refunded: false,
  requestSignature: fixture.requestSignature,
  callbackSignature: fixture.callbackSignature,
  settleSignatures: [],
  source: "rpc",
  transactions: new Map(),
});
const expected = {
  buyer: fixture.header.buyer,
  edition: fixture.header.edition,
  qty: fixture.header.qty,
};
const account = () =>
  decodePull(
    encodePull({
      seq: BigInt(fixture.header.seq),
      buyer: new PublicKey(fixture.header.buyer),
      edition: fixture.header.edition,
      qty: fixture.header.qty,
      status: PULL_STATUS.revealed,
      randomness: Uint8Array.from(fixture.header.randomness),
      packs: packs.map((pack) => ({
        tier: pack.tier,
        carved_bucket: pack.hit_bucket,
        house_mask: pack.house_mask,
        royalties: pack.dust.map((pick) => ({
          depositor: new PublicKey(pick.depositor),
        })),
      })),
    }),
  );
const port = (): PullWatchPort => ({
  read: async () => account(),
  evidence: async () => makeEvidence(),
  display: vi.fn(async () => ({ items: [] })),
  chainNow: async () => 1n,
});
afterEach(() => vi.useRealTimers());

describe("verified reveal delivery", () => {
  it("matches a recorded callback and preserves dust order", async () => {
    const input = port();
    const result = await watchPull(input, expected);
    expect(result.state).toBe("revealed");
    if (result.state !== "revealed") throw new Error("Expected reveal");
    expect(result.results[0]!.dust.map((pick) => pick.fedBy)).toEqual(
      packs[0]!.dust.map((pick) => pick.depositor),
    );
    expect(input.display).toHaveBeenCalledTimes(1);
    expect(result.results[0]!.hit.valueSolUi).toBeNull();
  });
  it("offers Sell only with an executable quote received after the verified result", async () => {
    const input = {
      ...port(),
      sell: vi.fn(
        async () => new Map([[packs[0]!.pack, { payout: 87_000_000n }]]),
      ),
    };
    const result = await watchPull(input, expected);
    if (result.state !== "revealed") throw new Error("Expected reveal");
    expect(input.sell).toHaveBeenCalledWith(packs);
    expect(result.results[0]!.hit.actions).toEqual(["sell_back", "my_cards"]);
    expect(result.results[0]!.hit.sellBackSolUi).toBe("0.08");
    expect(result.sell.get(packs[0]!.pack)?.payout).toBe(87_000_000n);
  });
  it("keeps the reveal deadline and My cards when Sell does not answer", async () => {
    const input = { ...port(), sell: () => new Promise<never>(() => {}) };
    const result = await watchPull(input, expected);
    if (result.state !== "revealed") throw new Error("Expected reveal");
    expect(result.results[0]!.hit.actions).toEqual(["my_cards"]);
    expect(result.sell.size).toBe(0);
  });
  it("never requests outcome data while a Pull remains pending", async () => {
    vi.useFakeTimers();
    const current = account();
    current.status = PULL_STATUS.pending;
    current.created_ts = 1n;
    const input = {
      ...port(),
      read: async () => current,
      evidence: vi.fn(),
      sell: vi.fn(),
      chainNow: async () => 1n,
    };
    const abort = new AbortController();
    const promise = watchPull(input, expected, { signal: abort.signal });
    const failed = expect(promise).rejects.toThrow("Aborted");
    await vi.advanceTimersByTimeAsync(WEB.pullPollFastMs * 2);
    expect(input.evidence).not.toHaveBeenCalled();
    expect(input.display).not.toHaveBeenCalled();
    expect(input.sell).not.toHaveBeenCalled();
    abort.abort();
    await failed;
  });
  it("offers a refund only after the chain clock reaches the deadline", async () => {
    const current = account();
    current.status = PULL_STATUS.pending;
    current.created_ts = 1n;
    const input = {
      ...port(),
      read: async () => current,
      chainNow: async () => 1n + BigInt(VRF.timeoutSeconds),
    };
    expect((await watchPull(input, expected)).state).toBe("refundable");
    expect(input.display).not.toHaveBeenCalled();
  });
  it("fails closed on altered PackRecord, randomness and duplicate packs", async () => {
    const current = account();
    current.packs = current.packs.map((pack) => ({
      ...pack,
      tier: pack.tier + 1,
    }));
    await expect(
      crossCheckReveal(makeEvidence(), expected, current),
    ).rejects.toThrow();
    const changed = makeEvidence();
    changed.header.randomness = new Uint8Array(32);
    await expect(
      crossCheckReveal(changed, expected, account()),
    ).rejects.toThrow();
    const duplicated = makeEvidence();
    duplicated.packs = [...packs, ...packs];
    await expect(crossCheckReveal(duplicated, expected)).rejects.toThrow();
  });
  it("finishes at the shared display deadline when metadata does not answer", async () => {
    const input = { ...port(), display: () => new Promise<never>(() => {}) };
    const result = watchPull(input, expected);
    expect((await result).state).toBe("revealed");
  });
  it("keeps explicit House positions and rejects unissued tiers", () => {
    const pack = { ...packs[0]!, house_mask: 5 };
    expect(
      ripResult(pack, { items: [] }).dust.map((pick) => pick.house),
    ).toEqual([true, false, true, false]);
    expect(() =>
      ripResult({ ...pack, tier: 7 } as PackRevealed, { items: [] }),
    ).toThrow();
  });
});
