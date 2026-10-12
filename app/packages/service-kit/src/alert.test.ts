import type { Database } from "@onepercent/db";
import { beforeEach, expect, it, vi } from "vitest";
import { AlertService } from "./alert.js";

const { recordAlert } = vi.hoisted(() => ({ recordAlert: vi.fn() }));
vi.mock("@onepercent/db", () => ({ recordAlert }));
beforeEach(() => recordAlert.mockReset());

it("sanitizes a diagnostic payload before persistence and webhook delivery", async () => {
  recordAlert.mockResolvedValue(true);
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(null, { status: 204 }));
  const service = new AlertService({
    db: {} as Database,
    dedupeSeconds: 600,
    timeoutMs: 100,
    ipSalt: "salt",
    webhookUrl: "https://alerts.example.invalid/path",
    fetch,
  });
  expect(
    await service.alert("role_mismatch", "critical", {
      nested: { authorization: "Bearer sensitive", secretKey: [1, 2] },
      rpc: "https://rpc.example.invalid/path?api-key=credential",
      count: 1n,
    }),
  ).toEqual({ recorded: true, delivered: true });
  const persisted = recordAlert.mock.calls[0]![1];
  expect(persisted.payload).toEqual({
    nested: { authorization: "[redacted]", secretKey: "[redacted]" },
    rpc: "rpc.example.invalid",
    count: "1",
  });
  expect(JSON.stringify(persisted)).not.toContain("credential");
  expect(fetch).toHaveBeenCalledWith(
    "https://alerts.example.invalid/path",
    expect.objectContaining({
      method: "POST",
      redirect: "error",
      body: JSON.stringify({
        key: "role_mismatch",
        severity: "critical",
        payload: persisted.payload,
      }),
    }),
  );
});

it("does not post a suppressed alert and retains the durable record when delivery fails", async () => {
  recordAlert.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValue(new Error("unavailable"));
  const service = new AlertService({
    db: {} as Database,
    dedupeSeconds: 600,
    timeoutMs: 100,
    ipSalt: "salt",
    webhookUrl: "https://alerts.example.invalid/path",
    fetch,
  });
  expect(await service.alert("lag", "warning", {})).toEqual({
    recorded: false,
    delivered: false,
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(await service.alert("lag", "warning", {})).toEqual({
    recorded: true,
    delivered: false,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("records without a webhook and rejects malformed operational identifiers", async () => {
  recordAlert.mockResolvedValue(true);
  const service = new AlertService({
    db: {} as Database,
    dedupeSeconds: 600,
    timeoutMs: 100,
    ipSalt: "salt",
  });
  expect(await service.alert("intake_log_missing", "warning", {})).toEqual({
    recorded: true,
    delivered: false,
  });
  await expect(
    service.alert("https://secret.invalid/key", "critical", {}),
  ).rejects.toThrow();
});
