import { describe, expect, it, vi } from "vitest";
import { TOKEN_1PCT } from "@onepercent/config";
import {
  configLayout,
  machineLayout,
  deckHeaderLayout,
  ONE_PCT_STATE,
} from "@onepercent/sdk";
import { FeatureFlags } from "@onepercent/sdk/api";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { PublicKey } from "@solana/web3.js";
import { createPublicData } from "./index.js";
import { flags, publicKey, otherKey } from "../__fixtures__/responses.js";

vi.mock("./mirror.js", async (original) => ({
  ...(await original<typeof import("./mirror.js")>()),
  readEditionMix: async () => [0, 0, 0, 0],
}));

describe("public machine season fields", () => {
  it("uses the chain clock for releases and burn-hour rotation without rewriting stored counters", async () => {
    const onAir = 3_600n;
    let now = onAir - 1n;
    let machine = machineLayout.encode({
      version: 1,
      phase: 2,
      token_mint: new PublicKey(otherKey),
      on_air_ts: onAir,
      burn_sol: 55n,
      burned_total: 123n,
      last_burn_ts: 20n,
      burn_hour_index: 0n,
      burn_paid_hour: 11n,
      onepct: Array.from({ length: 4 }, () => ({
        state: ONE_PCT_STATE.locked,
        amount: TOKEN_1PCT.onePctCardAmount,
      })),
    });
    const envelope = (data: Uint8Array) => ({
      owner: publicKey,
      executable: false,
      data: [Buffer.from(data).toString("base64"), "base64"],
    });
    const runtime = {
      env: { PROGRAM_ID: publicKey },
      pool: {},
      rpc: {
        chainNow: async () => now,
        request: async (method: string) => ({
          context: { slot: 99 },
          value:
            method === "getMultipleAccounts"
              ? [
                  envelope(configLayout.encode({ version: 1 })),
                  envelope(machine),
                ]
              : envelope(
                  deckHeaderLayout.encode({ version: 1, len: 0, cap: 0 }),
                ),
        }),
      },
    } as unknown as ServiceRuntime;
    const reader = createPublicData({
      runtime,
      flags: FeatureFlags.parse(flags),
    });
    const before = await reader.machine();
    expect(before).toMatchObject({
      tokenMint: otherKey,
      onePctLiveIndex: null,
      finalPull: null,
      burn: {
        burnSol: "55",
        burnedTotal: "123",
        lastBurnTs: 20,
        burnPaidHour: "11",
      },
    });
    expect(before.onePct[0]?.releaseTs).toBe(Number(onAir));
    now = onAir;
    const released = await reader.machine();
    expect(released.onePctLiveIndex).toBe(0);
    expect(released.burn?.burnPaidHour).toBe("0");
    expect(machineLayout.decode(machine).burn_paid_hour).toBe(11n);
    machine = machineLayout.encode({ version: 1 });
    const unlaunched = await reader.machine();
    expect(unlaunched.tokenMint).toBeNull();
    expect(
      unlaunched.onePct.every((card) => card.releaseTs === undefined),
    ).toBe(true);
  });
});
