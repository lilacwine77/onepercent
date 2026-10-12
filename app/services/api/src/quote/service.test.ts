import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import { RoleGuard, RoleKey } from "@onepercent/service-kit";
import { MARKET, SERVICES } from "@onepercent/config";
import type { ValueNow, ValueNowResult } from "@onepercent/market";
import { describe, expect, it, vi } from "vitest";
import { SellBackQuoteResponse as PublicSellBackQuoteResponse } from "@onepercent/sdk/api";
import {
  createQuoteStateReader,
  createQuoteValueClient,
  createQuoteLogWriter,
} from "./adapters.js";
import {
  attestationExpiry,
  decodeBinder,
  decodeMachine,
  decodeQuoteConfig,
  rotateHour,
  type QuoteState,
} from "./draft-sdk.js";
import { checkedSellBackEncoder, sellBackMessageVectors } from "./encoder.js";
import {
  createQuoteService,
  type QuoteLogRow,
  type QuoteServiceOptions,
} from "./service.js";
import {
  sellBackQuoteRequestSchema,
  sellBackQuoteResponseSchema,
  U64_MAX,
} from "./schema.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("./__fixtures__/m1-accounts.json", import.meta.url),
    "utf8",
  ),
) as {
  programId: string;
  owner: string;
  mint: string;
  blockTime: number;
  config: string;
  machine: string;
  binder: string;
};
const programId = new PublicKey(fixture.programId),
  owner = new PublicKey(fixture.owner),
  mint = new PublicKey(fixture.mint);
const ipHash = "a".repeat(64);

function state(): QuoteState {
  return {
    asOfSlot: 10,
    ...decodeQuoteConfig(Buffer.from(fixture.config, "base64")),
    machine: decodeMachine(Buffer.from(fixture.machine, "base64")),
    binder: decodeBinder(Buffer.from(fixture.binder, "base64")),
  };
}
const liveValue = (): ValueNowResult => ({
  status: "ok",
  lamports: 90_000_000n,
  quoteLamports: 90_000_000n,
  capped: false,
  router: "metis",
  requestId: "recorded-order",
  fetchedAtMs: 1_800_000_030_000,
});
function setup() {
  const snapshot = state();
  const log: QuoteLogRow[] = [];
  const signMessage = vi.fn<(message: Uint8Array) => Uint8Array>(() =>
    Buffer.alloc(64, 3),
  );
  const readState = vi.fn(async () => snapshot);
  const blockTimeNow = vi.fn(async () => fixture.blockTime);
  const valueNow = vi.fn<ValueNow>(async () => liveValue());
  const appendLog = vi.fn(async (row: QuoteLogRow) => {
    log.push(row);
  });
  const guard = { assertAuthorized: vi.fn() };
  const options: QuoteServiceOptions = {
    programId,
    readState,
    blockTimeNow,
    valueNow,
    guard,
    signer: { publicKey: new PublicKey(Buffer.alloc(32, 3)), signMessage },
    appendLog,
  };
  return {
    snapshot,
    log,
    signMessage,
    readState,
    blockTimeNow,
    valueNow,
    appendLog,
    guard,
    options,
    service: createQuoteService(options),
  };
}
const request = { owner: owner.toBase58(), cardIndices: [0, 1] };

describe("S2 Sell back signing", () => {
  it("D22 validates success and refusal against the shared S4 contract at the final live slot", async () => {
    expect(sellBackQuoteResponseSchema).toBe(PublicSellBackQuoteResponse);
    const test = setup();
    test.readState
      .mockResolvedValueOnce({ ...state(), asOfSlot: 10 })
      .mockResolvedValueOnce({ ...state(), asOfSlot: 12 });
    const result = await test.service.handle(request, ipHash);
    expect(result.ok).toBe(true);
    expect(result.asOfSlot).toBe(12);
    expect(PublicSellBackQuoteResponse.parse(result)).toEqual(result);
    expect(test.valueNow).toHaveBeenCalledOnce();
    const blocked = setup();
    blocked.snapshot.machine.phase = 1;
    const refusal = await blocked.service.handle(request, ipHash);
    expect(refusal).toMatchObject({ ok: false, asOfSlot: 10, reason: "PHASE" });
    expect(PublicSellBackQuoteResponse.parse(refusal)).toEqual(refusal);
  });
  it("checks SELLBACK pause before the provider call and again before signing", async () => {
    const paused = setup();
    paused.snapshot.sellBackPaused = true;
    expect(await paused.service.handle(request, ipHash)).toEqual({
      ok: false,
      asOfSlot: 10,
      reason: "PHASE",
    });
    expect(paused.valueNow).not.toHaveBeenCalled();
    expect(paused.signMessage).not.toHaveBeenCalled();
    const later = setup();
    later.readState.mockResolvedValueOnce(state()).mockResolvedValueOnce({
      ...state(),
      asOfSlot: 12,
      sellBackPaused: true,
    });
    expect(await later.service.handle(request, ipHash)).toEqual({
      ok: false,
      asOfSlot: 12,
      reason: "PHASE",
    });
    expect(later.valueNow).toHaveBeenCalledOnce();
    expect(later.appendLog).not.toHaveBeenCalled();
    expect(later.signMessage).not.toHaveBeenCalled();
  });
  it("rechecks final budgets and changed batch totals without another provider quote", async () => {
    for (const changed of ["budget", "amount"] as const) {
      const test = setup(),
        final = state();
      final.asOfSlot = 12;
      if (changed === "budget") final.machine.sb_paid_hour = 10_000_000_000n;
      else final.binder.cards[0]!.amount += 1n;
      test.readState
        .mockResolvedValueOnce(state())
        .mockResolvedValueOnce(final);
      expect(await test.service.handle(request, ipHash)).toEqual({
        ok: false,
        asOfSlot: 12,
        reason: changed === "budget" ? "HOURLY_BUDGET" : "QUOTE_UNAVAILABLE",
      });
      expect(test.valueNow).toHaveBeenCalledOnce();
      expect(test.appendLog).not.toHaveBeenCalled();
      expect(test.signMessage).not.toHaveBeenCalled();
    }
  });
  it("does not lengthen a market quote while re-reading final live state", async () => {
    const test = setup();
    test.blockTimeNow
      .mockResolvedValueOnce(fixture.blockTime)
      .mockResolvedValueOnce(fixture.blockTime + 51);
    expect(await test.service.handle(request, ipHash)).toMatchObject({
      ok: false,
      asOfSlot: 10,
      reason: "QUOTE_UNAVAILABLE",
    });
    expect(test.signMessage).not.toHaveBeenCalled();
  });
  it("attaches the final slot to post-read errors and validates output before signing", async () => {
    const test = setup();
    test.readState
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce({ ...state(), asOfSlot: 12 });
    test.appendLog.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(test.service.handle(request, ipHash)).rejects.toMatchObject({
      reason: "quote_log_unavailable",
      asOfSlot: 12,
    });
    const malformed = setup();
    const live = liveValue();
    if (live.status === "ok") live.requestId = "";
    malformed.valueNow.mockResolvedValue(live);
    await expect(
      malformed.service.handle(request, ipHash),
    ).rejects.toMatchObject({ reason: "signer_unavailable", asOfSlot: 10 });
    expect(malformed.appendLog).not.toHaveBeenCalled();
    expect(malformed.signMessage).not.toHaveBeenCalled();
  });
  it("loads M1 SDK-generated account bytes and reads only chain card fields", async () => {
    const test = setup();
    const result = await test.service.handle(request, ipHash);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote).toMatchObject({
      cards: [
        { index: 1, amount: "2000" },
        { index: 0, amount: "1000" },
      ],
      totalAmount: "3000",
      quoteLamports: "90000000",
      stockedValueLamports: "100000000",
      valueLamports: "90000000",
      payoutLamports: "78300000",
      nonce: 7,
      bucketClass: "MAJOR",
      expiry: fixture.blockTime + 50,
    });
    expect(test.readState).toHaveBeenCalledWith(owner);
    expect(test.valueNow).toHaveBeenCalledExactlyOnceWith(
      mint.toBase58(),
      3000n,
    );
    expect(test.guard.assertAuthorized).toHaveBeenCalledTimes(3);
    expect(test.log[0]).toMatchObject({
      cardIndices: [1, 0],
      amounts: [2000n, 1000n],
      expiry: new Date((fixture.blockTime + 50) * 1000),
      ipHash,
    });
    expect(test.log[0]!.messageSha256).toBe(
      createHash("sha256")
        .update(Buffer.from(result.quote.message, "base64"))
        .digest("hex"),
    );
    expect(test.appendLog.mock.invocationCallOrder[0]).toBeLessThan(
      test.signMessage.mock.invocationCallOrder[0]!,
    );
    expect(sellBackQuoteResponseSchema.safeParse(result).success).toBe(true);
  });
  it.each(sellBackMessageVectors)(
    "checks the brief SB vector with $length bytes",
    (vector) => {
      const input = {
        programId: new PublicKey(Buffer.alloc(32)),
        owner: new PublicKey(Buffer.alloc(32, 1)),
        mint: new PublicKey(Buffer.alloc(32, 2)),
        cards: vector.cards,
        totalAmount: vector.totalAmount,
        nonce: vector.nonce,
        quoteLamports: 5_000_000n,
        expiry: 1_800_000_000n,
      };
      const message = checkedSellBackEncoder()(input);
      expect(message).toHaveLength(vector.length);
      expect(createHash("sha256").update(message).digest("hex")).toBe(
        vector.sha256,
      );
      expect(() =>
        checkedSellBackEncoder(() => Buffer.alloc(vector.length)),
      ).toThrow("sb_encoder_vector_mismatch");
    },
  );
  it("uses the canonical SDK encoder without runtime injection", async () => {
    const test = setup();
    const result = await test.service.handle(request, ipHash);
    expect(result.ok).toBe(true);
    expect(test.signMessage).toHaveBeenCalledOnce();
    if (!result.ok) throw new Error("Expected a signed quote");
    expect(test.signMessage).toHaveBeenCalledWith(
      Buffer.from(result.quote.message, "base64"),
    );
  });
  it("does no work for an already abandoned request", async () => {
    const test = setup();
    await expect(
      test.service.handle(request, ipHash, AbortSignal.abort()),
    ).rejects.toThrow("request_aborted");
    expect(test.readState).not.toHaveBeenCalled();
    expect(test.valueNow).not.toHaveBeenCalled();
    expect(test.appendLog).not.toHaveBeenCalled();
    expect(test.signMessage).not.toHaveBeenCalled();
  });
  it("does not log or sign when a quote finishes after cancellation", async () => {
    const test = setup();
    const controller = new AbortController();
    let release!: (value: ValueNowResult) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    test.valueNow.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
          entered();
        }),
    );
    const pending = test.service.handle(request, ipHash, controller.signal);
    await started;
    controller.abort();
    release(liveValue());
    await expect(pending).rejects.toThrow("request_aborted");
    expect(test.appendLog).not.toHaveBeenCalled();
    expect(test.signMessage).not.toHaveBeenCalled();
  });
  it("does not sign when cancellation arrives during the log insert", async () => {
    const test = setup();
    const controller = new AbortController();
    test.appendLog.mockImplementationOnce(async () => {
      controller.abort();
    });
    await expect(
      test.service.handle(request, ipHash, controller.signal),
    ).rejects.toThrow("request_aborted");
    expect(test.signMessage).not.toHaveBeenCalled();
  });
  it("uses confirmed block time when the host is 30 seconds ahead and gives TRENDING its shorter TTL", async () => {
    const test = setup();
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue((fixture.blockTime + 30) * 1000);
    try {
      test.snapshot.machine.buckets[0]!.class = 2;
      const result = await test.service.handle(request, ipHash);
      expect(result.ok && result.quote.expiry).toBe(fixture.blockTime + 10);
    } finally {
      now.mockRestore();
    }
  });
  it("rotates all hour fields before X2 checks and does not mutate the read snapshot", async () => {
    const test = setup();
    test.snapshot.machine.hour_index -= 1n;
    test.snapshot.machine.sb_paid_hour = U64_MAX;
    test.snapshot.machine.sol_at_hour_start = 0n;
    const result = await test.service.handle(request, ipHash);
    expect(result.ok).toBe(true);
    expect(test.snapshot.machine.sb_paid_hour).toBe(U64_MAX);
    const rotated = rotateHour(
      test.snapshot.machine,
      BigInt(fixture.blockTime),
    );
    expect(rotated.hit_out_last_hour).toBe(2_000_000_000n);
    expect(rotated.sol_at_hour_start).toBe(test.snapshot.machine.stock_sol);
    expect(
      rotateHour(test.snapshot.machine, BigInt(fixture.blockTime + 3600))
        .hit_out_last_hour,
    ).toBe(0n);
  });
  it.each([
    [
      "INVALID_INPUT",
      (s: ReturnType<typeof setup>) => {
        s.snapshot.binder.cards[0]!.amount = U64_MAX;
      },
    ],
    [
      "PHASE",
      (s: ReturnType<typeof setup>) => {
        s.snapshot.machine.phase = 1;
      },
    ],
    [
      "KIND",
      (s: ReturnType<typeof setup>) => {
        s.snapshot.binder.cards[0]!.kind = 0;
      },
    ],
    [
      "MINT",
      (s: ReturnType<typeof setup>) => {
        s.snapshot.binder.cards[1]!.mint = PublicKey.default.toBase58();
      },
    ],
    [
      "BUCKET_DISABLED",
      (s: ReturnType<typeof setup>) => {
        s.snapshot.machine.buckets[0]!.enabled = false;
      },
    ],
    [
      "QUOTE_UNAVAILABLE",
      (s: ReturnType<typeof setup>) => {
        s.valueNow.mockResolvedValue({
          status: "unavailable",
          reason: "NO_QUOTE",
        });
      },
    ],
    [
      "SOL_FLOOR",
      (s: ReturnType<typeof setup>) => {
        s.snapshot.machine.stock_sol = 0n;
      },
    ],
    [
      "HOURLY_BUDGET",
      (s: ReturnType<typeof setup>) => {
        s.snapshot.machine.sb_paid_hour = 10_000_000_000n;
      },
    ],
    [
      "CAP",
      (s: ReturnType<typeof setup>) => {
        s.snapshot.machine.buckets[0]!.cap =
          s.snapshot.machine.buckets[0]!.cost;
      },
    ],
  ] as const)(
    "returns X2 %s without an action hint, signing or inserting",
    async (reason, change) => {
      const test = setup();
      change(test);
      expect(await test.service.handle(request, ipHash)).toEqual({
        asOfSlot: 10,
        ok: false,
        reason,
      });
      expect(test.signMessage).not.toHaveBeenCalled();
      expect(test.appendLog).not.toHaveBeenCalled();
    },
  );
  it("refuses the program's zero-payout edge case", async () => {
    const test = setup();
    test.snapshot.binder.cards[0]!.value = 1n;
    expect(
      await test.service.handle({ ...request, cardIndices: [0] }, ipHash),
    ).toEqual({
      asOfSlot: 10,
      ok: false,
      reason: "INVALID_INPUT",
    });
    expect(test.signMessage).not.toHaveBeenCalled();
  });
  it.each([
    { ...request, quoteLamports: "999999999" },
    { ...request, cardIndices: [0, 0] },
    { ...request, cardIndices: Array.from({ length: 9 }, (_, i) => i) },
  ])(
    "rejects client amounts, duplicate indices, and oversized batches",
    async (invalid) => {
      const test = setup();
      expect(sellBackQuoteRequestSchema.safeParse(invalid).success).toBe(false);
      await expect(test.service.handle(invalid, ipHash)).rejects.toThrow(
        "invalid_request",
      );
      expect(test.readState).not.toHaveBeenCalled();
    },
  );
  it("cannot sign an absent or moved card", async () => {
    const test = setup();
    expect(
      await test.service.handle({ ...request, cardIndices: [30] }, ipHash),
    ).toMatchObject({ ok: false, reason: "INVALID_INPUT" });
    test.snapshot.binder.owner = PublicKey.default.toBase58();
    await expect(test.service.handle(request, ipHash)).rejects.toThrow(
      "chain_unavailable",
    );
    expect(test.signMessage).not.toHaveBeenCalled();
  });
  it("does not sign on log failure or a guard revocation during the insert", async () => {
    const test = setup();
    test.appendLog.mockRejectedValueOnce(new Error("db unavailable"));
    await expect(test.service.handle(request, ipHash)).rejects.toThrow(
      "quote_log_unavailable",
    );
    expect(test.signMessage).not.toHaveBeenCalled();
    test.appendLog.mockImplementationOnce(async () => {
      test.guard.assertAuthorized.mockImplementation(() => {
        throw new Error("role_disabled");
      });
    });
    await expect(test.service.handle(request, ipHash)).rejects.toThrow(
      "role_disabled",
    );
    expect(test.signMessage).not.toHaveBeenCalled();
  });
  it("signs an Ed25519 message with the S0 guarded role signer", async () => {
    const test = setup();
    const key = new RoleKey(Keypair.generate());
    const guard = new RoleGuard({
      role: "quote-signer",
      publicKey: key.publicKey,
      recheckSeconds: 60,
      readConfig: async () => ({
        disabledRoles: 0,
        addresses: {
          keeper: PublicKey.default,
          executor: PublicKey.default,
          "intake-signer": PublicKey.default,
          "quote-signer": key.publicKey,
        },
      }),
    });
    key.bind(guard);
    await guard.refresh();
    try {
      const result = await createQuoteService({
        ...test.options,
        guard,
        signer: key,
      }).handle(request, ipHash);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const publicKey = createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          key.publicKey.toBuffer(),
        ]),
        format: "der",
        type: "spki",
      });
      expect(
        verify(
          null,
          Buffer.from(result.quote.message, "base64"),
          publicKey,
          Buffer.from(result.quote.signature, "base64"),
        ),
      ).toBe(true);
    } finally {
      key.destroy();
    }
  });
});

describe("S2 production adapters", () => {
  it("reads the canonical Binder and Machine together at confirmed", async () => {
    const requestRpc = vi.fn(async (_method, _params, schema) =>
      schema.parse({
        context: { slot: 10 },
        value: [fixture.config, fixture.machine, fixture.binder].map(
          (data) => ({
            owner: programId.toBase58(),
            executable: false,
            data: [data, "base64"],
          }),
        ),
      }),
    );
    const read = createQuoteStateReader({ request: requestRpc }, programId);
    expect(await read(owner)).toEqual(state());
    expect(requestRpc.mock.calls[0]![0]).toBe("getMultipleAccounts");
    expect(requestRpc.mock.calls[0]![1]).toEqual([
      [
        PublicKey.findProgramAddressSync(
          [Buffer.from("config")],
          programId,
        )[0].toBase58(),
        PublicKey.findProgramAddressSync(
          [Buffer.from("machine")],
          programId,
        )[0].toBase58(),
        PublicKey.findProgramAddressSync(
          [Buffer.from("binder"), owner.toBuffer()],
          programId,
        )[0].toBase58(),
      ],
      { commitment: "confirmed", encoding: "base64" },
    ]);
  });
  it("rejects foreign account ownership, altered bump, and a different Binder owner", async () => {
    for (const corruption of ["owner", "bump", "binder_owner"] as const) {
      const data = Buffer.from(fixture.binder, "base64");
      if (corruption === "bump") data[110] = data[110]! ^ 1;
      if (corruption === "binder_owner") data.fill(9, 8, 40);
      const requestRpc = vi.fn(async (_method, _params, schema) =>
        schema.parse({
          context: { slot: 10 },
          value: [
            {
              owner: programId.toBase58(),
              executable: false,
              data: [fixture.config, "base64"],
            },
            {
              owner: programId.toBase58(),
              executable: false,
              data: [fixture.machine, "base64"],
            },
            {
              owner:
                corruption === "owner" ? mint.toBase58() : programId.toBase58(),
              executable: false,
              data: [data.toString("base64"), "base64"],
            },
          ],
        }),
      );
      await expect(
        createQuoteStateReader({ request: requestRpc }, programId)(owner),
      ).rejects.toThrow("chain_unavailable");
    }
  });
  it("uses the private Jupiter key for one /order of the total, with real cap reads", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      return Response.json({
        inAmount: "3000",
        outAmount: "90000000",
        otherAmountThreshold: "89000000",
        inputMint: mint.toBase58(),
        router: "metis",
        requestId: "fixture-order",
        feeBps: 0,
        priceImpact: "0.01",
        routePlan: [],
      });
    };
    const requestRpc = vi.fn(async (_method, _params, schema) =>
      schema.parse({ context: { slot: 10 }, value: null }),
    );
    const valueNow = createQuoteValueClient({
      env: {
        jupiterApiKey: "quote-fixture-credential",
        pythHermesUrl: MARKET.pyth.defaultHermesUrl,
      },
      fetch: fetcher,
      rpc: { request: requestRpc },
    });
    const test = setup();
    expect(
      (
        await createQuoteService({ ...test.options, valueNow }).handle(
          request,
          ipHash,
        )
      ).ok,
    ).toBe(true);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).pathname).toBe("/swap/v2/order");
    expect(new URL(calls[0]!.url).searchParams.get("amount")).toBe("3000");
    expect(calls[0]!.headers.get("x-api-key")).toBe("quote-fixture-credential");
    expect(requestRpc.mock.calls[0]![0]).toBe("getAccountInfo");
    expect(() =>
      createQuoteValueClient({
        env: { pythHermesUrl: MARKET.pyth.defaultHermesUrl },
        fetch: fetcher,
        rpc: { request: requestRpc },
      }),
    ).toThrow("quote_jupiter_key_unavailable");
  });
  it("only inserts immutable quote rows, with an idempotent message hash conflict", async () => {
    const test = setup();
    await test.service.handle(request, ipHash);
    const conflict = vi.fn(async () => undefined);
    const values = vi.fn(() => ({ onConflictDoNothing: conflict }));
    const insert = vi.fn(() => ({ values }));
    const writer = createQuoteLogWriter({ insert } as unknown as Parameters<
      typeof createQuoteLogWriter
    >[0]);
    await writer(test.log[0]!);
    await writer(test.log[0]!);
    expect(values).toHaveBeenCalledTimes(2);
    expect(values).toHaveBeenCalledWith({
      ...test.log[0]!,
      nonce: BigInt(test.log[0]!.nonce),
    });
    expect(conflict).toHaveBeenCalledTimes(2);
    await expect(writer({ ...test.log[0]!, amounts: [1n] })).rejects.toThrow();
    expect(insert).toHaveBeenCalledTimes(2);
  });
  it("opens the quote provider circuit after the configured failure limit", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: "No route", errorCode: "COULD_NOT_FIND_ANY_ROUTE" },
        { status: 400 },
      ),
    );
    const requestRpc = vi.fn(async (_method, _params, schema) =>
      schema.parse({ context: { slot: 10 }, value: null }),
    );
    const valueNow = createQuoteValueClient({
      env: {
        jupiterApiKey: "quote-fixture-credential",
        pythHermesUrl: MARKET.pyth.defaultHermesUrl,
      },
      fetch: fetcher,
      rpc: { request: requestRpc },
    });
    for (
      let attempt = 0;
      attempt <= SERVICES.transport.breakerFailureThreshold;
      attempt++
    )
      expect((await valueNow(mint.toBase58(), 3000n)).status).toBe(
        "unavailable",
      );
    expect(fetcher).toHaveBeenCalledTimes(
      SERVICES.transport.breakerFailureThreshold,
    );
  });
  it("rejects corrupt draft account data and preserves the SDK expiry contract", () => {
    expect(() => decodeMachine(Buffer.alloc(3808))).toThrow(
      "machine_unavailable",
    );
    expect(() =>
      decodeBinder(Buffer.from(fixture.binder, "base64").subarray(0, 113)),
    ).toThrow("binder_unavailable");
    const bad = Buffer.from(fixture.binder, "base64");
    bad.writeUInt16LE(4, 104);
    expect(() => decodeBinder(bad)).toThrow("binder_unavailable");
    expect(attestationExpiry(1_800_000_000n, 60)).toBe(1_800_000_050n);
    for (const offset of [740, 741]) {
      const config = Buffer.from(fixture.config, "base64");
      config[offset] = 4;
      expect(decodeQuoteConfig(config).sellBackPaused).toBe(true);
    }
    expect(() => decodeQuoteConfig(Buffer.alloc(872))).toThrow(
      "config_unavailable",
    );
  });
});
