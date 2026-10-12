import { describe, expect, it } from "vitest";
import { createInternalSignerApp, type SignerLimiter } from "./routes.js";
import { createIntakeService } from "../intake/service.js";
import {
  intakeFixture,
  testParams,
  ipHash,
  wallet,
} from "../intake/test-fixtures.js";
import type { QuoteService } from "../quote/index.js";
import {
  SignerErrorResponse,
  FeedAttestResponse,
  SellBackQuoteResponse,
} from "@onepercent/sdk/api";
import { SignerError } from "./error.js";

const token = "a".repeat(40);
const limiter = (): SignerLimiter => {
  const counts = new Map<string, number>();
  return {
    limit: async (key, max) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { ok: count <= max, retryAfterS: count > max ? 17 : 0 };
    },
  };
};
const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const quote: QuoteService = {
  handle: async () => ({
    asOfSlot: 100,
    ok: false,
    reason: "PHASE",
  }),
};

describe("private signer routes", () => {
  it("requires bearer auth and validated hashed IP, exposes only the current role", async () => {
    const f = intakeFixture();
    const app = createInternalSignerApp({
      role: "intake-signer",
      service: createIntakeService(f.options),
      token,
      limiter: limiter(),
      rates: testParams.INTAKE,
    });
    expect(
      (await app.request("/internal/feed/attest", post(f.request))).status,
    ).toBe(401);
    expect(
      (
        await app.request(
          "/internal/feed/attest",
          post(f.request, { authorization: `Bearer ${token}` }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          "/internal/sellback/quote",
          post({ owner: wallet, cardIndices: [0] }),
        )
      ).status,
    ).toBe(404);
    expect(f.signed).toHaveLength(0);
    const valid = await app.request(
      "/internal/feed/attest",
      post(f.request, {
        authorization: `Bearer ${token}`,
        "x-client-ip-hash": ipHash,
      }),
    );
    expect(valid.status).toBe(200);
    expect(FeedAttestResponse.parse(await valid.json()).asOfSlot).toBe(100);
    expect(f.signed).toHaveLength(1);
  });
  it("re-applies per-wallet rate limit; the 31st request gets Retry-After", async () => {
    const app = createInternalSignerApp({
      role: "quote-signer",
      service: quote,
      token,
      limiter: limiter(),
      rates: testParams.INTAKE,
    });
    for (let i = 0; i < 30; i++)
      expect(
        (
          await app.request(
            "/internal/sellback/quote",
            post(
              { owner: wallet, cardIndices: [0] },
              { authorization: `Bearer ${token}`, "x-client-ip-hash": ipHash },
            ),
          )
        ).status,
      ).toBe(200);
    const response = await app.request(
      "/internal/sellback/quote",
      post(
        { owner: wallet, cardIndices: [0] },
        { authorization: `Bearer ${token}`, "x-client-ip-hash": ipHash },
      ),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(SignerErrorResponse.parse(await response.json())).toEqual({
      reason: "rate_limited",
    });
  });
  it("sanitizes unknown failures while preserving role-disabled 503", async () => {
    for (const error of [
      new Error("provider-secret-url"),
      new Error("role_disabled"),
    ]) {
      const app = createInternalSignerApp({
        role: "quote-signer",
        service: {
          handle: async () => {
            throw error;
          },
        },
        token,
        limiter: limiter(),
        rates: testParams.INTAKE,
      });
      const response = await app.request(
        "/internal/sellback/quote",
        post(
          { owner: wallet, cardIndices: [0] },
          { authorization: `Bearer ${token}`, "x-client-ip-hash": ipHash },
        ),
      );
      expect(response.status).toBe(503);
      expect(SignerErrorResponse.parse(await response.json())).toEqual({
        reason:
          error.message === "role_disabled"
            ? "role_disabled"
            : "evidence_unavailable",
      });
    }
  });
  it("validates quote refusals with the S4 contract", async () => {
    const app = createInternalSignerApp({
      role: "quote-signer",
      service: quote,
      token,
      limiter: limiter(),
      rates: testParams.INTAKE,
    });
    const response = await app.request(
      "/internal/sellback/quote",
      post(
        { owner: wallet, cardIndices: [0] },
        { authorization: `Bearer ${token}`, "x-client-ip-hash": ipHash },
      ),
    );
    expect(SellBackQuoteResponse.parse(await response.json())).toEqual({
      asOfSlot: 100,
      ok: false,
      reason: "PHASE",
    });
  });
  it("validates COPY refusals with D22's S4 schema and rejects obsolete keys", async () => {
    const f = intakeFixture();
    f.state.feedOpen = false;
    const app = createInternalSignerApp({
      role: "intake-signer",
      service: createIntakeService(f.options),
      token,
      limiter: limiter(),
      rates: testParams.INTAKE,
    });
    const response = await app.request(
      "/internal/feed/attest",
      post(f.request, {
        authorization: `Bearer ${token}`,
        "x-client-ip-hash": ipHash,
      }),
    );
    const result = FeedAttestResponse.parse(await response.json());
    expect(result.refused[0]?.reason).toBe("feed_closed");
    for (const reason of [
      "not_supported",
      "mint_forbidden",
      "evidence_unavailable",
    ])
      expect(
        FeedAttestResponse.safeParse({
          ...result,
          refused: [{ ...result.refused[0], reason }],
        }).success,
      ).toBe(true);
    for (const reason of ["mint_not_safe", "token_excluded"])
      expect(
        FeedAttestResponse.safeParse({
          ...result,
          refused: [{ ...result.refused[0], reason }],
        }).success,
      ).toBe(false);
  });
  it("returns only the shared reason on 503 and hides slot and internal diagnostics", async () => {
    const app = createInternalSignerApp({
      role: "quote-signer",
      service: {
        handle: async () => {
          throw new SignerError(503, "quote_log_unavailable", undefined, 456);
        },
      },
      token,
      limiter: limiter(),
      rates: testParams.INTAKE,
    });
    const response = await app.request(
      "/internal/sellback/quote",
      post(
        { owner: wallet, cardIndices: [0] },
        { authorization: `Bearer ${token}`, "x-client-ip-hash": ipHash },
      ),
    );
    expect(response.status).toBe(503);
    expect(SignerErrorResponse.parse(await response.json())).toEqual({
      reason: "evidence_unavailable",
    });
  });
});
