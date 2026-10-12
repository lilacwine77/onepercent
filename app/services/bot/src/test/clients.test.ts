import "./setup.js";
import { describe, expect, it, vi } from "vitest";
import { createXrayClient, XrayError } from "../clients/xray.js";
import { createLinkClient } from "../clients/link.js";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";
import { fixture, ADDRESS, NONCE, TEST_BEARER, harness } from "./harness.js";
import { COPY } from "../copy.js";

describe("offline HTTP ports", () => {
  it.each([undefined, TEST_BEARER])(
    "sends only the configured bearer (%s)",
    async (bearer) => {
      const fetch = vi.fn(async () => new Response(JSON.stringify(fixture)));
      vi.stubGlobal("fetch", fetch);
      expect(
        await createXrayClient("https://api.onepercent.test", bearer).get(
          "alice.sol",
        ),
      ).toEqual(fixture);
      const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
      expect(url.href).toBe("https://api.onepercent.test/api/xray/alice.sol");
      expect(new Headers(init.headers).get("Authorization")).toBe(
        bearer ? `Bearer ${bearer}` : null,
      );
      expect(init.signal).toBeInstanceOf(AbortSignal);
    },
  );
  it.each([400, 404, 403, 429, 500, 502, 504])(
    "maps HTTP %s to a safe command reply",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                error: "turnstile_required",
                message: "upstream detail",
              }),
              { status },
            ),
        ),
      );
      const client = createXrayClient("https://api.onepercent.test");
      const h = harness();
      h.xray.get.mockImplementation(() => client.get(ADDRESS));
      await h.send(`/xray ${ADDRESS}`);
      expect(h.texts()).toEqual([
        status === 400 || status === 404 ? COPY.XRAY_USAGE : COPY.XRAY_BUSY,
      ]);
    },
  );
  it("uses a 12 second deadline and handles timeout without exposing data", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("expired", "TimeoutError");
      }),
    );
    const client = createXrayClient("https://api.onepercent.test");
    await expect(client.get(ADDRESS)).rejects.toMatchObject({ kind: "busy" });
    expect(timeout).toHaveBeenCalledWith(12_000);
  });
  it("detects malformed schemas and logs only the schema marker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ...fixture,
              totals: { sellValueSol: 0.7, rentBackSol: "0" },
            }),
          ),
      ),
    );
    const client = createXrayClient("https://api.onepercent.test");
    await expect(client.get(ADDRESS)).rejects.toBeInstanceOf(XrayError);
    const h = harness();
    h.xray.get.mockImplementation(() => client.get(ADDRESS));
    await h.send(`/xray ${ADDRESS}`);
    expect(h.texts()).toEqual([COPY.XRAY_BUSY]);
    expect(h.logs.join("")).toContain("xray_schema_mismatch");
    expect(h.logs.join("")).not.toContain(ADDRESS);
  });
  it("treats malformed JSON as an upstream schema mismatch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{bad")),
    );
    await expect(
      createXrayClient("https://api.onepercent.test").get(ADDRESS),
    ).rejects.toMatchObject({ kind: "schema" });
  });
  it("validates link responses and never requests a session without the server bearer", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            nonce: NONCE,
            expiresAt: "2026-10-08T12:10:00.000Z",
          }),
          { status: 201 },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const client = createLinkClient("https://api.onepercent.test", TEST_BEARER);
    await expect(client.createNonce(42, "OnepercentTestBot")).resolves.toEqual({
      nonce: NONCE,
      expiresAt: "2026-10-08T12:10:00.000Z",
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/api/link/nonce");
    expect(JSON.parse(String(init.body))).toEqual({
      telegramUserId: 42,
      botUsername: "OnepercentTestBot",
    });
    expect(new Headers(init.headers).get("Authorization")).toBe(
      `Bearer ${TEST_BEARER}`,
    );
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          wallet: ADDRESS,
          linkedAt: "2026-10-08T12:00:00.000Z",
        }),
      ),
    );
    await expect(client.walletOf(42)).resolves.toBe(ADDRESS);
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ wallet: null, linkedAt: null })),
    );
    await expect(client.walletOf(42)).resolves.toBeNull();
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ nonce: "bad" })));
    await expect(client.createNonce(42, "OnepercentTestBot")).rejects.toThrow();
    fetch.mockClear();
    await expect(
      createLinkClient("https://api.onepercent.test").walletOf(42),
    ).rejects.toThrow("link disabled");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("X1 schema contract", () => {
  const bag = {
    mint: ADDRESS,
    symbol: "COIN",
    name: "Coin",
    logoUrl: null,
    amountUi: "123.45",
    decimals: 6,
    tokenProgram: "spl",
    buckets: ["feedable"],
    valueSol: "0.000000001",
  };
  it("requires corrected counts and decimal SOL strings", () => {
    expect(
      XrayResultSchema.safeParse({ ...fixture, bags: [bag] }).success,
    ).toBe(true);
    expect(
      XrayResultSchema.safeParse({
        ...fixture,
        counts: { ...fixture.counts, checkAtFeed: undefined },
      }).success,
    ).toBe(false);
    expect(
      XrayResultSchema.safeParse({
        ...fixture,
        bags: [{ ...bag, valueSol: 1 }],
      }).success,
    ).toBe(false);
  });
  it.each([undefined, "mint_missing", "Not supported", "Another label"])(
    "uses reasonCode alone to permit a missing precision pair (%s)",
    (reason) => {
      const missing = {
        ...bag,
        buckets: ["not_in_set"],
        reason,
        reasonCode: "mint_missing",
        decimals: null,
        amountUi: null,
        valueSol: undefined,
      };
      expect(
        XrayResultSchema.safeParse({ ...fixture, bags: [missing] }).success,
      ).toBe(true);
      for (const invalid of [
        { ...missing, reasonCode: undefined },
        { ...missing, reasonCode: "not_pump_fun" },
        { ...missing, reasonCode: "unknown_reason" },
        { ...missing, buckets: ["feedable"] },
        { ...missing, buckets: ["not_in_set", "feedable"] },
        { ...missing, decimals: 6 },
        { ...missing, amountUi: "123" },
        { ...missing, valueSol: "0" },
      ])
        expect(
          XrayResultSchema.safeParse({ ...fixture, bags: [invalid] }).success,
        ).toBe(false);
    },
  );
  it("rejects display labels as missing-mint evidence", () => {
    for (const reason of ["mint_missing", "Not supported"])
      expect(
        XrayResultSchema.safeParse({
          ...fixture,
          bags: [{ ...bag, reason, amountUi: null, decimals: null }],
        }).success,
      ).toBe(false);
  });
});
