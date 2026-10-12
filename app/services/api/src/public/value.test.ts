import { expect, it, vi } from "vitest";
import { createProviderFetch } from "./provider.js";
import { createPublicValue } from "./value.js";
import { settings } from "./__fixtures__/settings.js";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { WSOL_MINT } from "@onepercent/config";

it("delegates identity valuation to X2 and preserves exact u64 JSON strings", async () => {
  const request = vi.fn().mockResolvedValue(42);
  const fetcher = vi.fn();
  const runtime = {
    rpc: { request },
    env: { RPC_URL: "http://localhost:8899" },
  } as unknown as Pick<ServiceRuntime, "rpc" | "env">;
  const value = createPublicValue(runtime, {}, fetcher);
  expect(await value(WSOL_MINT, 18446744073709551615n)).toEqual({
    asOfSlot: 42,
    status: "ok",
    lamports: "18446744073709551615",
    capped: false,
    label: "if_sold_now",
  });
  expect(fetcher).not.toHaveBeenCalled();
});
it("bounds provider outages without treating rate admission as an outage", async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(async () => new Response("", { status: 429 }));
  const guarded = createProviderFetch(fetcher, settings.transport);
  for (let i = 0; i <= settings.transport.breakerFailureThreshold; i++)
    expect((await guarded("https://provider.test")).status).toBe(429);
  fetcher.mockRejectedValue(new Error("secret-url"));
  for (let i = 0; i < settings.transport.breakerFailureThreshold; i++)
    await expect(guarded("https://provider.test")).rejects.toThrow(
      "provider_unavailable",
    );
  const count = fetcher.mock.calls.length;
  await expect(guarded("https://provider.test")).rejects.toThrow(
    "provider_unavailable",
  );
  expect(fetcher).toHaveBeenCalledTimes(count);
});
