import { afterEach, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import * as config from "@onepercent/config";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { createMetrics } from "@onepercent/service-kit";
import { createKeeper } from "./index.js";
import { Keeper } from "./keeper.js";
import { KeeperChain } from "./adapter.js";

const stopLogs = vi.hoisted(() => vi.fn());
vi.mock("./logs.js", () => ({ subscribeReveals: () => stopLogs }));
afterEach(() => vi.restoreAllMocks());

it.each(["reject", "return"])(
  "supervises K1 when its extension unexpectedly %ss",
  async (mode) => {
    const guard = { stop: vi.fn() };
    const runtime = {
      role: "keeper",
      env: { CLUSTER: "localnet", PROGRAM_ID: PublicKey.default.toBase58() },
      key: { publicKey: PublicKey.default },
      guard,
      leader: { assertLeader: vi.fn(), stop: vi.fn(async () => undefined) },
      logger: { warn: vi.fn() },
      rpc: {},
      metrics: createMetrics(),
      pool: { query: vi.fn() },
    } as unknown as ServiceRuntime;
    let scanSignal: AbortSignal | undefined;
    let releaseScan: (() => void) | undefined;
    vi.spyOn(Keeper.prototype, "scan").mockImplementation(async (signal) => {
      scanSignal = signal;
      // Hold the drain to prove readiness is invalidated before sibling cleanup.
      await new Promise<void>((resolve) => {
        releaseScan = resolve;
      });
    });
    vi.spyOn(KeeperChain.prototype, "snapshot").mockRejectedValue(
      new Error("rpc_unavailable"),
    );
    const parent = new AbortController();
    const keeper = createKeeper(runtime, config, {
      extensions: [
        async () => {
          if (mode === "reject") throw new Error("stock_cluster_mismatch");
        },
      ],
    });
    const term = keeper.onLeader(parent.signal);
    const rejected = expect(term).rejects.toThrow(
      mode === "reject" ? "stock_cluster_mismatch" : "keeper_extension_stopped",
    );
    await vi.waitFor(() => expect(guard.stop).toHaveBeenCalledOnce());
    expect(scanSignal?.aborted).toBe(true);
    expect(runtime.leader!.stop).toHaveBeenCalledOnce();
    expect(parent.signal.aborted).toBe(false);
    releaseScan!();
    await rejected;
    expect(stopLogs).toHaveBeenCalled();
  },
);
