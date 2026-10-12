import "./setup.js";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createApi } from "../../app.js";
import type { ApiDependencies } from "../index.js";
import { decodeBase58, encodeBase58, publicKeyBytes } from "../base58.js";
import { buildLinkMessage } from "../message.js";
import {
  InMemoryLinkRateLimiter,
  isPrivateAddress,
  LINK_LIMITS,
} from "../ratelimit.js";
import {
  InMemoryLinkStore,
  MAX_LIVE_NONCES,
  SESSION_TTL_SECONDS,
  type LinkSession,
} from "../store.js";

const origin = "https://onepercent.test";
const secret = "offline-test-only-secret-000000000000";
const epoch = Date.parse("2026-10-08T12:00:00.000Z");
const username = "onepercent_bot";
const otherNonce = "a".repeat(32);
function wallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  const address = encodeBase58(Buffer.from(jwk.x!, "base64url"));
  return {
    address,
    signature: (message: string) =>
      sign(null, Buffer.from(message), privateKey).toString("base64"),
  };
}
function harness(withSecret = true, trustProxyHeader?: string) {
  let now = epoch;
  const clock = () => now;
  const logger = { info: vi.fn() };
  const store = new InMemoryLinkStore(clock);
  const deps: ApiDependencies = {
    webOrigin: origin,
    trustProxyHeader,
    ...(withSecret ? { secret } : {}),
    clock,
    linkStore: store,
    linkRateLimiter: new InMemoryLinkRateLimiter(clock),
    logger,
  };
  const app = createApi(
    { WEB_ORIGIN: origin, APP_VERSION: "test", GIT_COMMIT: "offline" },
    deps,
  );
  const post = (path: string, body: unknown, bearer?: string) =>
    app.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: bearer } : {}),
      },
      body: JSON.stringify(body),
    });
  const nonce = async (telegramUserId = 1) => {
    const response = await post(
      "/api/link/nonce",
      { telegramUserId, botUsername: username },
      `Bearer ${secret}`,
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    return (await response.json()) as { nonce: string; expiresAt: string };
  };
  const session = async (nonce: string, address: string) => {
    const response = await app.request(
      `/api/link/session/${nonce}?address=${address}`,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as {
      message: string;
      botUsername: string;
      expiresAt: string;
    };
  };
  return {
    app,
    store,
    logger,
    post,
    nonce,
    session,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("SIWS link routes", () => {
  it("unbind is bearer-protected, strict and removes both binding directions", async () => {
    const h = harness();
    expect(
      (await h.post("/api/link/unbind", { telegramUserId: 1 })).status,
    ).toBe(401);
    expect(
      (
        await h.post(
          "/api/link/unbind",
          { telegramUserId: 1, extra: true },
          `Bearer ${secret}`,
        )
      ).status,
    ).toBe(400);
    expect(
      await (
        await h.post(
          "/api/link/unbind",
          { telegramUserId: 1 },
          `Bearer ${secret}`,
        )
      ).json(),
    ).toEqual({ removed: false });
    const address = wallet().address;
    await h.store.bind(1, address);
    expect(
      await (
        await h.post(
          "/api/link/unbind",
          { telegramUserId: 1 },
          `Bearer ${secret}`,
        )
      ).json(),
    ).toEqual({ removed: true });
    expect(await h.store.walletOf(1)).toBeNull();
    expect(await h.store.telegramOf(address)).toBeNull();
  });
  it("signs the server-built message with a throwaway Ed25519 key, binds and rejects replay", async () => {
    const h = harness();
    const w = wallet();
    const n = await h.nonce();
    expect(n.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(n.expiresAt).toBe("2026-10-08T12:10:00.000Z");
    const s = await h.session(n.nonce, w.address);
    expect(s.botUsername).toBe(username);
    const body = {
      nonce: n.nonce,
      address: w.address,
      signature: w.signature(s.message),
      message: "Client text is ignored",
    };
    const verified = await h.post("/api/link/verify", body);
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({
      ok: true,
      wallet: w.address,
      botUsername: username,
    });
    const lookup = await h.app.request("/api/link/telegram/1", {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(await lookup.json()).toEqual({
      wallet: w.address,
      linkedAt: "2026-10-08T12:00:00.000Z",
    });
    expect(await h.store.telegramOf(w.address)).toBe(1);
    expect((await h.post("/api/link/verify", body)).status).toBe(410);
    expect((await h.app.request(`/api/link/session/${n.nonce}`)).status).toBe(
      410,
    );
    expect(h.logger.info).not.toHaveBeenCalled();
  });

  it("returns a generic 503 when binding capacity is exhausted and keeps the nonce consumed", async () => {
    const h = harness();
    const w = wallet();
    const n = await h.nonce();
    const s = await h.session(n.nonce, w.address);
    vi.spyOn(h.store, "bind").mockRejectedValue(
      new Error("Internal capacity details"),
    );
    const body = {
      nonce: n.nonce,
      address: w.address,
      signature: w.signature(s.message),
    };
    const response = await h.post("/api/link/verify", body);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      message: "The machine didn't answer. Try again.",
    });
    expect((await h.post("/api/link/verify", body)).status).toBe(410);
    expect(await h.store.walletOf(1)).toBeNull();
  });

  it.each([
    "wrong key",
    "wrong address",
    "another nonce",
    "altered domain",
    "altered statement",
  ])("rejects %s and consumes the nonce", async (kind) => {
    const h = harness();
    const w = wallet();
    const other = wallet();
    const n = await h.nonce();
    const s = await h.session(n.nonce, w.address);
    let message = s.message;
    if (kind === "another nonce")
      message = (await h.session((await h.nonce(2)).nonce, w.address)).message;
    if (kind === "altered domain")
      message = message.replaceAll("onepercent.test", "another.test");
    if (kind === "altered statement")
      message = message.replace("Read-only.", "Different statement.");
    const body = {
      nonce: n.nonce,
      address: kind === "wrong address" ? other.address : w.address,
      signature: (kind === "wrong key" ? other : w).signature(message),
    };
    expect((await h.post("/api/link/verify", body)).status).toBe(401);
    expect((await h.post("/api/link/verify", body)).status).toBe(410);
    expect(await h.store.walletOf(1)).toBeNull();
    expect(h.logger.info).not.toHaveBeenCalled();
  });

  it("consumes before validating malformed address and signature fields", async () => {
    const h = harness();
    for (const fields of [
      {},
      { address: "invalid", signature: "AA==" },
      { address: wallet().address, signature: "A".repeat(86) + "==" },
      { address: wallet().address, signature: [] },
    ]) {
      const n = await h.nonce();
      expect(
        (await h.post("/api/link/verify", { nonce: n.nonce, ...fields }))
          .status,
      ).toBe(401);
      expect((await h.store.peekNonce(n.nonce)).status).toBe("gone");
    }
  });

  it("takes a nonce atomically across simultaneous verification attempts", async () => {
    const h = harness();
    const w = wallet();
    const n = await h.nonce();
    const s = await h.session(n.nonce, w.address);
    const body = {
      nonce: n.nonce,
      address: w.address,
      signature: w.signature(s.message),
    };
    const responses = await Promise.all([
      h.post("/api/link/verify", body),
      h.post("/api/link/verify", body),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 410,
    ]);
  });

  it("expires at the TTL and invalidates the previous open nonce on replacement", async () => {
    const h = harness();
    const first = await h.nonce();
    const second = await h.nonce();
    expect(
      (await h.app.request(`/api/link/session/${first.nonce}`)).status,
    ).toBe(410);
    h.advance(601_000);
    expect(
      (await h.app.request(`/api/link/session/${second.nonce}`)).status,
    ).toBe(410);
    expect(
      (await h.post("/api/link/verify", { nonce: second.nonce })).status,
    ).toBe(410);
    expect(
      (await h.app.request(`/api/link/session/${otherNonce}`)).status,
    ).toBe(404);
    expect(
      (await h.post("/api/link/verify", { nonce: otherNonce })).status,
    ).toBe(404);
  });

  it("returns messages only for decoded 32-byte addresses", async () => {
    const h = harness();
    const n = await h.nonce();
    for (const suffix of [
      "",
      "?address=invalid",
      `?address=${"1".repeat(33)}`,
    ]) {
      expect(
        await (
          await h.app.request(`/api/link/session/${n.nonce}${suffix}`)
        ).json(),
      ).toEqual({
        status: "open",
        expiresAt: n.expiresAt,
        botUsername: username,
      });
    }
  });

  it.each([
    undefined,
    "Bearer incorrect",
    `Basic ${secret}`,
    `Bearer ${secret} extra`,
  ])("rejects missing or invalid bot bearer %s", async (authorization) => {
    const h = harness();
    expect(
      (
        await h.post(
          "/api/link/nonce",
          { telegramUserId: 1, botUsername: username },
          authorization,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await h.app.request("/api/link/telegram/1", {
          headers: authorization ? { Authorization: authorization } : {},
        })
      ).status,
    ).toBe(401);
  });

  it("disables bot-only routes without a secret and logs only a fixed message once", async () => {
    const h = harness(false);
    expect(
      (
        await h.post("/api/link/nonce", {
          telegramUserId: 1,
          botUsername: username,
        })
      ).status,
    ).toBe(503);
    expect((await h.app.request("/api/link/telegram/1")).status).toBe(503);
    expect(h.logger.info.mock.calls).toEqual([["link disabled"]]);
  });

  it("validates bot identifiers, JSON and lookup ids", async () => {
    const h = harness();
    for (const user of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"])
      expect(
        (
          await h.post(
            "/api/link/nonce",
            { telegramUserId: user, botUsername: username },
            `Bearer ${secret}`,
          )
        ).status,
      ).toBe(400);
    for (const name of ["tiny", "too-long-".repeat(5), "bad-name"])
      expect(
        (
          await h.post(
            "/api/link/nonce",
            { telegramUserId: 1, botUsername: name },
            `Bearer ${secret}`,
          )
        ).status,
      ).toBe(400);
    for (const id of ["0", "-1", "1.5", "9007199254740992", "01"])
      expect(
        (
          await h.app.request(`/api/link/telegram/${id}`, {
            headers: { Authorization: `Bearer ${secret}` },
          })
        ).status,
      ).toBe(400);
    expect(
      await (
        await h.app.request("/api/link/telegram/1", {
          headers: { Authorization: `Bearer ${secret}` },
        })
      ).json(),
    ).toEqual({ wallet: null, linkedAt: null });
    expect(
      (await h.app.request("/api/link/verify", { method: "POST", body: "{" }))
        .status,
    ).toBe(400);
  });

  it("keeps the link CORS restricted to the web origin including preflight", async () => {
    const h = harness();
    const options = await h.app.request("/api/link/verify", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });
    expect(options.status).toBe(204);
    expect(options.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(options.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET,POST",
    );
    expect(options.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type",
    );
    const denied = await h.app.request(`/api/link/session/${otherNonce}`, {
      headers: { Origin: "https://dial.to" },
    });
    expect(denied.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });
});

describe("rate limits and trusted socket addresses", () => {
  it("allows five nonce issues per user per ten minutes", async () => {
    const h = harness();
    for (let i = 0; i < LINK_LIMITS.nonce.limit; i++) await h.nonce();
    const response = await h.post(
      "/api/link/nonce",
      { telegramUserId: 1, botUsername: username },
      `Bearer ${secret}`,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("600");
    await h.nonce(2);
    h.advance(600_000);
    await h.nonce();
  });

  it.each([
    ["session", 30],
    ["verify", 10],
  ] as const)(
    "limits %s by IP and resets after sixty seconds",
    async (route, count) => {
      const h = harness();
      const request = () =>
        route === "session"
          ? h.app.request(`/api/link/session/${otherNonce}`)
          : h.post("/api/link/verify", { nonce: otherNonce });
      for (let i = 0; i < count; i++)
        expect((await request()).status).toBe(404);
      const response = await request();
      expect(response.status).toBe(429);
      expect(response.headers.get("Retry-After")).toBe("60");
      h.advance(60_000);
      expect((await request()).status).toBe(404);
    },
  );

  it.each(["203.0.113.1", "10.0.0.1"])(
    "ignores forwarded headers by default even behind socket %s",
    async (socket) => {
      const h = harness();
      const request = (forwarded: string) =>
        h.app.request(
          `/api/link/session/${otherNonce}`,
          { headers: { "X-Forwarded-For": forwarded } },
          { incoming: { socket: { remoteAddress: socket } } },
        );
      for (let i = 0; i < 30; i++)
        expect((await request(`198.51.100.${i}`)).status).toBe(404);
      expect((await request("198.51.100.100")).status).toBe(429);
    },
  );

  it.each(["X-Forwarded-For", "X-Real-IP"])(
    "uses only the explicitly trusted proxy header %s",
    async (header) => {
      const h = harness(true, header);
      const request = (forwarded: string) =>
        h.app.request(
          `/api/link/session/${otherNonce}`,
          { headers: { [header]: forwarded } },
          { incoming: { socket: { remoteAddress: "10.0.0.1" } } },
        );
      for (let i = 0; i < 30; i++)
        expect((await request(`192.0.2.1, 198.51.100.${i}`)).status).toBe(404);
      expect((await request("192.0.2.1")).status).toBe(429);
      expect((await request("192.0.2.2")).status).toBe(404);
      for (let i = 0; i < 30; i++)
        expect((await request(`invalid-${i}`)).status).toBe(404);
      expect((await request("still-invalid")).status).toBe(429);
    },
  );

  it.each([
    "10.0.0.1",
    "127.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
  ])("recognizes private socket %s", (address) =>
    expect(isPrivateAddress(address)).toBe(true),
  );
  it.each(["203.0.113.1", "172.32.0.1", "2001:db8::1", "invalid", "unknown"])(
    "does not trust public/unknown socket %s",
    (address) => expect(isPrivateAddress(address)).toBe(false),
  );
});

describe("SIWS message, base58 and in-memory store", () => {
  it("matches the LF-only message golden", () => {
    const session: LinkSession = {
      nonce: "0123456789abcdef0123456789abcdef",
      telegramUserId: 1,
      botUsername: username,
      issuedAt: "2026-10-08T12:00:00.000Z",
      expiresAt: "2026-10-08T12:10:00.000Z",
    };
    expect(
      buildLinkMessage(origin, session, "11111111111111111111111111111111"),
    ).toBe(
      "onepercent.test wants you to sign in with your Solana account:\n11111111111111111111111111111111\n\nLink this wallet to the 1% Machine Telegram bot. Read-only. No transaction, no fees.\n\nURI: https://onepercent.test/link/0123456789abcdef0123456789abcdef\nVersion: 1\nChain ID: mainnet\nNonce: 0123456789abcdef0123456789abcdef\nIssued At: 2026-10-08T12:00:00.000Z\nExpiration Time: 2026-10-08T12:10:00.000Z",
    );
  });

  it.each([
    ["11111111111111111111111111111111", "00".repeat(32)],
    [
      "So11111111111111111111111111111111111111112",
      "069b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001",
    ],
    [
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9",
    ],
  ])("round trips known base58 vector %s", (encoded, hex) => {
    expect(Buffer.from(decodeBase58(encoded!)).toString("hex")).toBe(hex);
    expect(encodeBase58(Buffer.from(hex!, "hex"))).toBe(encoded);
    expect(publicKeyBytes(encoded)).toHaveLength(32);
  });
  it("rejects malformed or wrong-size public keys", () => {
    for (const value of [
      null,
      1,
      "",
      "0".repeat(32),
      "1".repeat(31),
      "1".repeat(33),
      "1".repeat(129),
    ])
      expect(publicKeyBytes(value)).toBeNull();
    expect(() => decodeBase58("0")).toThrow("Invalid base58");
    expect(() => decodeBase58("")).toThrow("Invalid base58");
  });

  it("replaces both sides of a one-to-one binding and leaves no stale inverse mappings", async () => {
    const h = harness();
    await h.store.bind(1, "wallet-a");
    await h.store.bind(2, "wallet-b");
    await h.store.bind(1, "wallet-b");
    expect(await h.store.walletOf(1)).toMatchObject({ wallet: "wallet-b" });
    expect(await h.store.walletOf(2)).toBeNull();
    expect(await h.store.telegramOf("wallet-a")).toBeNull();
    expect(await h.store.telegramOf("wallet-b")).toBe(1);
    await h.store.bind(3, "wallet-b");
    expect(await h.store.walletOf(1)).toBeNull();
    expect(await h.store.telegramOf("wallet-b")).toBe(3);
  });

  it("pins the TTL and capacity, allows replacement at capacity, and removes expired live entries", async () => {
    const h = harness();
    expect(SESSION_TTL_SECONDS).toBe(600);
    expect(MAX_LIVE_NONCES).toBe(10_000);
    const first = await h.store.createNonce(1, username);
    for (let i = 2; i <= MAX_LIVE_NONCES; i++)
      await h.store.createNonce(i, username);
    await expect(
      h.store.createNonce(MAX_LIVE_NONCES + 1, username),
    ).rejects.toThrow("Link capacity reached");
    await expect(h.store.createNonce(1, username)).resolves.toHaveProperty(
      "nonce",
    );
    expect(await h.store.peekNonce(first.nonce)).toEqual({ status: "gone" });
    h.advance(SESSION_TTL_SECONDS * 1_000);
    await expect(
      h.store.createNonce(MAX_LIVE_NONCES + 1, username),
    ).resolves.toHaveProperty("nonce");
  });
});
