import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  decodeBinder,
  decodeConfig,
  decodeDeck,
  decodeMachine,
  decodeMintLedger,
  decodePull,
  encodeBinder,
  encodeConfig,
  encodeDeck,
  encodeMachine,
  encodeMintLedger,
  encodePull,
  LAYOUTS,
} from "../src/layouts.js";
import { vectors } from "./vectors.js";
const owner = new PublicKey(new Uint8Array(32).fill(11));
const mint = new PublicKey(new Uint8Array(32).fill(12));
describe("exact zero-copy layouts", () => {
  it("matches every Rust offset_of and size_of field", () => {
    const expected =
      vectors<Record<string, { size: number; fields: Record<string, number> }>>(
        "layouts",
      );
    expect(Object.keys(expected).sort()).toEqual(Object.keys(LAYOUTS).sort());
    for (const [name, layout] of Object.entries(LAYOUTS))
      expect({ size: layout.size, fields: layout.fields }).toEqual(
        expected[name],
      );
  });
  it("round trips fixed accounts, nested structs and integer extremes", () => {
    const config = encodeConfig({
      admin: owner,
      snapshot_slot: (1n << 64n) - 1n,
      snapshot_ts: -123n,
      vrf_program: mint,
    });
    expect(encodeConfig(decodeConfig(config))).toEqual(config);
    expect(config.length).toBe(872);
    const machine = encodeMachine({
      next_seq: (1n << 64n) - 1n,
      power_on_ts: -1n,
      token_mint: mint,
      final_sol_total: (1n << 64n) - 1n,
      final_1pct_total: 17n,
      buckets: Array.from({ length: 16 }, (_, i) => ({
        mint,
        amount: BigInt(i + 1),
        class: 1,
        enabled: 1,
      })),
      onepct: Array.from({ length: 4 }, (_, i) => ({ amount: BigInt(i) })),
      spotlight: { sponsor: owner },
      exec: { target: mint },
    });
    expect(encodeMachine(decodeMachine(machine))).toEqual(machine);
    expect(machine.length).toBe(3808);
    const ledger = encodeMintLedger({
      mint,
      payer: owner,
      accounted: (1n << 64n) - 1n,
    });
    expect(encodeMintLedger(decodeMintLedger(ledger))).toEqual(ledger);
  });
  it("round trips Deck and reads bounded ranges in entry order", () => {
    const data = encodeDeck({
      cap: 4,
      entries: [
        { depositor: owner, mint, amount: 7n, flags: 1 },
        { depositor: mint, mint: owner, amount: 9n, deposit: 77 },
      ],
    });
    expect(encodeDeck(decodeDeck(data))).toEqual(data);
    expect(
      decodeDeck(data, { start: 1, count: 1 }).entries.map((e) => e.amount),
    ).toEqual([9n]);
    expect(() => decodeDeck(data, { start: 1, count: 2 })).toThrow();
  });
  it("round trips Binder cards and reserved capacity", () => {
    const data = encodeBinder({
      owner,
      referrer: mint,
      reserved: 2,
      feed_nonce_bits: 0xffff,
      cards: [{ mint, amount: 3n, seq_lo: 0xffffffff, kind: 4, value: 10n }],
    });
    const decoded = decodeBinder(data);
    expect(decoded.cap).toBe(3);
    expect(encodeBinder(decoded)).toEqual(data);
  });
  it("round trips Pull records and royalties", () => {
    const data = encodePull({
      seq: 3n,
      buyer: owner,
      qty: 2,
      packs: [
        {
          backing: 255,
          tier: 4,
          royalties: Array.from({ length: 4 }, () => ({
            depositor: owner,
            lamports: 9n,
            refund: 7n,
          })),
        },
        { tier: 1, house_mask: 15 },
      ],
    });
    expect(encodePull(decodePull(data))).toEqual(data);
  });
  it("rejects malformed capacities, bounds and discriminators", () => {
    expect(() => decodeDeck(new Uint8Array(64))).toThrow(/discriminator/);
    expect(() => decodeBinder(encodeBinder({ cap: 0, reserved: 1 }))).toThrow();
    const data = encodeDeck({ entries: [{ mint, amount: 1n }] });
    data.writeUInt32LE(2, 8);
    expect(() => decodeDeck(data)).toThrow(/capacity/);
    expect(() => decodePull(encodePull({ qty: 1 }).subarray(0, 200))).toThrow();
    expect(() => encodeMintLedger({ accounted: 1n << 64n })).toThrow();
  });
});
