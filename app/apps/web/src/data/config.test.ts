import "../test/setup";
import { expect, it, vi } from "vitest";
import { loadMachineConfig } from "./config";
import { FeatureFlags } from "@onepercent/sdk/api";
import { ConfigResponse } from "@onepercent/web-api";
import { decodeMachineConfig } from "./machine-config";

it("treats only 404 or the explicit 503 not_configured response as pre-launch", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
    .mockResolvedValueOnce(
      Response.json({ error: "not_configured" }, { status: 503 }),
    )
    .mockResolvedValueOnce(
      Response.json({ error: "unavailable" }, { status: 503 }),
    )
    .mockResolvedValueOnce(
      Response.json({ error: "not_configured" }, { status: 500 }),
    )
    .mockRejectedValueOnce(new TypeError("Network unavailable"));
  await expect(loadMachineConfig()).resolves.toBeNull();
  await expect(loadMachineConfig()).resolves.toBeNull();
  await expect(loadMachineConfig()).rejects.toMatchObject({
    status: 503,
    code: "unavailable",
  });
  await expect(loadMachineConfig()).rejects.toMatchObject({
    status: 500,
    code: "not_configured",
  });
  await expect(loadMachineConfig()).rejects.toBeInstanceOf(TypeError);
});

it("reads S4's nullable pre-launch config and canonical mainnet cluster", async () => {
  const body = {
    asOfSlot: null,
    cluster: "mainnet-beta",
    programId: "11111111111111111111111111111111",
    flags: Object.fromEntries(
      Object.keys(FeatureFlags.shape).map((key) => [key, false]),
    ),
    paramsHash: null,
    phase: null,
    roles: null,
    vrf: null,
    season: null,
    paused: null,
  };
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(body));
  await expect(loadMachineConfig()).resolves.toMatchObject({
    cluster: "mainnet",
    phase: null,
    season: null,
  });
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ ...body, asOfSlot: 1, phase: 1 }),
  );
  await expect(loadMachineConfig()).resolves.toMatchObject({
    asOfSlot: 1,
    phase: "StockUp",
  });
});

it("keeps the earlier typed D19 config fixture readable without accepting invalid bodies", () => {
  const address = "11111111111111111111111111111111";
  const fixture = {
    asOfSlot: "1",
    cluster: "devnet",
    programId: address,
    flags: {},
    paramsHash: "0".repeat(64),
    phase: "OnAir",
    roles: {
      keeper: address,
      executor: address,
      intakeSigner: address,
      quoteSigner: address,
      teamWallet: address,
      teamWallets: [address],
    },
    vrf: { queues: [address], activeIndex: 0 },
    season: {
      snapshotSlot: "0",
      snapshotTs: 0,
      stockUpTs: 0,
      powerOnTs: 0,
      onAirTs: 0,
      endTs: 0,
      finalTs: 0,
    },
    paused: 0,
  };
  expect(decodeMachineConfig(fixture)).toEqual(ConfigResponse.parse(fixture));
  expect(() =>
    decodeMachineConfig({ ...fixture, programId: "invalid" }),
  ).toThrow("invalid_response");
});
