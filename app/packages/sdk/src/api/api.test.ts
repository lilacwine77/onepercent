import { describe, expect, it } from "vitest";
import {
  Base64,
  ConfigResponse,
  createFeedAttestRequest,
  createSellBackQuoteRequest,
  decodeStreamEvent,
  ErrorResponse,
  FeedAttestRequest,
  FeedAttestResponse,
  FeedRefusal,
  formatU64,
  HealthResponse,
  MachineResponse,
  MeResponse,
  parseU64,
  PublicKeyString,
  SellBackQuoteRequest,
  SellBackQuoteResponse,
  SignerErrorReason,
  SignerErrorResponse,
  StatusResponse,
  StreamEvent,
  StreamEventId,
  StreamPing,
  TransactionSignature,
  U64String,
  ValueRequest,
  ValueResponse,
  VerifyResponse,
} from "./index.js";

import {
  config,
  feed,
  flags,
  hex,
  machine,
  maxU64,
  me,
  otherKey,
  publicKey,
  quote,
  signature,
  verify,
  vrf,
} from "./__fixtures__/responses.js";

describe("public API wire primitives", () => {
  it("keeps u64 amounts JSON-safe and converts without precision loss", () => {
    expect(U64String.parse(maxU64)).toBe(maxU64);
    expect(parseU64(maxU64)).toBe((1n << 64n) - 1n);
    expect(formatU64(parseU64(maxU64))).toBe(maxU64);
    expect(JSON.stringify({ lamports: U64String.parse(maxU64) })).toContain(
      maxU64,
    );
  });
  it.each([
    "",
    "-1",
    "+1",
    "1.5",
    "1e3",
    "NaN",
    "18446744073709551616",
    "0".repeat(21),
    1,
    1n,
  ])(
    "rejects invalid u64 input %s without throwing from a refinement",
    (input) => {
      expect(U64String.safeParse(input).success).toBe(false);
    },
  );
  it("validates key, signature and canonical base64 bytes", () => {
    expect(PublicKeyString.parse(publicKey)).toBe(publicKey);
    expect(PublicKeyString.safeParse("bad key").success).toBe(false);
    expect(PublicKeyString.safeParse("1".repeat(33)).success).toBe(false);
    expect(TransactionSignature.parse(signature)).toBe(signature);
    expect(TransactionSignature.safeParse(publicKey).success).toBe(false);
    expect(Base64.parse("AA==")).toBe("AA==");
    for (const bad of ["", "AA", "AA==\n", "AB==", "!!!!"]) {
      expect(Base64.safeParse(bad).success).toBe(false);
    }
  });
});

describe("API response contracts", () => {
  it("preserves bootstrap flags with explicit null chain sections before Config exists", () => {
    const bootstrap = {
      ...config,
      asOfSlot: null,
      paramsHash: null,
      phase: null,
      roles: null,
      vrf: null,
      season: null,
      paused: null,
    };
    expect(ConfigResponse.parse(bootstrap)).toEqual(bootstrap);
    for (const field of Object.keys(bootstrap)) {
      const missing: Record<string, unknown> = { ...bootstrap };
      delete missing[field];
      expect(ConfigResponse.safeParse(missing).success, field).toBe(false);
      expect(
        ConfigResponse.safeParse({ ...bootstrap, [field]: undefined }).success,
        field,
      ).toBe(false);
    }
    for (const field of ["cluster", "programId", "flags"]) {
      expect(
        ConfigResponse.safeParse({ ...bootstrap, [field]: null }).success,
        field,
      ).toBe(false);
    }
    expect(
      ConfigResponse.safeParse({ ...bootstrap, paramsHash: "unavailable" })
        .success,
    ).toBe(false);
  });
  it("parses all read routes and preserves exact wire amounts", () => {
    expect(ConfigResponse.parse(config)).toEqual(config);
    expect(MachineResponse.parse(machine)).toEqual(machine);
    expect(MeResponse.parse(me)).toEqual(me);
    expect(MeResponse.parse({ ...me, binder: null }).binder).toBeNull();
    expect(VerifyResponse.parse(verify)).toEqual(verify);
    const status = {
      asOfSlot: 1,
      indexer: { lagSlots: null },
      keeper: { leader: false, lastSettleAgeSeconds: null },
      signers: { intake: "unavailable", quote: "unavailable" },
      vrf,
    };
    expect(StatusResponse.parse(status)).toEqual(status);
    expect(
      HealthResponse.parse({ ok: true, version: "fixture", commit: "fixture" })
        .ok,
    ).toBe(true);
    expect(
      ErrorResponse.parse({
        asOfSlot: null,
        error: { code: "source_unavailable" },
      }).error.code,
    ).toBe("source_unavailable");
  });
  it("rejects unknown nested fields and missing observation slots", () => {
    expect(
      MachineResponse.safeParse({
        ...machine,
        stock: { ...machine.stock, hidden: true },
      }).success,
    ).toBe(false);
    expect(
      ConfigResponse.safeParse({
        ...config,
        flags: { ...flags, SPOTLIGHT: true },
      }).success,
    ).toBe(false);
    expect(
      ConfigResponse.safeParse({ ...config, asOfSlot: undefined }).success,
    ).toBe(false);
    expect(
      MeResponse.safeParse({
        ...me,
        deck: [{ ...me.deck[0], asOfSlot: undefined }],
      }).success,
    ).toBe(false);
    expect(
      MachineResponse.safeParse({
        ...machine,
        stock: { ...machine.stock, stockSol: Number(maxU64) },
      }).success,
    ).toBe(false);
  });
  it("requires six widths, four dust records and explicit verification evidence", () => {
    const dust = {
      deckLenBefore: 1,
      index: 0,
      movedFrom: 0,
      mint: publicKey,
      amount: "1",
      depositor: publicKey,
      refund: "0",
    };
    const pack = {
      pack: 0,
      t: 0,
      widths: [0, 0, 0, 0, 0, 0],
      tier: 0,
      hitBucket: 0,
      hitMint: publicKey,
      hitAmount: "0",
      hitValue: "0",
      houseMask: 0,
      dust: Array.from({ length: 4 }, () => dust),
    };
    const check = {
      ok: true,
      complete: true,
      callerSeed: { computed: hex, matches: null },
      packs: [
        {
          pack: 0,
          ok: true,
          t: { computed: 0, matches: true },
          widths: { computed: pack.widths, matches: true },
          tier: { computed: 0, matches: true },
          dust: [{ slot: 0, computed: 0, matches: true }],
          metadataMatches: true,
          hitBucket: { recorded: 0, verified: false },
        },
      ],
    };
    const revealed = {
      ...verify,
      status: "revealed",
      randomness: hex,
      revealedSlot: 1,
      revealOrder: 0,
      revealedTs: 0,
      revealedSig: signature,
      packs: [pack],
      check,
    };
    expect(VerifyResponse.parse(revealed)).toEqual(revealed);
    expect(
      VerifyResponse.safeParse({
        ...revealed,
        packs: [{ ...pack, widths: [0] }],
      }).success,
    ).toBe(false);
    expect(
      VerifyResponse.safeParse({ ...revealed, packs: [{ ...pack, dust: [] }] })
        .success,
    ).toBe(false);
  });
});

describe("signer and value boundaries", () => {
  it("accepts D24 per-bag unavailable evidence without changing the strict error envelope", () => {
    const result = {
      ...feed,
      refused: [
        { mint: publicKey, reason: "evidence_unavailable", date: null },
      ],
    };
    expect(FeedRefusal.parse("evidence_unavailable")).toBe(
      "evidence_unavailable",
    );
    expect(FeedAttestResponse.parse(result)).toEqual(result);
    expect(
      SignerErrorResponse.safeParse({
        reason: "evidence_unavailable",
        asOfSlot: 1,
      }).success,
    ).toBe(false);
  });
  it("uses COPY refusal keys and rejects the replaced mint codes", () => {
    for (const reason of ["not_supported", "mint_forbidden"]) {
      expect(FeedRefusal.parse(reason)).toBe(reason);
      const response = {
        ...feed,
        refused: [{ mint: publicKey, reason, date: null }],
      };
      expect(FeedAttestResponse.parse(response)).toEqual(response);
    }
    for (const reason of ["mint_not_safe", "token_excluded"]) {
      expect(FeedRefusal.safeParse(reason).success).toBe(false);
      expect(
        FeedAttestResponse.safeParse({
          ...feed,
          refused: [{ mint: publicKey, reason, date: null }],
        }).success,
      ).toBe(false);
    }
  });
  it("exports the shared strict signer error contract", () => {
    for (const reason of [
      "indexer_lag",
      "role_mismatch",
      "role_disabled",
      "evidence_unavailable",
      "rate_limited",
      "feed_closed",
    ]) {
      expect(SignerErrorReason.parse(reason)).toBe(reason);
      expect(SignerErrorResponse.parse({ reason })).toEqual({ reason });
    }
    for (const response of [
      {},
      { reason: "unknown" },
      { reason: null },
      { reason: "rate_limited", asOfSlot: 1 },
      { reason: "indexer_lag", details: "private upstream data" },
    ]) {
      expect(SignerErrorResponse.safeParse(response).success).toBe(false);
    }
  });
  it("validates whole-bag request shape and duplicates across chunks", () => {
    const request = { wallet: publicKey, chunks: [[{ mint: publicKey }]] };
    expect(FeedAttestRequest.parse(request)).toEqual(request);
    expect(
      FeedAttestRequest.safeParse({
        ...request,
        chunks: [[{ mint: publicKey }], [{ mint: publicKey }]],
      }).success,
    ).toBe(false);
    expect(
      FeedAttestRequest.safeParse({
        ...request,
        chunks: [[{ mint: publicKey, privateKey: "not-allowed" }]],
      }).success,
    ).toBe(false);
    const bounded = createFeedAttestRequest({
      feedBagsPerTxWithLookupTable: 1,
      txPerSignAll: 1,
    });
    expect(
      bounded.safeParse({
        wallet: publicKey,
        chunks: [[{ mint: publicKey }, { mint: otherKey }]],
      }).success,
    ).toBe(false);
    expect(
      bounded.safeParse({
        wallet: publicKey,
        chunks: [[{ mint: publicKey }], [{ mint: otherKey }]],
      }).success,
    ).toBe(false);
    expect(() =>
      createFeedAttestRequest({
        feedBagsPerTxWithLookupTable: 0,
        txPerSignAll: 1,
      }),
    ).toThrow();
  });
  it("validates Sell back indices and injected config bounds", () => {
    expect(
      SellBackQuoteRequest.parse({ owner: publicKey, cardIndices: [0] })
        .cardIndices,
    ).toEqual([0]);
    expect(
      SellBackQuoteRequest.safeParse({ owner: publicKey, cardIndices: [0, 0] })
        .success,
    ).toBe(false);
    expect(
      SellBackQuoteRequest.safeParse({ owner: publicKey, cardIndices: [65536] })
        .success,
    ).toBe(false);
    expect(
      createSellBackQuoteRequest(1).safeParse({
        owner: publicKey,
        cardIndices: [0, 1],
      }).success,
    ).toBe(false);
  });
  it("validates signer successes and stable refusal branches", () => {
    expect(FeedAttestResponse.parse(feed)).toEqual(feed);
    expect(SellBackQuoteResponse.parse(quote)).toEqual(quote);
    expect(
      SellBackQuoteResponse.parse({
        asOfSlot: 1,
        ok: false,
        reason: "CAP",
      }).ok,
    ).toBe(false);
    expect(
      SellBackQuoteResponse.safeParse({
        asOfSlot: 1,
        ok: false,
        reason: "OTHER",
      }).success,
    ).toBe(false);
    expect(
      FeedAttestResponse.safeParse({ ...feed, asOfSlot: undefined }).success,
    ).toBe(false);
  });
  it("rejects obsolete action hints on Sell refusals", () => {
    expect(
      SellBackQuoteResponse.safeParse({
        asOfSlot: 1,
        ok: false,
        reason: "CAP",
        fallback: "obsolete-route",
      }).success,
    ).toBe(false);
  });
  it("never labels an estimate as executable", () => {
    expect(ValueRequest.parse({ mint: publicKey, amount: maxU64 }).amount).toBe(
      maxU64,
    );
    const value = {
      asOfSlot: 1,
      status: "ok",
      lamports: maxU64,
      capped: true,
      label: "if_sold_now",
    };
    expect(ValueResponse.parse(value)).toEqual(value);
    expect(ValueResponse.safeParse({ ...value, label: "est" }).success).toBe(
      false,
    );
    expect(
      ValueResponse.parse({
        asOfSlot: 1,
        status: "unavailable",
        reason: "CAP_UNAVAILABLE",
      }).status,
    ).toBe("unavailable");
  });
});

describe("SSE contracts", () => {
  it("preserves the indexer payload and anchors observation slot to event id", () => {
    const event = {
      id: "12-1-0",
      event: "feed",
      data: {
        name: "BagFed",
        signature,
        depositor: publicKey,
        mint: publicKey,
        amount: maxU64,
        deck_index: 0,
        deposit: "0",
        fresh_in_deck: 1,
        asOfSlot: 999,
      },
    };
    expect(StreamEvent.parse(event)).toEqual(event);
    expect(decodeStreamEvent(event).data).toEqual({
      ...event.data,
      asOfSlot: 12,
    });
    expect(StreamPing.parse({ asOfSlot: null })).toEqual({ asOfSlot: null });
  });
  it("rejects non-JSON payloads, unknown event names and invalid cursors", () => {
    expect(
      StreamEvent.safeParse({
        id: "1-0-0",
        event: "reveal",
        data: { amount: 1n },
      }).success,
    ).toBe(false);
    expect(
      StreamEvent.safeParse({ id: "1-0-0", event: "unconfirmed", data: {} })
        .success,
    ).toBe(false);
    expect(StreamEventId.safeParse("1-0-0\nid:1").success).toBe(false);
    expect(StreamEventId.safeParse("18446744073709551616-0-0").success).toBe(
      false,
    );
    expect(() =>
      decodeStreamEvent({ id: `${maxU64}-0-0`, event: "feed", data: {} }),
    ).toThrow();
  });
});
