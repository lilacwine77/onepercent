import { PublicKey } from "@solana/web3.js";
import {
  FeedAttestResponse,
  SellBackQuoteResponse,
  SignerErrorResponse,
} from "@onepercent/sdk/api";
import { describe, expect, it, vi } from "vitest";
import { settings } from "./__fixtures__/settings.js";
import { createSignerProxy } from "./signer.js";

const key = (byte: number) =>
  new PublicKey(Uint8Array.from({ length: 32 }, () => byte)).toBase58();
const wallet = key(1),
  signer = key(2),
  supported = key(3),
  unsafe = key(4);
const forbidden = "So11111111111111111111111111111111111111112";
const ipHash = "a".repeat(64);
const targets = {
  intake: {
    url: "http://intake-signer.railway.internal",
    token: "i".repeat(32),
  },
  quote: { url: "http://quote-signer.railway.internal", token: "q".repeat(32) },
  settings,
};
// Wire examples follow S2 d23fd58 intake/service.ts and quote/service.ts, with
// D22's final-read slot and COPY refusal names. They do not execute S2 or
// validate attestation cryptography; the opaque signature is 64 bytes as in S2.
const feed = {
  asOfSlot: 350_000_012,
  wallet,
  signer,
  snapshotSlot: 349_900_000,
  attestations: [
    {
      chunk: 0,
      nonce: 19,
      expiry: 1_791_504_090,
      bagsHash: "3f".repeat(32),
      message: Buffer.from("S2 Feed contract fixture").toString("base64"),
      signature: Buffer.alloc(64, 7).toString("base64"),
      bags: [
        {
          mint: supported,
          amount: "123456789012345678",
          decimals: 6,
          tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          source: key(5),
          mergeFrom: [key(6)],
        },
      ],
    },
  ],
  refused: [
    { mint: unsafe, reason: "not_supported", date: null },
    { mint: forbidden, reason: "mint_forbidden", date: null },
  ],
};
const quote = {
  asOfSlot: 350_000_014,
  ok: true,
  quote: {
    owner: wallet,
    mint: supported,
    cards: [
      { index: 9, amount: "1200000" },
      { index: 3, amount: "800000" },
    ],
    totalAmount: "2000000",
    quoteLamports: "80000000",
    stockedValueLamports: "90000000",
    valueLamports: "80000000",
    payoutLamports: "72000000",
    expiry: 1_791_504_015,
    nonce: 7,
    bucketClass: "MAJOR",
    message: Buffer.from("S2 Sell back contract fixture").toString("base64"),
    signature: Buffer.alloc(64, 8).toString("base64"),
    signer,
    router: "jupiter",
    requestId: "contract-order-7",
  },
};
const quoteRefusal = {
  asOfSlot: 350_000_015,
  ok: false,
  reason: "SOL_FLOOR",
};
const feedRequest = {
  wallet,
  chunks: [[{ mint: supported }, { mint: unsafe }, { mint: forbidden }]],
};
const quoteRequest = { owner: wallet, cardIndices: [9, 3] };

describe("D22 S2 to S4 signer response contract", () => {
  it("forwards Feed success and per-bag COPY refusals with the final live-read slot", async () => {
    const request = vi.fn(async () => Response.json(feed));
    const proxy = createSignerProxy({ ...targets, fetch: request });
    expect(FeedAttestResponse.parse(feed)).toEqual(feed);
    expect(
      await proxy("intake", feedRequest, ipHash, FeedAttestResponse),
    ).toEqual(feed);
    expect(request).toHaveBeenCalledWith(
      new URL("/internal/feed/attest", targets.intake.url),
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        body: JSON.stringify(feedRequest),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${targets.intake.token}`,
          "x-client-ip-hash": ipHash,
        },
      }),
    );
    expect(
      FeedAttestResponse.safeParse({ ...feed, asOfSlot: undefined }).success,
    ).toBe(false);
    for (const reason of ["mint_not_safe", "token_excluded"]) {
      expect(
        FeedAttestResponse.safeParse({
          ...feed,
          refused: [{ mint: unsafe, reason, date: null }],
        }).success,
      ).toBe(false);
    }
  });

  it("preserves quote success and business refusal slots without opening the circuit", async () => {
    const request = vi.fn(async () => Response.json(quoteRefusal));
    const proxy = createSignerProxy({ ...targets, fetch: request });
    expect(SellBackQuoteResponse.parse(quote)).toEqual(quote);
    expect(SellBackQuoteResponse.parse(quoteRefusal)).toEqual(quoteRefusal);
    for (let i = 0; i <= settings.transport.breakerFailureThreshold; i++) {
      expect(
        await proxy("quote", quoteRequest, ipHash, SellBackQuoteResponse),
      ).toEqual(quoteRefusal);
    }
    request.mockResolvedValueOnce(Response.json(quote));
    expect(
      await proxy("quote", quoteRequest, ipHash, SellBackQuoteResponse),
    ).toEqual(quote);
    expect(request).toHaveBeenCalledTimes(
      settings.transport.breakerFailureThreshold + 2,
    );
    for (const body of [quote, quoteRefusal]) {
      expect(
        SellBackQuoteResponse.safeParse({ ...body, asOfSlot: undefined })
          .success,
      ).toBe(false);
    }
  });

  it("returns all-bag Feed refusals repeatedly without opening the circuit", async () => {
    const refused = { ...feed, attestations: [] };
    const request = vi.fn(async () => Response.json(refused));
    const proxy = createSignerProxy({ ...targets, fetch: request });
    const rejectedRequest = {
      wallet,
      chunks: [[{ mint: unsafe }, { mint: forbidden }]],
    };
    for (let i = 0; i <= settings.transport.breakerFailureThreshold; i++) {
      expect(
        await proxy("intake", rejectedRequest, ipHash, FeedAttestResponse),
      ).toEqual(refused);
    }
    request.mockResolvedValueOnce(Response.json(feed));
    expect(
      await proxy("intake", feedRequest, ipHash, FeedAttestResponse),
    ).toEqual(feed);
    expect(request).toHaveBeenCalledTimes(
      settings.transport.breakerFailureThreshold + 2,
    );
  });

  it.each([
    ["intake", 429, "rate_limited"],
    ["quote", 429, "rate_limited"],
    ["intake", 503, "evidence_unavailable"],
    ["quote", 503, "evidence_unavailable"],
    ["intake", 503, "indexer_lag"],
  ] as const)(
    "preserves %s %i %s and keeps the signer reachable",
    async (role, status, reason) => {
      const body = { reason };
      expect(SignerErrorResponse.parse(body)).toEqual(body);
      const request = vi.fn(async () =>
        Response.json(body, { status, headers: { "Retry-After": "3" } }),
      );
      const proxy = createSignerProxy({ ...targets, fetch: request });
      const call = () =>
        role === "intake"
          ? proxy(role, feedRequest, ipHash, FeedAttestResponse)
          : proxy(role, quoteRequest, ipHash, SellBackQuoteResponse);
      for (let i = 0; i <= settings.transport.breakerFailureThreshold; i++) {
        await expect(call()).rejects.toMatchObject({
          status,
          code: reason,
          retryAfterS: 3,
        });
      }
      request.mockResolvedValueOnce(
        Response.json(role === "intake" ? feed : quote),
      );
      expect(await call()).toEqual(role === "intake" ? feed : quote);
      expect(request).toHaveBeenCalledTimes(
        settings.transport.breakerFailureThreshold + 2,
      );
    },
  );

  it("opens the circuit for transport failures and isolates the other signer role", async () => {
    const request = vi.fn(async (): Promise<Response> => {
      throw new TypeError("connection unavailable");
    });
    const proxy = createSignerProxy({ ...targets, fetch: request });
    for (let i = 0; i <= settings.transport.breakerFailureThreshold; i++) {
      await expect(
        proxy("intake", feedRequest, ipHash, FeedAttestResponse),
      ).rejects.toMatchObject({ status: 503, code: "signer_unavailable" });
    }
    expect(request).toHaveBeenCalledTimes(
      settings.transport.breakerFailureThreshold,
    );
    request.mockImplementationOnce(async () => Response.json(quote));
    expect(
      await proxy("quote", quoteRequest, ipHash, SellBackQuoteResponse),
    ).toEqual(quote);
  });
});
