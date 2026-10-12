import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { checkPumpOrigin, bondingCurvePda } from "../src/origin.js";
import { extensionTypes, mintIsSafe } from "../src/mint-safety.js";
import { CURVE_OFFSETS, curveDisplayState } from "../src/curve-cap.js";
import {
  classifyWallet,
  parseTokenAccounts,
  nonEmptyMints,
  type ClassifyWalletInput,
} from "../src/classify.js";
import { PROGRAM_IDS, WSOL_MINT } from "../src/params.js";
import type { RawAccount } from "../src/types.js";
interface Recorded extends Omit<RawAccount, "lamports" | "data"> {
  lamports: string;
  dataBase64: string;
  slot: number;
  recordedAt: string;
  source: string;
}
function recorded(name: string): RawAccount {
  const file = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../fixtures/mainnet/${name}.json`, import.meta.url),
      ),
      "utf8",
    ),
  ) as Recorded;
  expect(file.source).toBe("mainnet");
  expect(file.slot).toBeGreaterThan(0);
  expect(Number.isNaN(Date.parse(file.recordedAt))).toBe(false);
  return {
    address: file.address,
    owner: file.owner,
    lamports: BigInt(file.lamports),
    data: Buffer.from(file.dataBase64, "base64"),
  };
}
const mutable = (account: RawAccount): RawAccount & { data: Buffer } => ({
  ...account,
  data: Buffer.from(account.data),
});
const syntheticOwner = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const syntheticAddress = (byte: number) =>
  new PublicKey(new Uint8Array(32).fill(byte)).toBase58();
function tokenAccount(name: string, mint: string, amount: bigint, id = 8) {
  const raw = mutable(recorded(name));
  raw.address = syntheticAddress(id);
  new PublicKey(mint).toBuffer().copy(raw.data, 0);
  new PublicKey(syntheticOwner).toBuffer().copy(raw.data, 32);
  raw.data.writeBigUInt64LE(amount, 64);
  raw.data[108] = 1;
  raw.data.writeUInt32LE(0, 129);
  return raw;
}
function inputFor(
  accounts: RawAccount[],
  mintName = "fartcoin",
): ClassifyWalletInput {
  const mint = recorded(mintName),
    curve = recorded(`${mintName}-curve`);
  return {
    owner: syntheticOwner,
    tokenAccounts: accounts,
    mints: new Map([[mint.address, mint]]),
    curves: new Map([[mint.address, curve]]),
    prices: { [mint.address]: { usdPrice: 100, ageSlots: 0 } },
    solUsd: 100,
    exitCaps: new Map([[mint.address, 1_000_000_000n]]),
  };
}
describe("recorded origin", () => {
  it("reuses deterministic PDA derivation across string and public-key callers", () => {
    const mint = new PublicKey(new Uint8Array(32).fill(87));
    const derive = vi.spyOn(PublicKey, "findProgramAddressSync");
    try {
      const address = bondingCurvePda(mint);
      expect(bondingCurvePda(mint.toBase58()).toBase58()).toBe(
        address.toBase58(),
      );
      expect(derive).toHaveBeenCalledOnce();
    } finally {
      derive.mockRestore();
    }
  });
  it.each(["fartcoin", "catcraft", "no-suffix"])(
    "verifies %s without checking a name suffix",
    (name) => {
      const mint = recorded(name),
        curve = recorded(`${name}-curve`);
      expect(checkPumpOrigin(mint.address, curve)).toBe(true);
      expect(bondingCurvePda(mint.address).toBase58()).toBe(curve.address);
    },
  );
  it("rejects missing curves, wrong owner, bytes or PDA", () => {
    const mint = recorded("fartcoin"),
      curve = mutable(recorded("fartcoin-curve"));
    expect(checkPumpOrigin(recorded("bonk").address, null)).toBe(false);
    expect(
      checkPumpOrigin(mint.address, { ...curve, owner: PROGRAM_IDS.splToken }),
    ).toBe(false);
    curve.data[0] = 0;
    expect(checkPumpOrigin(mint.address, curve)).toBe(false);
    expect(checkPumpOrigin(mint.address, recorded("catcraft-curve"))).toBe(
      false,
    );
  });
  it.each([8, 81, 150, 151, 166, 300])(
    "accepts valid discriminator and PDA at %i bytes",
    (length) => {
      const mint = recorded("fartcoin"),
        curve = recorded("fartcoin-curve"),
        data = Buffer.alloc(length);
      Buffer.from(curve.data).copy(
        data,
        0,
        0,
        Math.min(length, curve.data.length),
      );
      expect(checkPumpOrigin(mint.address, { ...curve, data })).toBe(true);
    },
  );
});
describe("mint safety ordering and Token-2022 parsing", () => {
  it.each(["fartcoin", "catcraft", "no-suffix"])("accepts safe %s", (name) =>
    expect(mintIsSafe(recorded(name)).ok).toBe(true),
  );
  it.each(["transfer-hook", "permanent-delegate"])(
    "rejects %s extensions",
    (name) =>
      expect(mintIsSafe(recorded(name))).toEqual({
        ok: false,
        code: "token_extensions",
      }),
  );
  it("rejects all authority and layout failures in order", () => {
    const safe = mutable(recorded("fartcoin"));
    expect(mintIsSafe({ ...safe, owner: PROGRAM_IDS.pumpFun })).toEqual({
      ok: false,
      code: "unknown_program",
    });
    expect(mintIsSafe({ ...safe, data: safe.data.subarray(0, 10) })).toEqual({
      ok: false,
      code: "mint_unparseable",
    });
    expect(mintIsSafe(recorded("usdc"))).toEqual({
      ok: false,
      code: "mint_authority",
    });
    safe.data.writeUInt32LE(1, 46);
    Buffer.alloc(32, 9).copy(safe.data, 50);
    expect(mintIsSafe(safe)).toEqual({ ok: false, code: "freeze_authority" });
    safe.data.writeUInt32LE(1, 0);
    Buffer.alloc(32, 9).copy(safe.data, 4);
    expect(mintIsSafe(safe)).toEqual({ ok: false, code: "mint_authority" });
    safe.data[44] = 10;
    expect(mintIsSafe(safe)).toEqual({ ok: false, code: "decimals" });
    expect(
      mintIsSafe({ ...recorded("catcraft"), owner: PROGRAM_IDS.splToken }),
    ).toEqual({ ok: false, code: "mint_unparseable" });
  });
  it("rejects unknown types and malformed TLV, but accepts zero padding", () => {
    const raw = mutable(recorded("catcraft"));
    raw.data.writeUInt16LE(60000, 166);
    expect(mintIsSafe(raw)).toEqual({ ok: false, code: "token_extensions" });
    const valid = recorded("catcraft");
    expect(
      mintIsSafe({
        ...valid,
        data: Buffer.concat([valid.data, Buffer.from([1])]),
      }),
    ).toEqual({ ok: false, code: "mint_unparseable" });
    expect(
      mintIsSafe({
        ...valid,
        data: Buffer.concat([valid.data, Buffer.alloc(4)]),
      }).ok,
    ).toBe(true);
    const decimalsBeforeTlv = mutable({
      ...valid,
      data: Buffer.concat([valid.data, Buffer.from([1])]),
    });
    decimalsBeforeTlv.data[44] = 10;
    expect(mintIsSafe(decimalsBeforeTlv)).toEqual({
      ok: false,
      code: "decimals",
    });
  });
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "ignores %i trailing zero bytes before the SPL extension parser",
    (size) => {
      const padding = Buffer.alloc(size);
      const valid = recorded("catcraft");
      expect(extensionTypes(padding)).toEqual([]);
      expect(
        extensionTypes(
          Buffer.concat([Buffer.from([18, 0, 2, 0, 0, 0]), padding]),
        ),
      ).toEqual([18]);
      expect(
        mintIsSafe({ ...valid, data: Buffer.concat([valid.data, padding]) }),
      ).toEqual(mintIsSafe(valid));
    },
  );
  it("still rejects nonzero partial headers and truncated extension values", () => {
    for (const tail of [[1], [1, 0], [0, 0, 1], [18, 0, 2, 0, 0]])
      expect(() => extensionTypes(Buffer.from(tail))).toThrow();
  });
});
describe("official curve display layout", () => {
  it("derives offsets from the recorded official IDL field sequence", () => {
    const idl = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL("../fixtures/idl-bonding-curve.json", import.meta.url),
        ),
        "utf8",
      ),
    ) as {
      discriminatorBytes: number;
      fields: { name: string; type: "u64" | "u8" | "bool" | "pubkey" }[];
    };
    const widths = { u64: 8, u8: 1, bool: 1, pubkey: 32 };
    let position = idl.discriminatorBytes;
    const offsets = new Map<string, number>();
    for (const field of idl.fields) {
      offsets.set(field.name, position);
      position += widths[field.type];
    }
    expect({
      realQuoteReserves: offsets.get("real_quote_reserves"),
      complete: offsets.get("complete"),
      quoteMint: offsets.get("quote_mint"),
    }).toEqual(CURVE_OFFSETS);
    expect(position).toBe(166);
  });
  it("reads complete and quote mint at the official IDL offsets", () => {
    expect(CURVE_OFFSETS).toEqual({
      realQuoteReserves: 32,
      complete: 48,
      quoteMint: 83,
    });
    const complete = recorded("fartcoin-curve");
    expect(complete.data[48]).toBe(1);
    expect(curveDisplayState(complete)?.capLamports).toBeNull();
    const incomplete = recorded("incomplete-curve");
    expect(incomplete.data[48]).toBe(0);
    expect(curveDisplayState(incomplete)?.capLamports).toBe(
      Buffer.from(incomplete.data).readBigUInt64LE(32),
    );
    expect(curveDisplayState(incomplete)?.solQuoted).toBe(true);
  });
  it("handles historical short layouts, non-SOL quotes and undecodable states", () => {
    const curve = mutable(recorded("incomplete-curve"));
    expect(
      curveDisplayState({ ...curve, data: curve.data.subarray(0, 81) })
        ?.capLamports,
    ).toBe(curve.data.readBigUInt64LE(32));
    new PublicKey(recorded("usdc").address).toBuffer().copy(curve.data, 83);
    expect(curveDisplayState(curve)?.capLamports).toBeNull();
    expect(curveDisplayState(curve)?.solQuoted).toBe(false);
    expect(
      curveDisplayState({ ...curve, data: curve.data.subarray(0, 100) }),
    ).toBeNull();
    expect(
      curveDisplayState({ ...curve, data: curve.data.subarray(0, 8) }),
    ).toBeNull();
  });
});
describe("token accounts and classification", () => {
  it("parses recorded 165B, 170B and fee accounts, skips malformed accounts", () => {
    const records = [
      recorded("empty-spl-account"),
      recorded("immutable-owner-account"),
      recorded("transfer-fee-account"),
    ];
    expect(records.slice(0, 2).map((raw) => raw.data.length)).toEqual([
      165, 170,
    ]);
    const result = parseTokenAccounts([
      ...records,
      { ...records[0]!, data: new Uint8Array(2) },
    ]);
    expect(result.accounts).toHaveLength(3);
    expect(result.skipped).toBe(1);
  });
  it.each([1, 2, 3])(
    "retains a token account with %i trailing zero TLV bytes",
    (size) => {
      const mint = recorded("catcraft");
      const account = tokenAccount("immutable-owner-account", mint.address, 0n);
      const result = classifyWallet(
        inputFor(
          [
            {
              ...account,
              data: Buffer.concat([account.data, Buffer.alloc(size)]),
            },
          ],
          "catcraft",
        ),
      );
      expect(result.skippedTokenAccounts).toBe(0);
      expect(result.empties).toHaveLength(1);
    },
  );
  it("uses actual lamports and closes only accessible empty accounts including wSOL", () => {
    const mint = recorded("fartcoin");
    const empty = tokenAccount("empty-spl-account", mint.address, 0n, 10);
    empty.lamports = 123n;
    const wsol = tokenAccount("empty-spl-account", WSOL_MINT, 0n, 11);
    wsol.lamports = 456n;
    const frozen = tokenAccount("empty-spl-account", mint.address, 0n, 12);
    frozen.data[108] = 2;
    const foreign = tokenAccount("empty-spl-account", mint.address, 0n, 13);
    foreign.data.writeUInt32LE(1, 129);
    Buffer.alloc(32, 9).copy(foreign.data, 133);
    const result = classifyWallet(inputFor([empty, wsol, frozen, foreign]));
    expect(
      result.empties.map(({ address, rentLamports }) => [
        address,
        rentLamports,
      ]),
    ).toEqual([
      [wsol.address, 456n],
      [empty.address, 123n],
    ]);
    expect(result.bags).toHaveLength(0);
  });
  it("does not close a Token-2022 account with withheld transfer fees", () => {
    const raw = tokenAccount(
      "transfer-fee-account",
      recorded("transfer-fee").address,
      0n,
    );
    const view = parseTokenAccounts([raw]).accounts[0]!;
    const bytes = raw.data;
    let cursor = 166;
    while (cursor + 4 <= bytes.length) {
      const kind = bytes.readUInt16LE(cursor),
        size = bytes.readUInt16LE(cursor + 2);
      if (kind === 2) {
        bytes.writeBigUInt64LE(1n, cursor + 4);
        break;
      }
      cursor += 4 + size;
    }
    expect(parseTokenAccounts([raw]).accounts[0]!.withheldAmount).toBe(1n);
    expect(view.tokenProgram).toBe("token2022");
    expect(classifyWallet(inputFor([raw])).empties).toHaveLength(0);
  });
  it("aggregates accounts, ignores funded wSOL and tests the exact sell boundary", () => {
    const mint = recorded("fartcoin"),
      a = tokenAccount("empty-spl-account", mint.address, 1000n, 20),
      b = tokenAccount("empty-spl-account", mint.address, 1000n, 21);
    const result = classifyWallet(
      inputFor([a, b, tokenAccount("empty-spl-account", WSOL_MINT, 10n, 22)]),
    );
    expect(result.bags).toHaveLength(1);
    expect(result.bags[0]).toMatchObject({
      amountRaw: 2000n,
      valueLamports: 2_000_000n,
      buckets: ["feedable", "sell"],
      reason: "snapshot_at_feed",
    });
    const lower = inputFor([
      tokenAccount("empty-spl-account", mint.address, 1999n),
    ]);
    expect(classifyWallet(lower).bags[0]?.buckets).toEqual(["feedable"]);
    expect(
      nonEmptyMints([
        a,
        b,
        tokenAccount("empty-spl-account", WSOL_MINT, 10n, 22),
      ]),
    ).toEqual([mint.address]);
  });
  it("keeps frozen, stale, non-SOL curve and unsupported amount-extension estimates absent", () => {
    const mint = recorded("fartcoin"),
      frozen = tokenAccount("empty-spl-account", mint.address, 1000000n);
    frozen.data[108] = 2;
    expect(
      classifyWallet(inputFor([frozen])).bags[0]?.valueLamports,
    ).toBeUndefined();
    const stale = inputFor([
      tokenAccount("empty-spl-account", mint.address, 1000000n),
    ]);
    stale.prices[mint.address]!.ageSlots = 54001;
    expect(classifyWallet(stale).bags[0]?.valueLamports).toBeUndefined();
    const t22 = recorded("catcraft"),
      raw = mutable(t22);
    raw.data.writeUInt16LE(25, 166);
    const scaled = inputFor(
      [tokenAccount("immutable-owner-account", t22.address, 1000000n)],
      "catcraft",
    );
    scaled.mints.set(raw.address, raw);
    expect(classifyWallet(scaled).bags[0]?.valueLamports).toBeUndefined();
    raw.data.writeUInt16LE(10, 166);
    expect(classifyWallet(scaled).bags[0]?.valueLamports).toBeUndefined();
    const incomplete = recorded("incomplete"),
      curve = mutable(recorded("incomplete-curve"));
    new PublicKey(recorded("usdc").address).toBuffer().copy(curve.data, 83);
    const nonSol = inputFor(
      [tokenAccount("immutable-owner-account", incomplete.address, 1000000n)],
      "incomplete",
    );
    nonSol.curves.set(incomplete.address, curve);
    expect(classifyWallet(nonSol).bags[0]?.valueLamports).toBeUndefined();
  });
  it("applies exclusion and missing-mint priority before origin and snapshot", () => {
    const mint = recorded("fartcoin"),
      input = inputFor([
        tokenAccount("empty-spl-account", mint.address, 1000n),
      ]);
    input.slotS = 100;
    input.snapshot = new Map([[mint.address, { balanceAtS: 0n }]]);
    expect(classifyWallet(input).bags[0]).toMatchObject({
      buckets: ["not_feedable_season"],
      reason: "snapshot_not_held",
    });
    input.mints.clear();
    expect(classifyWallet(input).bags[0]?.reason).toBe("mint_missing");
    input.excludedMints = new Set([mint.address]);
    expect(classifyWallet(input).bags[0]?.reason).toBe("mint_missing");
    input.mints.set(mint.address, mint);
    expect(classifyWallet(input).bags[0]?.reason).toBe("excluded");
  });
  it("retains every unreadable mint without fabricating decimals or an estimate", () => {
    const mint = recorded("fartcoin");
    for (const [rawMint, reason] of [
      [null, "mint_missing"],
      [{ ...mint, data: new Uint8Array(3) }, "mint_unparseable"],
      [{ ...mint, owner: PROGRAM_IDS.pumpFun }, "unknown_program"],
    ] as const) {
      const input = inputFor([
        tokenAccount("empty-spl-account", mint.address, 123456789n),
      ]);
      input.mints.set(mint.address, rawMint);
      const result = classifyWallet(input);
      expect(result.bags).toHaveLength(1);
      expect(result.bags[0]).toMatchObject({
        mint: mint.address,
        amountRaw: 123456789n,
        decimals: null,
        buckets: ["not_in_set"],
        reason,
      });
      expect(result.bags[0]?.valueLamports).toBeUndefined();
    }
  });
  it("preserves the first safety failure when later mint decoding also fails", () => {
    const mint = recorded("catcraft");
    for (const failure of [
      "decimals",
      "mint_authority",
      "freeze_authority",
    ] as const) {
      const raw = mutable({
        ...mint,
        data: Buffer.concat([mint.data, Buffer.from([1])]),
      });
      if (failure === "decimals") raw.data[44] = 10;
      else {
        const offset = failure === "mint_authority" ? 0 : 46;
        raw.data.writeUInt32LE(1, offset);
        Buffer.alloc(32, 9).copy(raw.data, offset + 4);
      }
      const input = inputFor(
        [tokenAccount("immutable-owner-account", mint.address, 123456789n)],
        "catcraft",
      );
      input.mints.set(mint.address, raw);
      expect(classifyWallet(input).bags[0]).toMatchObject({
        decimals: null,
        buckets: ["not_in_set"],
        reason: failure,
      });
      expect(classifyWallet(input).bags[0]?.valueLamports).toBeUndefined();
    }
  });
  it("never substitutes uncapped curve reserves when the X2 cap is unreadable", () => {
    const mint = recorded("incomplete");
    const input = inputFor(
      [tokenAccount("immutable-owner-account", mint.address, 1000000n)],
      "incomplete",
    );
    input.exitCaps = new Map([[mint.address, null]]);
    expect(classifyWallet(input).bags[0]?.valueLamports).toBeUndefined();
    input.exitCaps = undefined;
    expect(classifyWallet(input).bags[0]?.valueLamports).toBeUndefined();
  });
  it("caps graduated-coin estimates at the supplied fee-adjusted pool cap", () => {
    const mint = recorded("fartcoin");
    const input = inputFor([
      tokenAccount("empty-spl-account", mint.address, 1_000_000_000n),
    ]);
    input.prices[mint.address] = { usdPrice: 1_000_000, ageSlots: 50_000 };
    input.exitCaps = new Map([[mint.address, 1_999_999n]]);
    expect(classifyWallet(input).bags[0]).toMatchObject({
      buckets: ["feedable"],
      valueLamports: 1_999_999n,
    });
  });
  it("uses on-chain sale values without Jupiter and preserves snapshot classification", () => {
    const mint = recorded("fartcoin");
    const input = inputFor([
      tokenAccount("empty-spl-account", mint.address, 1_000_000n),
    ]);
    input.prices = {};
    input.solUsd = 0;
    input.exitCaps = undefined;
    input.reserveValues = new Map([
      [mint.address, { lamports: 2_000_000n, slot: 200 }],
    ]);
    expect(classifyWallet(input).bags[0]).toMatchObject({
      buckets: ["feedable", "sell"],
      valueLamports: 2_000_000n,
      reason: "snapshot_at_feed",
    });
    expect(classifyWallet(input).bags[0]?.priceAgeSlots).toBeUndefined();
    input.slotS = 100;
    input.snapshot = new Map([[mint.address, { balanceAtS: 0n }]]);
    expect(classifyWallet(input).bags[0]).toMatchObject({
      buckets: ["not_feedable_season", "sell"],
      valueLamports: 2_000_000n,
      reason: "snapshot_not_held",
    });
    input.snapshot.set(mint.address, { balanceAtS: 1n });
    expect(classifyWallet(input).bags[0]?.reason).toBeUndefined();
  });
  it("never substitutes Jupiter estimates for absent or invalid reserve values", () => {
    const mint = recorded("fartcoin");
    const input = inputFor([
      tokenAccount("empty-spl-account", mint.address, 1_000_000n),
    ]);
    for (const reserveValues of [
      new Map(),
      new Map([[mint.address, { lamports: -1n, slot: 200 }]]),
      new Map([[mint.address, { lamports: 2_000_000n, slot: NaN }]]),
    ]) {
      input.reserveValues = reserveValues;
      const bag = classifyWallet(input).bags[0]!;
      expect(bag.valueLamports).toBeUndefined();
      expect(bag.priceAgeSlots).toBeUndefined();
      expect(bag.buckets).toEqual(["feedable"]);
      expect(bag.reason).toBe("snapshot_at_feed");
    }
    input.reserveValues = new Map([
      [mint.address, { lamports: 0n, slot: 200 }],
    ]);
    expect(classifyWallet(input).bags[0]?.valueLamports).toBe(0n);
  });
  it("withholds reserve values for unsafe, frozen, missing, excluded and non-origin bags", () => {
    const mint = recorded("fartcoin");
    const base = () => ({
      ...inputFor([
        tokenAccount("empty-spl-account", mint.address, 1_000_000n),
      ]),
      reserveValues: new Map([
        [mint.address, { lamports: 2_000_000n, slot: 200 }],
      ]),
    });
    const unsafe = base();
    const raw = mutable(mint);
    raw.data.writeUInt32LE(1, 46);
    Buffer.alloc(32, 9).copy(raw.data, 50);
    unsafe.mints.set(mint.address, raw);
    const frozen = base();
    frozen.tokenAccounts[0]!.data[108] = 2;
    const missing = base();
    missing.mints.clear();
    const excluded = { ...base(), excludedMints: new Set([mint.address]) };
    const nonOrigin = base();
    nonOrigin.curves.clear();
    for (const input of [unsafe, frozen, missing, excluded, nonOrigin]) {
      const bag = classifyWallet(input).bags[0]!;
      expect(bag.valueLamports).toBeUndefined();
      expect(bag.buckets).not.toContain("sell");
    }
    expect(classifyWallet(unsafe).bags[0]?.reason).toBe("freeze_authority");
    expect(classifyWallet(missing).bags[0]).toMatchObject({
      decimals: null,
      reason: "mint_missing",
    });
    expect(classifyWallet(nonOrigin).bags[0]?.reason).toBe("not_pump_fun");
  });
  it.each([null, 0n, 1n])(
    "preserves bag count and snapshot classification without a value for %s balance at S",
    (balanceAtS) => {
      const mint = recorded("fartcoin");
      const input = inputFor([
        tokenAccount("empty-spl-account", mint.address, 1_000_000n),
      ]);
      input.slotS = 100;
      input.snapshot = new Map([[mint.address, { balanceAtS }]]);
      const valued = classifyWallet({
        ...input,
        reserveValues: new Map([
          [mint.address, { lamports: 2_000_000n, slot: 200 }],
        ]),
      });
      const unvalued = classifyWallet({ ...input, reserveValues: new Map() });
      expect(valued.bags[0]?.buckets).toContain("sell");
      expect(unvalued.bags[0]?.buckets).toEqual(
        valued.bags[0]?.buckets.filter((bucket) => bucket !== "sell"),
      );
      expect(unvalued.bags[0]?.reason).toBe(valued.bags[0]?.reason);
      for (const result of [valued, unvalued])
        expect(
          result.bags.filter((bag) => !bag.buckets.includes("not_in_set")),
        ).toHaveLength(1);
    },
  );
  it.each(["legacy", "reserves"])(
    "never values an out-of-set bag in %s mode",
    (mode) => {
      const mint = recorded("fartcoin");
      const input = inputFor([
        tokenAccount("empty-spl-account", mint.address, 1_000_000n),
      ]);
      input.curves.clear();
      if (mode === "reserves")
        input.reserveValues = new Map([
          [mint.address, { lamports: 2_000_000n, slot: 200 }],
        ]);
      const bag = classifyWallet(input).bags[0]!;
      expect(bag.buckets).toEqual(["not_in_set"]);
      expect(bag.reason).toBe("not_pump_fun");
      expect(bag.valueLamports).toBeUndefined();
    },
  );
  it.each([
    "safe",
    "missing",
    "unreadable",
    "decimals",
    "mint_authority",
    "freeze_authority",
  ] as const)(
    "preserves classification and D8 with per-scan parsed inputs for %s mints",
    (kind) => {
      const mint = recorded("catcraft");
      const input = inputFor(
        [tokenAccount("immutable-owner-account", mint.address, 1_000_000n)],
        "catcraft",
      );
      const raw = mutable(mint);
      if (kind === "unreadable") raw.data = Buffer.from([1, 2]);
      else if (kind !== "safe" && kind !== "missing") {
        // The precise early safety failure must survive a later TLV decode failure.
        raw.data = Buffer.concat([raw.data, Buffer.from([1])]);
        if (kind === "decimals") raw.data[44] = 10;
        else {
          const offset = kind === "mint_authority" ? 0 : 46;
          raw.data.writeUInt32LE(1, offset);
          Buffer.alloc(32, 9).copy(raw.data, offset + 4);
        }
      }
      input.mints.set(mint.address, kind === "missing" ? null : raw);
      const expected = classifyWallet(input);
      const result = classifyWallet({
        ...input,
        parsedTokenAccounts: parseTokenAccounts(input.tokenAccounts),
        mintSafety: new Map([[raw, mintIsSafe(raw)]]),
      });
      expect(result).toEqual(expected);
      if (kind !== "safe") {
        expect(result.bags[0]).toMatchObject({
          decimals: null,
          buckets: ["not_in_set"],
          reason:
            kind === "missing"
              ? "mint_missing"
              : kind === "unreadable"
                ? "mint_unparseable"
                : kind,
        });
        expect(result.bags[0]?.valueLamports).toBeUndefined();
      }
    },
  );
  it("rechecks a replacement raw mint instead of reusing an earlier object check", () => {
    const mint = recorded("fartcoin");
    const input = inputFor([
      tokenAccount("empty-spl-account", mint.address, 1_000_000n),
    ]);
    input.parsedTokenAccounts = parseTokenAccounts(input.tokenAccounts);
    input.mints.set(mint.address, mint);
    input.mintSafety = new Map([[mint, mintIsSafe(mint)]]);
    input.reserveValues = new Map([
      [mint.address, { lamports: 2_000_000n, slot: 200 }],
    ]);
    const replacement = mutable(mint);
    replacement.data.writeUInt32LE(1, 46);
    Buffer.alloc(32, 9).copy(replacement.data, 50);
    input.mints.set(mint.address, replacement);
    expect(classifyWallet(input).bags[0]).toMatchObject({
      decimals: 6,
      reason: "freeze_authority",
      buckets: ["not_in_set"],
    });
    expect(classifyWallet(input).bags[0]?.valueLamports).toBeUndefined();
  });
});
