import { expect, it, vi } from "vitest";
import { Registry } from "prom-client";
import { z } from "zod";
import { JsonRpcClient } from "../src/rpc.js";
import { createHealthApp } from "../src/health.js";
import { createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { decodeConfigRoles, RoleGuard } from "../src/keys.js";
function rpcWith(result: unknown) {
  return new JsonRpcClient({
    url: "http://localhost:8899/secret?api-key=secret",
    timeoutMs: 100,
    failureThreshold: 2,
    recoverMs: 1000,
    fetch: vi.fn(async (_url, init) => {
      const { id } = JSON.parse(init!.body as string);
      return Response.json({ jsonrpc: "2.0", id, result });
    }),
  });
}
it("chain time comes from confirmed Clock and preserves i64", async () => {
  const bytes = Buffer.alloc(40);
  bytes.writeBigInt64LE(123456789n, 32);
  const rpc = rpcWith({
    context: { slot: 123 },
    value: {
      owner: "Sysvar1111111111111111111111111111111111111",
      executable: false,
      data: [bytes.toString("base64"), "base64"],
    },
  });
  expect(await rpc.chainNow()).toBe(123456789n);
});
it("RPC validates envelopes and redacts errors", async () => {
  await expect(
    rpcWith("bad").request("getSlot", [], z.number()),
  ).rejects.toThrow("rpc_unavailable");
  await expect(rpcWith(null).blockTimeNow()).rejects.toThrow("rpc_unavailable");
});
it("circuit breaker suppresses repeated provider calls", async () => {
  const fetcher = vi.fn(async () => {
    throw new Error("api-key=secret");
  });
  const rpc = new JsonRpcClient({
    url: "http://localhost:8899",
    timeoutMs: 100,
    failureThreshold: 2,
    recoverMs: 1000,
    fetch: fetcher,
  });
  for (let i = 0; i < 3; i++)
    await expect(rpc.ready()).rejects.toThrow("rpc_unavailable");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("liveness, readiness dependencies and metrics", async () => {
  const app = createHealthApp({
    version: "test",
    commit: "test",
    registry: new Registry(),
    timeoutMs: 25,
    checks: {
      db: async () => {},
      redis: async () => {
        throw new Error("secret");
      },
      rpc: async () => {},
    },
  });
  expect((await app.request("/health")).status).toBe(200);
  const ready = await app.request("/ready");
  expect(ready.status).toBe(503);
  expect(await ready.json()).toEqual({
    ok: false,
    checks: { db: true, redis: false, rpc: true },
    key: { ok: true },
  });
  expect((await app.request("/metrics")).status).toBe(200);
});
it("readiness timeout and stopping health", async () => {
  const app = createHealthApp({
    version: "test",
    commit: "test",
    registry: new Registry(),
    timeoutMs: 5,
    isClosing: () => true,
    checks: { db: () => new Promise(() => {}) },
  });
  expect((await app.request("/health")).status).toBe(503);
  expect((await app.request("/ready")).status).toBe(503);
});

it.each(["role_mismatch", "role_disabled"] as const)(
  "health and readiness return 503 for Config %s and recover after refresh",
  async (reason) => {
    const signer = Keypair.generate();
    const configured = reason === "role_mismatch" ? Keypair.generate() : signer;
    const data = Buffer.alloc(872);
    createHash("sha256").update("account:Config").digest().copy(data, 0, 0, 8);
    configured.publicKey.toBuffer().copy(data, 104);
    data[736] = 1;
    data[742] = reason === "role_disabled" ? 1 << 3 : 0;
    const guard = new RoleGuard({
      role: "keeper",
      publicKey: signer.publicKey,
      recheckSeconds: 60,
      readConfig: async () => decodeConfigRoles(data),
    });
    await guard.refresh();
    const app = createHealthApp({
      version: "test",
      commit: "test",
      registry: new Registry(),
      timeoutMs: 25,
      guard,
      checks: {
        db: async () => {},
        redis: async () => {},
        rpc: async () => {},
      },
    });
    const health = await app.request("/health");
    expect(health.status).toBe(503);
    expect(await health.json()).toEqual({
      ok: false,
      reason,
      version: "test",
      commit: "test",
    });
    const ready = await app.request("/ready");
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({
      ok: false,
      key: { ok: false, reason },
    });
    data[742] = 0;
    signer.publicKey.toBuffer().copy(data, 104);
    await guard.refresh();
    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/ready")).status).toBe(200);
  },
);
