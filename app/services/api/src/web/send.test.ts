import { SERVICES } from "@onepercent/config";
import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { ServiceRuntime } from "@onepercent/service-kit";
import { describe, expect, it, vi } from "vitest";
import {
  checkSignedTransaction,
  SignedTransactionSender,
  relaySignedTransaction,
} from "./send.js";
import { createWebDependencies } from "./deps.js";
import { createWebRouter } from "./router.js";
import { ItemLimiter } from "./limits.js";

function transaction(version: "legacy" | 0 = 0, secondSigner = false) {
  const payer = Keypair.generate();
  const other = Keypair.generate();
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: SystemProgram.programId.toBase58(),
    instructions: [
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: other.publicKey,
        lamports: 1,
      }),
      ...(secondSigner
        ? [
            SystemProgram.transfer({
              fromPubkey: other.publicKey,
              toPubkey: payer.publicKey,
              lamports: 1,
            }),
          ]
        : []),
    ],
  });
  const tx = new VersionedTransaction(
    version === "legacy"
      ? message.compileToLegacyMessage()
      : message.compileToV0Message(),
  );
  tx.sign([payer]);
  return { tx, other };
}
const encoded = (tx: VersionedTransaction) =>
  Buffer.from(tx.serialize()).toString("base64");
function setup() {
  const request = vi.fn(async (_method: string, params: unknown[]) =>
    checkSignedTransaction(params[0] as string),
  );
  const sender = new SignedTransactionSender({
    request,
  } as unknown as ServiceRuntime["rpc"]);
  const deps = createWebDependencies({
    XRAY_SOURCE: "fixtures",
    LOG_LEVEL: "silent",
    WEB_ORIGIN: "https://web.test",
  });
  deps.sender = sender;
  deps.logger = { warn: vi.fn() };
  const app = createWebRouter(deps);
  const post = (tx: string) =>
    app.request("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx }),
    });
  return { request, sender, deps, app, post };
}

describe("signed transaction fallback", () => {
  it("uses an isolated bounded public transport rather than the runtime client", async () => {
    const tx = encoded(transaction().tx);
    const signature = checkSignedTransaction(tx);
    const request = vi.fn();
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: signature }),
        ),
      );
    try {
      const deps = createWebDependencies(
        { XRAY_SOURCE: "fixtures", LOG_LEVEL: "silent" },
        {
          env: { RPC_URL: "https://rpc.test" },
          rpc: { request },
        } as unknown as ServiceRuntime,
      );
      await expect(deps.sender.send(tx)).resolves.toBe(signature);
      expect(request).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]![0]).toBe("https://rpc.test");
      expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toMatchObject({
        method: "sendTransaction",
        params: [tx, expect.objectContaining({ skipPreflight: false })],
      });
    } finally {
      fetch.mockRestore();
    }
  });

  it("applies the existing per-IP RPC request budget before signature work", async () => {
    const { post, request, deps } = setup();
    deps.sendLimiter = new ItemLimiter(1);
    expect((await post(encoded(transaction().tx))).status).toBe(200);
    const blocked = await post(encoded(transaction().tx));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("bounds concurrent sends per IP and releases capacity after completion", async () => {
    const { post, request } = setup();
    const tx = encoded(transaction().tx);
    const signature = checkSignedTransaction(tx);
    const release: (() => void)[] = [];
    request.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release.push(() => resolve(signature));
        }),
    );
    const active = Array.from(
      { length: SERVICES.api.rpcMaxConcurrentPerIp },
      () => post(tx),
    );
    await vi.waitFor(() =>
      expect(release).toHaveLength(SERVICES.api.rpcMaxConcurrentPerIp),
    );
    const saturated = await post(tx);
    expect(saturated.status).toBe(503);
    expect(saturated.headers.get("Retry-After")).toBe("1");
    expect(request).toHaveBeenCalledTimes(SERVICES.api.rpcMaxConcurrentPerIp);
    release.forEach((done) => done());
    expect(
      (await Promise.all(active)).every((response) => response.status === 200),
    ).toBe(true);
    request.mockResolvedValue(signature);
    expect((await post(tx)).status).toBe(200);
  });

  it.each(["legacy", 0] as const)(
    "forwards a valid %s transaction unchanged with RPC preflight",
    async (version) => {
      const { post, request } = setup();
      const bytes = encoded(transaction(version).tx);
      const expected = checkSignedTransaction(bytes);
      const response = await post(bytes);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ signature: expected });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(request).toHaveBeenCalledWith(
        "sendTransaction",
        [
          bytes,
          {
            encoding: "base64",
            preflightCommitment: "confirmed",
            skipPreflight: false,
            maxRetries: 0,
          },
        ],
        expect.anything(),
      );
    },
  );

  it("checks every required signature and rejects tampering before RPC", async () => {
    const { post, request } = setup();
    const { tx, other } = transaction(0, true);
    expect((await post(encoded(tx))).status).toBe(400);
    tx.sign([other]);
    expect((await post(encoded(tx))).status).toBe(200);
    request.mockClear();
    tx.signatures[1]![0] = tx.signatures[1]![0]! ^ 1;
    expect((await post(encoded(tx))).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses unsigned, malformed, oversized and trailing-byte payloads", async () => {
    const { post, request } = setup();
    const { tx } = transaction();
    const valid = Buffer.from(tx.serialize());
    tx.signatures[0]!.fill(0);
    for (const bytes of [
      encoded(tx),
      "AQ==",
      "invalid+base64",
      Buffer.alloc(1_233).toString("base64"),
      Buffer.concat([valid, Buffer.from([0])]).toString("base64"),
    ])
      expect((await post(bytes)).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });

  it("does not retry or expose upstream details after an ambiguous send", async () => {
    const { request, post, deps } = setup();
    request.mockRejectedValueOnce(new Error("private upstream details"));
    const response = await post(encoded(transaction().tx));
    expect(response.status).toBe(503);
    expect(request).toHaveBeenCalledTimes(1);
    expect(await response.text()).not.toContain("private");
    expect(deps.logger.warn).toHaveBeenCalledWith(
      {
        reason: "web_route_failed",
        route: "send",
        cause: { code: "Error", detail: "private upstream details" },
      },
      "Web request failed",
    );
  });

  it("rejects an unrelated signature returned by the provider", async () => {
    const { request, post } = setup();
    request.mockResolvedValueOnce("1".repeat(64));
    expect((await post(encoded(transaction().tx))).status).toBe(503);
  });

  it("has CORS for the configured origin and needs no feature flag", async () => {
    const { app } = setup();
    const response = await app.request("/api/send", {
      method: "OPTIONS",
      headers: {
        Origin: "https://web.test",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://web.test",
    );
  });
});

function fixture(versioned = false) {
  const owner = Keypair.generate();
  const ix = SystemProgram.transfer({
    fromPubkey: owner.publicKey,
    toPubkey: Keypair.generate().publicKey,
    lamports: 1,
  });
  const blockhash = Keypair.generate().publicKey.toBase58();
  const transaction = versioned
    ? new VersionedTransaction(
        new TransactionMessage({
          payerKey: owner.publicKey,
          recentBlockhash: blockhash,
          instructions: [ix],
        }).compileToV0Message(),
      )
    : new Transaction({
        feePayer: owner.publicKey,
        recentBlockhash: blockhash,
      }).add(ix);
  if (transaction instanceof Transaction) transaction.sign(owner);
  else transaction.sign([owner]);
  return Buffer.from(transaction.serialize()).toString("base64");
}

describe("signed transaction relay", () => {
  it.each([false, true])(
    "relays a fully signed transaction with preflight enabled (v0=%s)",
    async (versioned) => {
      const tx = fixture(versioned);
      const signature = checkSignedTransaction(tx);
      const request = vi.fn(async () => signature);
      expect(await relaySignedTransaction({ request } as never, tx)).toEqual({
        signature,
      });
      expect(request).toHaveBeenCalledWith(
        "sendTransaction",
        [
          tx,
          {
            encoding: "base64",
            skipPreflight: false,
            preflightCommitment: "confirmed",
            maxRetries: 0,
          },
        ],
        expect.anything(),
      );
    },
  );
  it("refuses missing, forged, malformed and oversized signatures before RPC", async () => {
    const bytes = Buffer.from(fixture(), "base64");
    const unsigned = VersionedTransaction.deserialize(bytes);
    unsigned.signatures[0] = new Uint8Array(64);
    const forged = VersionedTransaction.deserialize(bytes);
    forged.signatures[0]![0] = forged.signatures[0]![0]! ^ 1;
    const request = vi.fn();
    for (const tx of [
      Buffer.from(unsigned.serialize()).toString("base64"),
      Buffer.from(forged.serialize()).toString("base64"),
      "invalid",
      Buffer.alloc(1233).toString("base64"),
      Buffer.concat([bytes, Buffer.from([0])]).toString("base64"),
    ]) {
      await expect(
        relaySignedTransaction({ request } as never, tx),
      ).rejects.toThrow("invalid_signed_transaction");
    }
    expect(request).not.toHaveBeenCalled();
  });
});
