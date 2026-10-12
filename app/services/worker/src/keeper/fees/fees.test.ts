import { createDeploymentSelector } from "@onepercent/sdk";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { Keypair, TransactionInstruction } from "@solana/web3.js";
import { serviceParams } from "@onepercent/service-kit";
import type { ServiceRuntime } from "@onepercent/service-kit";
import {
  createFeeKeeper,
  feeDelay,
  feeSilenceSeverity,
  type FeeKeeperParams,
} from "./index.js";
import type { FeeChainReader, FeeSnapshot } from "./chain.js";
import type { KeeperStore } from "../store.js";
import { intentSchema, jobId, type KeeperIntent } from "../jobs.js";
const params: FeeKeeperParams = {
  KEEPER_POLICY: {
    creatorFeeCollectSecondsMin: 120,
    creatorFeeCollectSecondsMax: 300,
    creatorFeeFinalCollectLeadSeconds: 60,
  },
  MONITOR: { feeInSilenceAlertSeconds: 600 },
};
function setup() {
  const snapshot = {
    season: "100",
    phase: 3,
    onAirTs: 1000n,
    endTs: 2000n,
    migrated: false,
    migrationDue: false,
    surplusClaimed: false,
    waiting: true,
    baseFees: 0n,
    reserveFingerprint: "curve:1:2",
    input: {
      deployment: createDeploymentSelector({
        localnet: new PublicKey(new Uint8Array(32).fill(41)),
      })("localnet"),
    },
  } as FeeSnapshot;
  const plan = [
    new TransactionInstruction({
      keys: [],
      data: Buffer.alloc(0),
      programId: Keypair.generate().publicKey,
    }),
  ];
  const reader = {
    read: vi.fn(async () => snapshot),
    collection: vi.fn(() => plan),
    migration: vi.fn(() => plan),
  };
  const jobs = new Map<string, unknown>();
  const store = {
    ensure: vi.fn(async (intent: KeeperIntent) => {
      jobs.set(jobId(intent), intent);
      return {};
    }),
  };
  let latest: { window: string; unresolved: boolean } | undefined;
  const runtime = {
    env: { PROGRAM_ID: "fixture" },
    logger: { warn: vi.fn() },
    alerts: { alert: vi.fn() },
    redis: {
      get: vi.fn(async (): Promise<string | null> => null),
      set: vi.fn(),
    },
    pool: {
      query: vi.fn(async (sql: string) => ({
        rows: sql.includes("max(ts)") ? [{ ts: null }] : latest ? [latest] : [],
      })),
    },
  };
  const make = () =>
    createFeeKeeper({
      reader: reader as unknown as FeeChainReader,
      store: store as unknown as KeeperStore,
      runtime: runtime as unknown as ServiceRuntime,
      params,
      assertActive: vi.fn(),
    });
  return {
    snapshot,
    reader,
    store,
    runtime,
    make,
    jobs,
    latest: (value: typeof latest) => {
      latest = value;
    },
    signal: new AbortController().signal,
    plan,
  };
}
describe("launch fee keeper", () => {
  it("makes the last-minute collection a durable season identity across restarts", async () => {
    const f = setup();
    await f.make().discover(1940n, f.signal);
    await f.make().discover(1970n, f.signal);
    expect([...f.jobs.keys()]).toEqual(["fee-chain:100:last-minute:2000"]);
    expect(f.store.ensure).toHaveBeenCalledTimes(2);
    expect(
      await f
        .make()
        .instructions(
          intentSchema.parse([...f.jobs.values()][0]),
          2000n,
          f.signal,
        ),
    ).toBeNull();
  });
  it("collects immediately in BuysClosed and does not duplicate an unresolved send", async () => {
    const f = setup();
    f.snapshot.phase = 4;
    f.latest({ window: "2000", unresolved: true });
    await f.make().discover(2000n, f.signal);
    expect([...f.jobs.keys()]).toEqual(["fee-chain:100:buys-closed:2000"]);
  });
  it("runs the migration backup from live completion state and reconciles its chain flag", async () => {
    const f = setup();
    f.snapshot.migrationDue = true;
    await f.make().discover(1100n, f.signal);
    const intent = { kind: "launch-migration" as const, season: "100" };
    expect(f.jobs.has(jobId(intent))).toBe(true);
    expect(await f.make().instructions(intent, 1100n, f.signal)).toBe(f.plan);
    expect(await f.make().complete(intent, "finalized", f.signal)).toBe(false);
    f.snapshot.migrated = true;
    expect(await f.make().complete(intent, "finalized", f.signal)).toBe(true);
  });
  it("does not let a newer special collection hide an unresolved earlier signature", async () => {
    const f = setup();
    f.latest({ window: "1000", unresolved: true });
    await f.make().discover(1400n, f.signal);
    expect(f.store.ensure).not.toHaveBeenCalled();
    expect(f.runtime.pool.query).toHaveBeenCalledWith(
      expect.stringContaining("bool_or"),
      ["100", serviceParams.keeper.sendMaxAttempts],
    );
    f.latest({ window: "1000", unresolved: false });
    await f.make().discover(1400n, f.signal);
    expect([...f.jobs.keys()]).toEqual(["fee-chain:100:periodic:1400"]);
  });
  it("starts its cadence from durable completion and recovers a malformed observation", async () => {
    const f = setup();
    f.runtime.redis.get.mockResolvedValue("invalid-json");
    f.latest({ window: "1300", unresolved: false });
    await f.make().discover(1301n, f.signal);
    expect(f.store.ensure).not.toHaveBeenCalled();
    expect(f.runtime.redis.set).toHaveBeenCalled();
    expect(f.runtime.logger.warn).toHaveBeenCalledExactlyOnceWith(
      {
        reason: "fee_observation_invalid",
        cause: {
          code: "SyntaxError",
          detail: "Unexpected token <redacted> in JSON",
        },
      },
      "fee observation invalid",
    );
  });
  it("keeps the OnAir collection before advance even when nothing is waiting", async () => {
    const f = setup();
    f.snapshot.phase = 2;
    f.snapshot.waiting = false;
    expect(
      await f
        .make()
        .instructions({ kind: "advance", from: 2, to: 3 }, 1000n, f.signal),
    ).toBe(f.plan);
    expect(f.reader.collection).toHaveBeenCalledWith(f.snapshot, true);
    expect(
      await f.make().instructions(
        {
          kind: "fee-chain",
          season: "100",
          reason: "last-minute",
          window: "2000",
        },
        1990n,
        f.signal,
      ),
    ).toBeNull();
  });
  it("requires journal signature proof rather than a zero balance for a fee collection", async () => {
    const f = setup();
    f.snapshot.waiting = false;
    expect(
      await f.make().complete(
        {
          kind: "fee-chain",
          season: "100",
          reason: "periodic",
          window: "1000",
        },
        "finalized",
        f.signal,
      ),
    ).toBe(false);
  });
  it("defers a fresh periodic collection at end_ts until BuysClosed has advanced", async () => {
    const f = setup();
    const intent = {
      kind: "fee-chain" as const,
      season: "100",
      reason: "periodic" as const,
      window: "1900",
    };
    expect(await f.make().instructions(intent, 2000n, f.signal)).toBeNull();
    expect(f.reader.collection).not.toHaveBeenCalled();
    f.snapshot.phase = 4;
    expect(await f.make().instructions(intent, 2000n, f.signal)).toBe(f.plan);
  });
  it("keeps stable intervals between 120 and 300 seconds", () => {
    const values = Array.from({ length: 200 }, (_, index) =>
      feeDelay("100", String(index), params),
    );
    expect(values.every((value) => value >= 120n && value <= 300n)).toBe(true);
    expect(new Set(values).size).toBeGreaterThan(20);
    expect(feeDelay("100", "200", params)).toBe(feeDelay("100", "200", params));
  });
  it("only alerts on silence with recent reserve activity and escalates after twice the window", () => {
    expect(feeSilenceSeverity(1000n, 500n, 1000n, 600)).toBeNull();
    expect(feeSilenceSeverity(1200n, 500n, 1100n, 600)).toBe("warning");
    expect(feeSilenceSeverity(1800n, 500n, 1800n, 600)).toBe("critical");
    expect(feeSilenceSeverity(1800n, 500n, 1100n, 600)).toBeNull();
  });
});
