import { describe, expect, it } from "vitest";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { readBlock0, readCreatorFees } from "./season.js";
import { publicKey, signature } from "../__fixtures__/responses.js";

function snapshot(results: unknown[][]) {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, ...(values ? { values } : {}) });
      return { rows: sql.startsWith("SELECT") ? (results.shift() ?? []) : [] };
    },
    release: () => {},
  };
  return {
    calls,
    pool: { connect: async () => client } as unknown as ServiceRuntime["pool"],
  };
}
describe("season public snapshots", () => {
  it("keeps an incomplete block-0 private and exposes snapshot freshness", async () => {
    const test = snapshot([
      [{ slot: "81" }],
      [
        {
          signature,
          slot: "10",
          mint: publicKey,
          launchPool: publicKey,
          devBuyTokens: "123",
          status: "pending",
          asOfSlot: "10",
        },
      ],
    ]);
    expect(await readBlock0(test.pool)).toEqual({
      status: "pending",
      asOfSlot: 81,
    });
    expect(test.calls.some(({ sql }) => sql.includes("FROM block0_buys"))).toBe(
      false,
    );
  });
  it("returns completed buys losslessly with unknown spending left null", async () => {
    const test = snapshot([
      [{ slot: "81" }],
      [
        {
          signature,
          slot: "10",
          mint: publicKey,
          launchPool: publicKey,
          devBuyTokens: "18446744073709551615",
          status: "ready",
          asOfSlot: "63",
        },
      ],
      [
        {
          signature,
          owner: publicKey,
          slot: "11",
          tokens: "18446744073709551615",
          lamportsSpent: null,
          team: false,
          role: null,
        },
      ],
    ]);
    const result = await readBlock0(test.pool);
    expect(result).toMatchObject({
      status: "ready",
      asOfSlot: 63,
      buys: [{ lamportsSpent: null, tokens: "18446744073709551615" }],
    });
    expect(
      test.calls.find(({ sql }) => sql.includes("FROM block0_buys"))?.values,
    ).toEqual([signature]);
    expect(test.calls.at(-1)?.sql).toBe("COMMIT");
  });
  it("reads confirmed fees in canonical order and bounds history", async () => {
    const test = snapshot([
      [{ slot: "81" }],
      [
        {
          signature,
          ts: "1700000000",
          regime: "season",
          amount: "5",
          toStock: "3",
          toTeam: "2",
          toBurn: "0",
        },
      ],
    ]);
    expect(await readCreatorFees(test.pool, 10)).toMatchObject({
      asOfSlot: 81,
      items: [{ toStock: "3", toBurn: "0" }],
    });
    expect(test.calls[2]?.sql).toContain(
      "c.slot DESC, c.tx_index DESC, c.ix_index DESC, c.event_index DESC",
    );
    expect(test.calls[2]?.values).toEqual([10]);
    expect(() => readCreatorFees(test.pool, 101)).toThrow("invalid_limit");
  });
});
