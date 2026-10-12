// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

function storageFixture() {
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  return storage;
}

it("allows disjoint active cards while excluding overlaps and global plans", async () => {
  const { enterSubmission } = await import("./submission-guard");
  const height = vi.fn(async () => 1);
  const wallet = "devnet:active-cards";
  const first = await enterSubmission(wallet, height, ["A"]);
  const second = await enterSubmission(wallet, height, ["B"]);
  await expect(enterSubmission(wallet, height, ["B", "C"])).rejects.toThrow();
  await expect(enterSubmission(wallet, height)).rejects.toThrow();
  first();
  const replacement = await enterSubmission(wallet, height, ["A"]);
  first();
  await expect(enterSubmission(wallet, height, ["A"])).rejects.toThrow();
  second();
  replacement();
  (await enterSubmission(wallet, height))();
  expect(height).not.toHaveBeenCalled();
});

it("does not reconcile an unrelated ambiguous card before another exit", async () => {
  const {
    enterSubmission,
    rememberSubmission,
    reconcileSubmission,
    clearSubmission,
  } = await import("./submission-guard");
  const wallet = "devnet:ambiguous-card";
  const unknown = vi.fn(async () => false);
  const height = vi.fn(async () => {
    throw new Error("RPC offline");
  });
  rememberSubmission(wallet, 100, ["A"]);
  reconcileSubmission(wallet, unknown, ["A"]);
  const leave = await enterSubmission(wallet, height, ["B"]);
  expect(unknown).not.toHaveBeenCalled();
  expect(height).not.toHaveBeenCalled();
  rememberSubmission(wallet, 101, ["B"]);
  clearSubmission(wallet, ["B"]);
  clearSubmission(wallet);
  leave();
  await expect(enterSubmission(wallet, height, ["A"])).rejects.toThrow();
  await expect(enterSubmission(wallet, height)).rejects.toThrow();
  expect(unknown).toHaveBeenCalledTimes(2);
  clearSubmission(wallet, ["A"]);
});

it("checks a shared batch receipt once and preserves unrelated pending cards", async () => {
  const {
    enterSubmission,
    rememberSubmission,
    reconcileSubmission,
    clearSubmission,
  } = await import("./submission-guard");
  const wallet = "devnet:batch-cards";
  const height = vi.fn(async () => 1);
  const settled = vi.fn(async () => true);
  const unknown = vi.fn(async () => false);
  rememberSubmission(wallet, 100, ["A", "B"]);
  reconcileSubmission(wallet, settled, ["A", "B"]);
  rememberSubmission(wallet, 100, ["C"]);
  reconcileSubmission(wallet, unknown, ["C"]);
  (await enterSubmission(wallet, height, ["A", "B"]))();
  expect(settled).toHaveBeenCalledOnce();
  expect(unknown).not.toHaveBeenCalled();
  expect(height).not.toHaveBeenCalled();
  await expect(enterSubmission(wallet, height)).rejects.toThrow();
  expect(unknown).toHaveBeenCalledOnce();
  clearSubmission(wallet, ["C"]);
});

it("keeps global active and pending plans authoritative for scoped exits", async () => {
  const { enterSubmission, rememberSubmission } =
    await import("./submission-guard");
  const wallet = "devnet:global-before-cards";
  const height = vi.fn(async () => 99);
  const leave = await enterSubmission(wallet, height);
  await expect(enterSubmission(wallet, height, ["A"])).rejects.toThrow();
  rememberSubmission(wallet, 100);
  leave();
  await expect(enterSubmission(wallet, height, ["B"])).rejects.toThrow();
  height.mockResolvedValue(101);
  (await enterSubmission(wallet, height, ["B"]))();
});

it("restores card scopes across reload without turning them into a wallet lock", async () => {
  const storage = storageFixture();
  const first = await import("./submission-guard");
  const wallet = "devnet:reload-cards";
  first.rememberSubmission(wallet, 100, ["A"]);
  first.rememberSubmission(wallet, 200, ["B"]);
  vi.resetModules();
  const reloaded = await import("./submission-guard");
  const height = vi.fn(async () => 100);
  (await reloaded.enterSubmission(wallet, height, ["C"]))();
  expect(height).not.toHaveBeenCalled();
  await expect(
    reloaded.enterSubmission(wallet, height, ["A"]),
  ).rejects.toThrow();
  height.mockResolvedValue(101);
  (await reloaded.enterSubmission(wallet, height, ["A"]))();
  expect(storage.size).toBe(1);
  await expect(
    reloaded.enterSubmission(wallet, height, ["B"]),
  ).rejects.toThrow();
  height.mockResolvedValue(201);
  (await reloaded.enterSubmission(wallet, height))();
  expect(storage.size).toBe(0);
});

it("retains scoped ambiguity after expiry when the journal is still unresolved", async () => {
  const {
    enterSubmission,
    rememberSubmission,
    reconcileSubmission,
    clearSubmission,
  } = await import("./submission-guard");
  const wallet = "devnet:scoped-journal";
  rememberSubmission(wallet, 100, ["A"]);
  const reconcile = vi.fn(async () => {
    throw new Error("Receipt unavailable");
  });
  reconcileSubmission(wallet, reconcile, ["A"]);
  const height = vi.fn(async () => 1000);
  await expect(enterSubmission(wallet, height, ["A"])).rejects.toThrow(
    "Receipt unavailable",
  );
  (await enterSubmission(wallet, height, ["B"]))();
  expect(reconcile).toHaveBeenCalledOnce();
  expect(height).not.toHaveBeenCalled();
  clearSubmission(wallet, ["A"]);
});

it("rejects empty scopes rather than bypassing the global guard", async () => {
  const { enterSubmission, rememberSubmission } =
    await import("./submission-guard");
  await expect(
    enterSubmission("devnet:empty-scope", async () => 1, []),
  ).rejects.toThrow();
  expect(() => rememberSubmission("devnet:empty-scope", 100, [])).toThrow();
});

it("retains an uncertain submission across a module reload and releases it only after the caller's expiry barrier", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const first = await import("./submission-guard");
  first.rememberSubmission("devnet:test-wallet", 100);
  vi.resetModules();
  const reloaded = await import("./submission-guard");
  await expect(
    reloaded.enterSubmission("devnet:test-wallet", async () => 100),
  ).rejects.toThrow();
  await expect(
    reloaded.enterSubmission("devnet:test-wallet", async () => NaN),
  ).rejects.toThrow();
  await expect(
    reloaded.enterSubmission("devnet:test-wallet", async () => {
      throw new Error("RPC unavailable");
    }),
  ).rejects.toThrow();
  const release = await reloaded.enterSubmission(
    "devnet:test-wallet",
    async () => 101,
  );
  expect(storage.size).toBe(0);
  await expect(
    reloaded.enterSubmission("devnet:test-wallet", async () => 101),
  ).rejects.toThrow();
  release();
  (await reloaded.enterSubmission("devnet:test-wallet", async () => 101))();
});
