import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ChainRpc } from "../src/chain/exit-cap.js";
import { evaluateMajor } from "../src/listing/evaluate.js";
import { PROGRAM_IDS, STOCK } from "../src/params.js";
import {
  createPythPushClient,
  decodePythPushPrice,
  derivePythPushAccount,
} from "../src/pyth/push.js";

interface Capture {
  feedId: string;
  address: string;
  response: {
    result: {
      context: { slot: number };
      value: { owner: string; data: [string, "base64"] } | null;
    };
  };
}
function fixture(name: string): Capture {
  return JSON.parse(
    readFileSync(
      new URL(`../../../fixtures/mainnet/pyth/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as Capture;
}
function account(record: Capture) {
  return {
    owner: record.response.result.value!.owner,
    data: Buffer.from(record.response.result.value!.data[0], "base64"),
  };
}
function harness(record: Capture) {
  const calls: { method: string; params: unknown[] }[] = [];
  const rpc: ChainRpc = {
    async call(schema, method, params) {
      calls.push({ method, params });
      return schema.parse(record.response.result);
    },
  };
  return { client: createPythPushClient({ rpc }), calls };
}

describe("Pyth sponsored Full PriceUpdateV2 feeds", () => {
  it.each([
    ["sol-usd", "10947583462", "3153335", -8, 1791543222],
    ["wif-usd", "21025749", "5828", -8, 1791543195],
    ["bonk-usd", "33190", "33", -10, 1791543195],
    ["popcat-usd", "4681263", "3237", -8, 1791543153],
    ["fartcoin-usd", "16299830", "6328", -8, 1791543736],
    ["pnut-usd", "4943355", "3996", -8, 1791414145],
  ] as const)(
    "derives and decodes the captured %s push feed",
    (name, price, conf, expo, publishTime) => {
      const record = fixture(name);
      expect(derivePythPushAccount(record.feedId)).toBe(record.address);
      expect(decodePythPushPrice(account(record), record.feedId)).toEqual({
        id: record.feedId,
        price: { price, conf, expo, publish_time: publishTime },
      });
    },
  );

  it("reads the sponsored account through the supplied RPC and preserves its slot", async () => {
    const record = fixture("wif-usd");
    const { client, calls } = harness(record);
    const [first, second] = await Promise.all([
      client.getLatest(`0x${record.feedId.toUpperCase()}`),
      client.getLatest(record.feedId),
    ]);
    expect(first).toEqual({
      ...decodePythPushPrice(account(record), record.feedId),
      metadata: { slot: record.response.result.context.slot },
    });
    expect(second).toEqual(first);
    expect(calls).toEqual([
      {
        method: "getAccountInfo",
        params: [
          record.address,
          { encoding: "base64", commitment: "confirmed" },
        ],
      },
    ]);
    await client.getLatest(record.feedId);
    expect(calls).toHaveLength(2);
  });

  it("does not substitute a price for an absent account", async () => {
    const record = fixture("wif-usd");
    record.response.result.value = null;
    await expect(harness(record).client.getLatest(record.feedId)).resolves.toBe(
      undefined,
    );
  });

  it.each(["", "12", "0x", "g".repeat(64), "1".repeat(63), "1".repeat(65)])(
    "refuses malformed feed id %s before making an RPC call",
    async (input) => {
      const { client, calls } = harness(fixture("wif-usd"));
      await expect(client.getLatest(input)).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
      expect(calls).toHaveLength(0);
    },
  );

  it.each<[string, (a: ReturnType<typeof account>) => void]>([
    [
      "wrong owner",
      (a: ReturnType<typeof account>) => (a.owner = PROGRAM_IDS.pythPushOracle),
    ],
    ["wrong discriminator", (a: ReturnType<typeof account>) => (a.data[0] = 0)],
    ["wrong feed", (a: ReturnType<typeof account>) => (a.data[41] = 0)],
    [
      "partial verification",
      (a: ReturnType<typeof account>) => (a.data[40] = 0),
    ],
    [
      "unknown verification",
      (a: ReturnType<typeof account>) => (a.data[40] = 2),
    ],
    [
      "short account",
      (a: ReturnType<typeof account>) => (a.data = a.data.subarray(0, 132)),
    ],
    [
      "zero price",
      (a: ReturnType<typeof account>) => a.data.writeBigInt64LE(0n, 73),
    ],
    [
      "negative price",
      (a: ReturnType<typeof account>) => a.data.writeBigInt64LE(-1n, 73),
    ],
    [
      "small exponent",
      (a: ReturnType<typeof account>) => a.data.writeInt32LE(-19, 89),
    ],
    [
      "positive exponent",
      (a: ReturnType<typeof account>) => a.data.writeInt32LE(1, 89),
    ],
    [
      "negative time",
      (a: ReturnType<typeof account>) => a.data.writeBigInt64LE(-1n, 93),
    ],
    [
      "unsafe time",
      (a: ReturnType<typeof account>) =>
        a.data.writeBigInt64LE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 93),
    ],
  ])("refuses %s", (_name, mutate) => {
    const record = fixture("wif-usd");
    const value = account(record);
    mutate(value);
    expect(() => decodePythPushPrice(value, record.feedId)).toThrowError(
      expect.objectContaining({ code: "PROVIDER_SCHEMA" }),
    );
  });

  it("fails the freshness criterion once a decoded feed is older than 60 seconds", () => {
    const record = fixture("wif-usd");
    const update = decodePythPushPrice(account(record), record.feedId);
    const evidence = {
      mint: record.address,
      symbol: "WIF",
      mintSafe: true,
      pyth: update.price,
      firstPoolCreatedAtMs: null,
      externalDepthUsd: null,
      sellRecoveryBps: null,
      dailySigmaBps: null,
      capLamports: null,
      excludedHolders: null,
      jupiterTopHoldersPercentage: null,
    };
    const boundary =
      (update.price.publish_time + STOCK.pythMaxAgeSeconds) * 1_000;
    expect(
      evaluateMajor(evidence, boundary).criteria.find(
        (c) => c.id === "pyth_fresh",
      ),
    ).toMatchObject({ pass: true, observed: STOCK.pythMaxAgeSeconds });
    expect(
      evaluateMajor(evidence, boundary + 1_000).criteria.find(
        (c) => c.id === "pyth_fresh",
      ),
    ).toMatchObject({ pass: false, observed: STOCK.pythMaxAgeSeconds + 1 });
  });
});
