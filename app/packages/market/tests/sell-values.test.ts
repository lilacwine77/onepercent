import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { createExitCapClient, type ChainRpc } from "../src/chain/exit-cap.js";
import {
  decodeBondingCurve,
  decodePumpPool,
  deriveBondingCurve,
  deriveCanonicalPool,
} from "../src/chain/pump-layouts.js";
import * as pumpLayouts from "../src/chain/pump-layouts.js";
import {
  createSellValuesReader,
  curveSellValue,
  poolSellValue,
  type ReserveAccount,
} from "../src/chain/sell-values.js";
import { PROGRAM_IDS, PUMP_LAYOUTS, WSOL_MINT } from "../src/params.js";

interface RpcAccount {
  owner: string;
  data: [string, "base64"];
}
interface Recording {
  request: { body: { params: [string[]] } };
  response: {
    body: { result: { context: { slot: number }; value: RpcAccount[] } };
  };
}
const fees = JSON.parse(
  readFileSync(
    new URL("./fixtures/rpc/sell-fee-configs.json", import.meta.url),
    "utf8",
  ),
) as Recording;
const key = (number: number) => {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(number);
  return new PublicKey(bytes).toBase58();
};
const encoded = (owner: string, data: Buffer): RpcAccount => ({
  owner,
  data: [data.toString("base64"), "base64"],
});
const curveBytes = (complete = false) => {
  const data = Buffer.alloc(81);
  Buffer.from(PUMP_LAYOUTS.bondingCurveDiscriminatorHex, "hex").copy(data);
  data.writeBigUInt64LE(1_000n, 8);
  data.writeBigUInt64LE(10_000n, 16);
  data.writeBigUInt64LE(10_000n, 32);
  data[48] = Number(complete);
  return data;
};
const vault = (mint: string, owner: string, amount: bigint) => {
  const data = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(data);
  new PublicKey(owner).toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return encoded(PROGRAM_IDS.splToken, data);
};
function harness(options: { failBatch?: number } = {}) {
  const accounts = new Map<string, RpcAccount>();
  for (const [index, address] of fees.request.body.params[0].entries())
    accounts.set(address, fees.response.body.result.value[index]!);
  const calls: string[][] = [];
  let active = 0;
  let maximumActive = 0;
  const rpc: ChainRpc = {
    async call<T>(schema: z.ZodType<T>, method: string, params: unknown[]) {
      expect(method).toBe("getMultipleAccounts");
      const addresses = params[0] as string[];
      const index = calls.length;
      calls.push(addresses);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      if (index === options.failBatch) throw new Error("RPC unavailable");
      return schema.parse({
        context: { slot: 400 },
        value: addresses.map((address) => accounts.get(address) ?? null),
      });
    },
  };
  return {
    accounts,
    calls,
    rpc,
    maximumActive: () => maximumActive,
    read: createSellValuesReader(rpc),
  };
}
function addPool(accounts: Map<string, RpcAccount>, mint: string) {
  const address = deriveCanonicalPool(mint);
  const baseVault = key(100_001);
  const quoteVault = key(100_002);
  const data = Buffer.alloc(287);
  Buffer.from(PUMP_LAYOUTS.poolDiscriminatorHex, "hex").copy(data);
  new PublicKey(mint).toBuffer().copy(data, 43);
  new PublicKey(WSOL_MINT).toBuffer().copy(data, 75);
  new PublicKey(baseVault).toBuffer().copy(data, 139);
  new PublicKey(quoteVault).toBuffer().copy(data, 171);
  data.writeBigUInt64LE(1_000n, 245);
  data.writeBigUInt64LE(500n, 271);
  accounts.set(address, encoded(PROGRAM_IDS.pumpSwap, data));
  accounts.set(baseVault, vault(mint, address, 1_000n));
  accounts.set(quoteVault, vault(WSOL_MINT, address, 10_000n));
  return { address, baseVault, quoteVault, data };
}

describe("batched reserve-derived sell values", () => {
  it("values 600 curves with seven bounded RPC batches and no Jupiter", async () => {
    const fixture = harness();
    const holdings = Array.from({ length: 600 }, (_, index) => ({
      mint: key(index + 1),
      amount: 100n,
    }));
    for (const { mint } of holdings)
      fixture.accounts.set(
        deriveBondingCurve(mint),
        encoded(PROGRAM_IDS.pumpFun, curveBytes()),
      );
    const client = createExitCapClient({
      fetch: async () => {
        throw new Error("Unexpected HTTP request");
      },
      env: { pythHermesUrl: "https://pyth.invalid" },
      rpc: fixture.rpc,
    });
    const result = await client.getSellValues(holdings);
    expect(result.partial).toBe(false);
    expect(result.values.size).toBe(600);
    expect([...result.values.values()].every((v) => v.lamports === 896n)).toBe(
      true,
    );
    expect(fixture.calls).toHaveLength(7);
    expect(fixture.calls.every((batch) => batch.length <= 100)).toBe(true);
    expect(fixture.maximumActive()).toBe(4);
    // This test includes cold fixture PDA construction. The API scale test
    // separately enforces the complete scan's wall-clock budget.
  }, 30_000);

  it("reuses preloaded origin accounts and aggregates same-mint holdings before sale math", async () => {
    const fixture = harness();
    const mint = key(1);
    const curves = new Map<string, ReserveAccount>([
      [
        deriveBondingCurve(mint),
        { owner: PROGRAM_IDS.pumpFun, data: curveBytes() },
      ],
    ]);
    const result = await fixture.read(
      [
        { mint, amount: 50n },
        { mint, amount: 50n },
      ],
      { curveAccounts: curves, slot: 350 },
    );
    expect(result.values.get(mint)).toEqual({ lamports: 896n, slot: 350 });
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0]).toHaveLength(2);
  });

  it("reuses verified caller PDA derivations with identical reserve results", async () => {
    const fixture = harness();
    const mint = key(123_456);
    const address = deriveBondingCurve(mint);
    const curveAccounts = new Map([
      [address, { owner: PROGRAM_IDS.pumpFun, data: curveBytes() }],
    ]);
    const holdings = [{ mint, amount: 100n }];
    const expected = await fixture.read(holdings, { curveAccounts, slot: 350 });
    const derive = vi.spyOn(pumpLayouts, "deriveBondingCurve");
    try {
      const actual = await fixture.read(holdings, {
        curveAccounts,
        slot: 350,
        verifiedCurveAddresses: new Map([[mint, address]]),
      });
      expect(actual).toEqual(expected);
      expect(derive).not.toHaveBeenCalled();
      await fixture.read(holdings, {
        verifiedCurveAddresses: new Map([[mint, address]]),
      });
      expect(derive).toHaveBeenCalledWith(mint);
    } finally {
      derive.mockRestore();
    }
  });

  it("uses both canonical pool vaults and signed effective reserves, excluding stored fees", async () => {
    const fixture = harness();
    const mint = key(2);
    fixture.accounts.set(
      deriveBondingCurve(mint),
      encoded(PROGRAM_IDS.pumpFun, curveBytes(true)),
    );
    const pool = addPool(fixture.accounts, mint);
    let result = await fixture.read([{ mint, amount: 100n }]);
    expect(result.values.get(mint)).toEqual({ lamports: 985n, slot: 400 });
    expect(fixture.calls).toHaveLength(3);
    pool.data.writeBigInt64LE(-1_000n, 245);
    pool.data.writeBigInt64LE(-1n, 253);
    fixture.accounts.set(
      pool.address,
      encoded(PROGRAM_IDS.pumpSwap, pool.data),
    );
    result = await fixture.read([{ mint, amount: 100n }]);
    expect(result.values.get(mint)?.lamports).toBe(805n);
    pool.data.writeBigUInt64LE(9_900n, 271);
    fixture.accounts.set(
      pool.address,
      encoded(PROGRAM_IDS.pumpSwap, pool.data),
    );
    result = await fixture.read([{ mint, amount: 100n }]);
    expect(result.values.get(mint)?.reason).toBe("QUOTE_EXCEEDS_REAL_RESERVES");
    expect(result.partial).toBe(false);
  });

  it("keeps successful curves when another RPC batch fails", async () => {
    const fixture = harness({ failBatch: 0 });
    const holdings = Array.from({ length: 101 }, (_, index) => ({
      mint: key(index + 1),
      amount: 100n,
    }));
    for (const { mint } of holdings)
      fixture.accounts.set(
        deriveBondingCurve(mint),
        encoded(PROGRAM_IDS.pumpFun, curveBytes()),
      );
    const result = await fixture.read(holdings);
    expect(result.partial).toBe(true);
    expect(result.values.get(holdings[0]!.mint)?.reason).toBe("UNREAD");
    expect(result.values.get(holdings[100]!.mint)?.lamports).toBe(896n);
  });

  it.each([false, true])(
    "treats read null, malformed or excessive fee schedules as final, complete=%s",
    async (complete) => {
      for (const mode of ["missing", "malformed", "excessive"] as const) {
        const fixture = harness();
        const mint = key(1);
        fixture.accounts.set(
          deriveBondingCurve(mint),
          encoded(PROGRAM_IDS.pumpFun, curveBytes(complete)),
        );
        if (complete) addPool(fixture.accounts, mint);
        const address = fees.request.body.params[0][complete ? 1 : 0]!;
        if (mode === "missing") fixture.accounts.delete(address);
        else {
          const account = fixture.accounts.get(address)!;
          const data = Buffer.from(account.data[0], "base64");
          if (mode === "malformed") data[0] = 0;
          else data.writeBigUInt64LE(126n, 93);
          fixture.accounts.set(address, encoded(account.owner, data));
        }
        const result = await fixture.read([{ mint, amount: 100n }]);
        expect(result.values.get(mint)?.reason).toBe("CAP_UNAVAILABLE");
        expect(result.partial).toBe(false);
      }
    },
  );

  it("treats mismatched vaults and read-null pools as final states", async () => {
    const fixture = harness();
    const mint = key(1);
    fixture.accounts.set(
      deriveBondingCurve(mint),
      encoded(PROGRAM_IDS.pumpFun, curveBytes(true)),
    );
    const absent = await fixture.read([{ mint, amount: 100n }]);
    expect(absent.values.get(mint)?.reason).toBe("NO_ROUTE");
    expect(absent.partial).toBe(false);
    const pool = addPool(fixture.accounts, mint);
    fixture.accounts.set(
      pool.quoteVault,
      vault(key(55), pool.address, 10_000n),
    );
    const mismatched = await fixture.read([{ mint, amount: 100n }]);
    expect(mismatched.values.get(mint)?.reason).toBe("CAP_UNAVAILABLE");
    expect(mismatched.partial).toBe(false);
  });

  it.each([
    ["null", "NO_ROUTE"],
    ["wrong-owner", "NO_ROUTE"],
    ["malformed", "CAP_UNAVAILABLE"],
    ["no-reserves", "NO_REAL_RESERVES"],
    ["over-reserves", "QUOTE_EXCEEDS_REAL_RESERVES"],
    ["non-sol", "NON_SOL_QUOTE"],
    ["custom-fee", "CAP_UNAVAILABLE"],
  ] as const)("keeps the read curve state %s final", async (mode, reason) => {
    const fixture = harness();
    const mint = key(1);
    const data = Buffer.alloc(123);
    curveBytes().copy(data);
    if (mode === "malformed") data[0] = 0;
    if (mode === "no-reserves") data.writeBigUInt64LE(0n, 32);
    if (mode === "over-reserves") data.writeBigUInt64LE(1n, 32);
    if (mode === "non-sol") new PublicKey(key(77)).toBuffer().copy(data, 83);
    if (mode === "custom-fee") data.writeBigUInt64LE(1n, 115);
    if (mode !== "null")
      fixture.accounts.set(
        deriveBondingCurve(mint),
        encoded(
          mode === "wrong-owner" ? PROGRAM_IDS.splToken : PROGRAM_IDS.pumpFun,
          data,
        ),
      );
    const result = await fixture.read([{ mint, amount: 100n }]);
    expect(result.values.get(mint)?.reason).toBe(reason);
    expect(result.values.get(mint)?.lamports).toBeUndefined();
    expect(result.partial).toBe(false);
  });

  it.each([
    ["malformed", "CAP_UNAVAILABLE"],
    ["wrong-index", "CAP_UNAVAILABLE"],
    ["wrong-mint", "CAP_UNAVAILABLE"],
    ["non-sol", "NON_SOL_QUOTE"],
    ["custom-fee", "CAP_UNAVAILABLE"],
    ["null-vault", "CAP_UNAVAILABLE"],
    ["malformed-vault", "CAP_UNAVAILABLE"],
    ["zero-vault", "NO_REAL_RESERVES"],
  ] as const)("keeps the read pool state %s final", async (mode, reason) => {
    const fixture = harness();
    const mint = key(1);
    fixture.accounts.set(
      deriveBondingCurve(mint),
      encoded(PROGRAM_IDS.pumpFun, curveBytes(true)),
    );
    const pool = addPool(fixture.accounts, mint);
    if (mode === "malformed") pool.data[0] = 0;
    if (mode === "wrong-index") pool.data.writeUInt16LE(1, 9);
    if (mode === "wrong-mint")
      new PublicKey(key(77)).toBuffer().copy(pool.data, 43);
    if (mode === "non-sol")
      new PublicKey(key(77)).toBuffer().copy(pool.data, 75);
    if (mode === "custom-fee") pool.data.writeBigUInt64LE(1n, 261);
    fixture.accounts.set(
      pool.address,
      encoded(PROGRAM_IDS.pumpSwap, pool.data),
    );
    if (mode === "null-vault") fixture.accounts.delete(pool.quoteVault);
    if (mode === "malformed-vault")
      fixture.accounts.set(
        pool.quoteVault,
        encoded(PROGRAM_IDS.splToken, Buffer.alloc(1)),
      );
    if (mode === "zero-vault")
      fixture.accounts.set(pool.quoteVault, vault(WSOL_MINT, pool.address, 0n));
    const result = await fixture.read([{ mint, amount: 100n }]);
    expect(result.values.get(mint)?.reason).toBe(reason);
    expect(result.values.get(mint)?.lamports).toBeUndefined();
    expect(result.partial).toBe(false);
  });

  it.each([false, true])(
    "keeps failed fee reads UNREAD for a valueable curve, complete=%s",
    async (complete) => {
      const fixture = harness({ failBatch: 0 });
      const mint = key(1);
      const curveAccounts = new Map([
        [
          deriveBondingCurve(mint),
          { owner: PROGRAM_IDS.pumpFun, data: curveBytes(complete) },
        ],
      ]);
      if (complete) addPool(fixture.accounts, mint);
      const result = await fixture.read([{ mint, amount: 100n }], {
        curveAccounts,
        slot: 350,
      });
      expect(result.values.get(mint)).toEqual({ reason: "UNREAD" });
      expect(result.partial).toBe(true);
    },
  );

  it.each([false, true])(
    "does not make a final state partial when an unused fee read fails, complete=%s",
    async (complete) => {
      const fixture = harness({ failBatch: 0 });
      const mint = key(1);
      const data = curveBytes(complete);
      data.writeBigUInt64LE(0n, 32);
      const curveAccounts = new Map([
        [deriveBondingCurve(mint), { owner: PROGRAM_IDS.pumpFun, data }],
      ]);
      const result = await fixture.read([{ mint, amount: 100n }], {
        curveAccounts,
        slot: 350,
      });
      expect(result.values.get(mint)?.reason).toBe(
        complete ? "NO_ROUTE" : "NO_REAL_RESERVES",
      );
      expect(result.partial).toBe(false);
    },
  );

  it.each([1, 2])(
    "preserves a healthy value when pool or vault batch %s fails",
    async (failBatch) => {
      const fixture = harness({ failBatch });
      const healthyMint = key(1);
      const incompleteMint = key(2);
      fixture.accounts.set(
        deriveBondingCurve(healthyMint),
        encoded(PROGRAM_IDS.pumpFun, curveBytes()),
      );
      fixture.accounts.set(
        deriveBondingCurve(incompleteMint),
        encoded(PROGRAM_IDS.pumpFun, curveBytes(true)),
      );
      addPool(fixture.accounts, incompleteMint);
      const result = await fixture.read([
        { mint: healthyMint, amount: 100n },
        { mint: incompleteMint, amount: 100n },
      ]);
      expect(result.values.get(healthyMint)).toEqual({
        lamports: 896n,
        slot: 400,
      });
      expect(result.values.get(incompleteMint)).toEqual({ reason: "UNREAD" });
      expect(result.partial).toBe(true);
    },
  );

  it("treats invalid holdings as final without making an RPC request", async () => {
    const fixture = harness();
    const result = await fixture.read([
      { mint: "invalid", amount: 100n },
      { mint: key(1), amount: -1n },
    ]);
    expect([...result.values.values()]).toEqual([
      { reason: "CAP_UNAVAILABLE" },
      { reason: "CAP_UNAVAILABLE" },
    ]);
    expect(result.partial).toBe(false);
    expect(fixture.calls).toHaveLength(0);
  });

  it("does not start batches after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const fixture = harness();
    const result = await fixture.read([{ mint: key(1), amount: 100n }], {
      signal: controller.signal,
    });
    expect(result.partial).toBe(true);
    expect(fixture.calls).toHaveLength(0);
  });

  it("lets cancellation interrupt curve derivation before further CPU or RPC work", async () => {
    const fixture = harness();
    const holdings = Array.from({ length: 101 }, (_, index) => ({
      mint: key(index + 1),
      amount: 100n,
    }));
    const controller = new AbortController();
    const derive = vi
      .spyOn(pumpLayouts, "deriveBondingCurve")
      .mockReturnValue(key(999_999));
    const timer = setTimeout(() => controller.abort(), 0);
    try {
      const result = await fixture.read(holdings, {
        signal: controller.signal,
      });
      expect(derive).toHaveBeenCalledTimes(16);
      expect(fixture.calls).toHaveLength(0);
      expect(result.values.size).toBe(101);
      expect(result.partial).toBe(true);
    } finally {
      clearTimeout(timer);
      derive.mockRestore();
    }
  });

  it("lets cancellation interrupt canonical pool derivation and keeps every mint explicit", async () => {
    const fixture = harness();
    const holdings = Array.from({ length: 101 }, (_, index) => ({
      mint: key(index + 1),
      amount: 100n,
    }));
    const curveAccounts = new Map<string, ReserveAccount>();
    const verifiedCurveAddresses = new Map<string, string>();
    for (const [index, { mint }] of holdings.entries()) {
      const address = key(10_000 + index);
      verifiedCurveAddresses.set(mint, address);
      curveAccounts.set(address, {
        owner: PROGRAM_IDS.pumpFun,
        data: curveBytes(true),
      });
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const derive = vi
      .spyOn(pumpLayouts, "deriveCanonicalPool")
      .mockImplementation(() => {
        timer ??= setTimeout(() => controller.abort(), 0);
        return key(999_999);
      });
    try {
      const result = await fixture.read(holdings, {
        curveAccounts,
        verifiedCurveAddresses,
        slot: 350,
        signal: controller.signal,
      });
      expect(derive).toHaveBeenCalledTimes(16);
      expect(fixture.calls).toHaveLength(1);
      expect(fixture.calls[0]).toEqual(fees.request.body.params[0]);
      expect(result.values.size).toBe(101);
      expect(
        [...result.values.values()].every((value) => value.reason === "UNREAD"),
      ).toBe(true);
      expect(result.partial).toBe(true);
    } finally {
      clearTimeout(timer);
      derive.mockRestore();
    }
  });

  it("preserves a completed value when cancellation interrupts later pool reads", async () => {
    const fixture = harness();
    const holdings = Array.from({ length: 18 }, (_, index) => ({
      mint: key(index + 1),
      amount: 100n,
    }));
    const curveAccounts = new Map<string, ReserveAccount>();
    const verifiedCurveAddresses = new Map<string, string>();
    for (const [index, { mint }] of holdings.entries()) {
      const address = key(10_000 + index);
      verifiedCurveAddresses.set(mint, address);
      curveAccounts.set(address, {
        owner: PROGRAM_IDS.pumpFun,
        data: curveBytes(index !== 0),
      });
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const derive = vi
      .spyOn(pumpLayouts, "deriveCanonicalPool")
      .mockImplementation(() => {
        timer ??= setTimeout(() => controller.abort(), 0);
        return key(999_999);
      });
    try {
      const result = await fixture.read(holdings, {
        curveAccounts,
        verifiedCurveAddresses,
        slot: 350,
        signal: controller.signal,
      });
      expect(result.values.get(holdings[0]!.mint)).toEqual({
        lamports: 896n,
        slot: 350,
      });
      expect(result.values.get(holdings[17]!.mint)).toEqual({
        reason: "UNREAD",
      });
      expect(result.partial).toBe(true);
      expect(fixture.calls).toHaveLength(1);
    } finally {
      clearTimeout(timer);
      derive.mockRestore();
    }
  });
});

describe("sell math never substitutes a capped output for an infeasible full sale", () => {
  it("accepts zero-key and wrapped SOL curve quote mints identically", () => {
    const curve = decodeBondingCurve(curveBytes());
    expect(curveSellValue({ ...curve, quoteMint: WSOL_MINT }, 100n)).toEqual(
      curveSellValue(curve, 100n),
    );
    expect(curveSellValue({ ...curve, quoteMint: WSOL_MINT }, 100n)).toEqual({
      lamports: 896n,
    });
  });

  it("rejects missing reserves, non-SOL pairs and custom fees", () => {
    const curve = decodeBondingCurve(curveBytes());
    expect(
      curveSellValue({ ...curve, realQuoteReserves: 1n }, 100n).reason,
    ).toBe("QUOTE_EXCEEDS_REAL_RESERVES");
    expect(
      curveSellValue({ ...curve, realQuoteReserves: 0n }, 100n).reason,
    ).toBe("NO_REAL_RESERVES");
    expect(curveSellValue({ ...curve, quoteMint: key(77) }, 100n).reason).toBe(
      "NON_SOL_QUOTE",
    );
    expect(curveSellValue({ ...curve, creatorFeeBps: 126n }, 100n).reason).toBe(
      "CAP_UNAVAILABLE",
    );
    const pool = decodePumpPool(addPool(new Map(), key(1)).data);
    expect(
      poolSellValue({ ...pool, creatorFeeBps: 126n }, 100n, 1000n, 10000n)
        .reason,
    ).toBe("CAP_UNAVAILABLE");
    expect(
      poolSellValue(
        { ...pool, virtualQuoteReserves: -10_000n },
        100n,
        1000n,
        10000n,
      ).reason,
    ).toBe("NO_REAL_RESERVES");
  });
});
