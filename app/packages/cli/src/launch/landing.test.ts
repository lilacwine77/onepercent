import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createLandingClient,
  landingRpc,
  LANDING_ENDPOINTS,
} from "@onepercent/service-kit/landing";
import {
  launchPriorityPrice,
  loadLandingClient,
  readLaunchPolicy,
} from "./landing.js";

const policy = {
  landing: {
    cuMarginBps: 2000,
    tipLamports: 1000000n,
    maxComputeUnitPriceMicroLamports: 10n,
  },
  keeper: { sendMaxAttempts: 3, backoffBaseMs: 200 },
};
const response = (result: unknown) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
  });
describe("launch landing policy and typed transports", () => {
  it("loads the workspace landing export without submitting a transaction", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response("1".repeat(64)));
    vi.stubGlobal("fetch", transport);
    try {
      const client = await loadLandingClient();
      expect(transport).not.toHaveBeenCalled();
      expect(Object.keys(client)).toEqual(["sendSingle"]);
      await expect(client.sendSingle("transaction")).resolves.toBe(
        "1".repeat(64),
      );
      expect(transport.mock.calls[0]![0]).toBe(LANDING_ENDPOINTS.sender);
      expect(
        JSON.parse(transport.mock.calls[0]![1]!.body as string).method,
      ).toBe("sendTransaction");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("never synthesizes missing policies, and rejects unsafe numbers", () => {
    expect(readLaunchPolicy({})).toBeNull();
    expect(
      readLaunchPolicy({
        ...policy,
        landing: { ...policy.landing, tipLamports: 0n },
      }),
    ).toBeNull();
    expect(
      readLaunchPolicy({
        ...policy,
        keeper: { ...policy.keeper, sendMaxAttempts: 0 },
      }),
    ).toBeNull();
    expect(readLaunchPolicy(policy)).toEqual(policy);
    expect(
      readLaunchPolicy({
        ...policy,
        landing: {
          ...policy.landing,
          tipLamports: Number.MAX_SAFE_INTEGER + 1,
        },
      }),
    ).toBeNull();
  });
  it("uses the capped 75th percentile and never turns missing samples into a made-up fee", () => {
    expect(
      launchPriorityPrice(
        [
          { prioritizationFee: 9 },
          { prioritizationFee: 2 },
          { prioritizationFee: 4 },
          { prioritizationFee: 3 },
        ],
        10n,
      ),
    ).toBe(4n);
    expect(launchPriorityPrice([{ prioritizationFee: 100 }], 10n)).toBe(10n);
    expect(launchPriorityPrice([], 10n)).toBe(0n);
    expect(() =>
      launchPriorityPrice([{ prioritizationFee: -1 }], 10n),
    ).toThrow();
  });
  it("sends one transaction through Sender and validates the signature", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response("1".repeat(64)));
    const client = createLandingClient(transport);
    await expect(client.sendSingle("transaction")).resolves.toBe(
      "1".repeat(64),
    );
    const [endpoint, init] = transport.mock.calls[0]!;
    expect(endpoint).toBe(LANDING_ENDPOINTS.sender);
    expect(JSON.parse(init!.body as string)).toMatchObject({
      method: "sendTransaction",
      params: [
        "transaction",
        { encoding: "base64", skipPreflight: true, maxRetries: 0 },
      ],
    });
    transport.mockResolvedValue(response("invalid signature"));
    await expect(client.sendSingle("transaction")).rejects.toThrow(
      "landing_rpc_failed",
    );
  });
  it("redacts provider errors and rejects malformed JSON-RPC responses", async () => {
    for (const transport of [
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error("https://rpc.example.test?token=hidden")),
      vi.fn<typeof fetch>().mockResolvedValue(new Response("invalid json")),
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { message: "sensitive" } })),
        ),
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("failure", { status: 503 })),
    ])
      await expect(
        landingRpc(
          "https://rpc.example.test",
          "read",
          [],
          z.string(),
          transport,
        ),
      ).rejects.toThrow(/^landing_rpc_failed$/);
  });
});
