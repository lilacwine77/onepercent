// @vitest-environment node
import { describe, expect, it } from "vitest";
import { COVERAGE, PACK_EDITIONS, PAUSE_BITS, VRF } from "@onepercent/config";
import { PublicKey } from "@solana/web3.js";
import {
  PHASE,
  decodeBinder,
  encodeBinder,
  decodeConfig,
  encodeConfig,
  decodeMachine,
  encodeMachine,
} from "@onepercent/sdk";
import {
  clampQuantity,
  editionModels,
  onePctLiveIndex,
} from "../adapters/edition";
import { planRip, type RipSnapshot } from "./rip";

const wallet = new PublicKey("11111111111111111111111111111112");
const queue = new PublicKey("11111111111111111111111111111113");
function snapshot(): RipSnapshot {
  return {
    config: decodeConfig(
      encodeConfig({
        vrf_queues: [
          queue,
          PublicKey.default,
          PublicKey.default,
          PublicKey.default,
        ],
      }),
    ),
    machine: decodeMachine(
      encodeMachine({
        phase: PHASE.onAir,
        end_ts: 1000n,
        buckets: Array.from({ length: 16 }, (_, index) =>
          index === 0
            ? {
                class: 1,
                enabled: 1,
                amount: 100000000000n,
                cost: 100000000000n,
              }
            : {},
        ),
      }),
    ),
    deckLen: 200,
    binder: null,
    binderLamports: 0n,
    nowTs: 100n,
    vrf: {
      queue: queue.toBase58(),
      occupancyBps: 0,
      oldestItemAgeSeconds: 0,
      busy: false,
    },
  };
}

describe("edition allowance from chain coverage", () => {
  it("honors edition limits, dust reservations and the smallest unit rule", () => {
    const input = snapshot();
    expect(editionModels(input).map((edition) => edition.maxQty)).toEqual([
      10, 10, 10, 5,
    ]);
    input.machine = {
      ...input.machine,
      reserved_dust: BigInt(input.deckLen - COVERAGE.dustBuffer - 4),
    };
    expect(editionModels(input).map((edition) => edition.maxQty)).toEqual([
      1, 1, 1, 1,
    ]);
    input.machine = {
      ...input.machine,
      buckets: input.machine.buckets.map((bucket) => ({
        ...bucket,
        amount: 1n,
      })),
    };
    expect(editionModels(input)[0]).toMatchObject({
      maxQty: 0,
      state: "refilling",
    });
  });
  it("fails closed for unreadable VRF, pause, hunger and season end", () => {
    const input = snapshot();
    expect(editionModels({ ...input, vrf: null })[0]!.state).toBe("busy");
    expect(
      editionModels({ ...input, deckLen: COVERAGE.dustBuffer })[0]!.state,
    ).toBe("hungry");
    input.config = { ...input.config, guardian_paused: PAUSE_BITS.rip };
    expect(editionModels(input)[0]!.state).toBe("paused");
    input.nowTs = input.machine.end_ts;
    expect(editionModels(input)[0]!.state).toBe("seasonOver");
  });
  it("clamps quantity links without increasing the allowance", () => {
    expect(clampQuantity("100", 5)).toBe(5);
    expect(clampQuantity("1.5", 5)).toBe(1);
    expect(clampQuantity("not-a-number", 0)).toBe(0);
  });
  it("uses release time and preceding states for The 1%", () => {
    const machine = { ...snapshot().machine, on_air_ts: 10n };
    machine.onepct = machine.onepct.map((slot) => ({
      ...slot,
      amount: 1n,
      state: 1,
    }));
    expect(onePctLiveIndex(machine, 9n)).toBeNull();
    expect(onePctLiveIndex(machine, 10n)).toBe(0);
    machine.onepct = machine.onepct.map((slot) => ({ ...slot, state: 7 }));
    expect(onePctLiveIndex(machine, 999999n)).toBeNull();
  });
});

describe("buy_packs planning", () => {
  it("rereads the web flag and VRF queue before a rebuilt transaction can be signed", async () => {
    const input = snapshot();
    let enabled = true;
    const plan = await planRip({
      wallet,
      edition: "original",
      qty: 1,
      packsEnabled: () => enabled,
      read: async () => input,
      rent: async (size) => BigInt(size),
      exists: async () => false,
    });
    const blockhash = {
      blockhash: PublicKey.default.toBase58(),
      lastValidBlockHeight: 10,
    };
    enabled = false;
    await expect(plan.item.build(blockhash)).rejects.toThrow(
      "common.networkError",
    );
    enabled = true;
    input.vrf = { ...input.vrf!, queue: wallet.toBase58() };
    await expect(plan.item.build(blockhash)).rejects.toThrow(
      "errors.simulation",
    );
  });
  it.each([1, 5, 10])(
    "builds qty %i through SDK and quotes live Rent",
    async (qty) => {
      const input = snapshot();
      const plan = await planRip({
        wallet,
        edition: "original",
        qty,
        packsEnabled: true,
        read: async () => input,
        rent: async (size) => BigInt(size) * 5080n,
        exists: async () => false,
      });
      expect(plan.costs.price).toBe(
        PACK_EDITIONS[0].priceLamports * BigInt(qty),
      );
      expect(plan.costs.drawFee).toBe(VRF.feeLamports);
      const tx = await plan.item.build({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 10,
      });
      expect(tx).toBeDefined();
      expect(await plan.item.landed()).toBe(false);
    },
  );
  it("refuses a competing nonce change before the wallet can sign", async () => {
    const input = snapshot();
    const plan = await planRip({
      wallet,
      edition: "original",
      qty: 1,
      packsEnabled: true,
      read: async () => input,
      rent: async (size) => BigInt(size),
      exists: async () => false,
    });
    input.binder = decodeBinder(encodeBinder({ owner: wallet, pull_nonce: 1 }));
    await expect(
      plan.item.build({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 10,
      }),
    ).rejects.toThrow("errors.cardMoved");
  });
  it("requires a new preview if the disclosed rent grows before signing", async () => {
    const input = snapshot();
    const plan = await planRip({
      wallet,
      edition: "original",
      qty: 1,
      packsEnabled: true,
      read: async () => input,
      rent: async (size) => BigInt(size),
      exists: async () => false,
    });
    input.binder = decodeBinder(
      encodeBinder({ owner: wallet, cap: 5, len: 5 }),
    );
    await expect(
      plan.item.build({
        blockhash: PublicKey.default.toBase58(),
        lastValidBlockHeight: 10,
      }),
    ).rejects.toThrow("rip.machineChanged");
  });
  it("never builds After Hours above its configured maximum", async () => {
    const input = snapshot();
    await expect(
      planRip({
        wallet,
        edition: "after_hours",
        qty: 10,
        packsEnabled: true,
        read: async () => input,
        rent: async (size) => BigInt(size),
        exists: async () => false,
      }),
    ).rejects.toThrow();
  });
});
