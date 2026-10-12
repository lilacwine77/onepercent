import { PublicKey } from "@solana/web3.js";
import {
  FeedAttestResponse,
  FeedRefusal,
  SellBackQuoteResponse,
  SellBackRefusalReason,
  SignerErrorReason,
} from "@onepercent/sdk/api";
import { EvidenceUnavailableError } from "@onepercent/service-kit/intake";
import type { ValueNow, ValueNowResult } from "@onepercent/market";
import { describe, expect, it, vi } from "vitest";
import { createIntakeService } from "../intake/service.js";
import {
  intakeFixture,
  ipHash,
  key,
  mint,
  wallet,
} from "../intake/test-fixtures.js";
import {
  createQuoteService,
  type QuoteServiceOptions,
  type QuoteLogRow,
} from "../quote/service.js";
import {
  decodeBinder,
  decodeMachine,
  decodeQuoteConfig,
  type QuoteState,
} from "../quote/draft-sdk.js";
import quoteAccounts from "../quote/__fixtures__/m1-accounts.json" with { type: "json" };
import { createSignerProxy, PublicHttpError } from "../public/signer.js";
import { settings } from "../public/__fixtures__/settings.js";
import { createInternalSignerApp, type SignerLimiter } from "./routes.js";
import { SignerError } from "./error.js";

const targets = {
  intake: { url: "https://intake.contract.test", token: "a".repeat(32) },
  quote: { url: "https://quote.contract.test", token: "b".repeat(32) },
};

function quoteFixture(reason?: SellBackRefusalReason) {
  const snapshot: QuoteState = {
    asOfSlot: 10,
    ...decodeQuoteConfig(Buffer.from(quoteAccounts.config, "base64")),
    machine: decodeMachine(Buffer.from(quoteAccounts.machine, "base64")),
    binder: decodeBinder(Buffer.from(quoteAccounts.binder, "base64")),
  };
  let value: ValueNowResult = {
    status: "ok",
    lamports: 90_000_000n,
    quoteLamports: 90_000_000n,
    capped: false,
    router: "metis",
    requestId: "contract-order",
    fetchedAtMs: quoteAccounts.blockTime * 1000,
  };
  switch (reason) {
    case "INVALID_INPUT":
      snapshot.binder.cards[0]!.amount = (1n << 64n) - 1n;
      break;
    case "PHASE":
      snapshot.machine.phase = 1;
      break;
    case "KIND":
      snapshot.binder.cards[0]!.kind = 0;
      break;
    case "MINT":
      snapshot.binder.cards[1]!.mint = PublicKey.default.toBase58();
      break;
    case "BUCKET_DISABLED":
      snapshot.machine.buckets[0]!.enabled = false;
      break;
    case "QUOTE_UNAVAILABLE":
      value = { status: "unavailable", reason: "NO_QUOTE" };
      break;
    case "SOL_FLOOR":
      snapshot.machine.stock_sol = 0n;
      break;
    case "HOURLY_BUDGET":
      snapshot.machine.sb_paid_hour = 10_000_000_000n;
      break;
    case "CAP":
      snapshot.machine.buckets[0]!.cap = snapshot.machine.buckets[0]!.cost;
      break;
  }
  const logs: QuoteLogRow[] = [];
  const signed: Uint8Array[] = [];
  const valueNow: ValueNow = async () => value;
  const options: QuoteServiceOptions = {
    programId: new PublicKey(quoteAccounts.programId),
    readState: async () => snapshot,
    blockTimeNow: async () => quoteAccounts.blockTime,
    valueNow,
    guard: { assertAuthorized: () => undefined },
    signer: {
      publicKey: key(3),
      signMessage: (message) => {
        signed.push(message);
        return Buffer.alloc(64, 3);
      },
    },
    appendLog: async (row) => {
      logs.push(row);
    },
  };
  return {
    options,
    logs,
    signed,
    request: { owner: quoteAccounts.owner, cardIndices: [0, 1] },
  };
}

function feedFixture(reason?: FeedRefusal) {
  const f = intakeFixture();
  let request: unknown = f.request;
  const history = f.options.history;
  const sender = key(12).toBase58();
  const decidingDate = new Date((1_800_000_000 - 1000) * 1000).toISOString();
  switch (reason) {
    case "snapshot_not_held":
      f.options.history = async (...args) => ({
        ...(await history(...args)),
        balanceAtS: 0n,
      });
      break;
    case "passed_on":
      f.options.live = async () => ({
        liveCard: null,
        consumption: [
          { holder: wallet, mint, usedBy: sender, date: decidingDate },
        ],
      });
      break;
    case "hop_sender_ineligible":
    case "hop_used":
      f.options.history = async (...args) => {
        const evidence = await history(...args);
        if (args[0] === wallet)
          evidence.first = {
            kind: "transfer",
            sender,
            slot: 60,
            date: decidingDate,
            signature: "transfer",
          };
        return evidence;
      };
      if (reason === "hop_sender_ineligible") f.state.teamWallets = [sender];
      else
        f.options.live = async () => ({
          liveCard: null,
          consumption: [
            {
              holder: sender,
              mint,
              usedBy: key(13).toBase58(),
              date: decidingDate,
            },
          ],
        });
      break;
    case "not_bought":
      f.options.history = async (...args) => ({
        ...(await history(...args)),
        first: {
          kind: "airdrop",
          sender: null,
          slot: 40,
          date: decidingDate,
          signature: "distribution",
        },
      });
      break;
    case "zero_balance": {
      const read = f.options.readBag;
      f.options.readBag = async (...args) => {
        const result = await read(...args);
        if (result.ok) result.bag.amount = 0n;
        return result;
      };
      break;
    }
    case "live_card":
      f.options.live = async () => ({
        liveCard: { date: decidingDate },
        consumption: [],
      });
      break;
    case "team_wallet":
      f.state.teamWallets = [wallet];
      break;
    case "not_whole_bag":
      request = { wallet, chunks: [[{ mint, amount: "999" }]] };
      break;
    case "feed_closed":
      f.state.feedOpen = false;
      break;
    case "fresh_cap":
      f.state.freshInDeck = f.options.params!.FEED_RULES.freshCapPerWallet;
      break;
    case "not_pump_fun":
    case "not_supported":
      f.options.readBag = async (_wallet, _mint, slot) => ({
        ok: false,
        slot,
        reason,
      });
      break;
    case "mint_forbidden":
      f.state.tokenMint = mint;
      break;
    case "evidence_unavailable":
      f.options.history = async () => {
        throw new EvidenceUnavailableError();
      };
      break;
  }
  return { ...f, request };
}

type WireObservation = {
  role: "intake" | "quote";
  status: number;
  body: unknown;
  retryAfter: string | null;
};
function setup(feedReason?: FeedRefusal, quoteReason?: SellBackRefusalReason) {
  const feed = feedFixture(feedReason),
    quote = quoteFixture(quoteReason);
  const limiter: SignerLimiter = {
    limit: async () => ({ ok: true, retryAfterS: 0 }),
  };
  const apps = {
    intake: createInternalSignerApp({
      role: "intake-signer",
      token: targets.intake.token,
      limiter,
      rates: settings.intake,
      service: createIntakeService(feed.options),
    }),
    quote: createInternalSignerApp({
      role: "quote-signer",
      token: targets.quote.token,
      limiter,
      rates: settings.quote,
      service: createQuoteService(quote.options),
    }),
  };
  const observed: WireObservation[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    const role =
      new URL(request.url).hostname === "intake.contract.test"
        ? "intake"
        : "quote";
    const response = await apps[role].fetch(request);
    observed.push({
      role,
      status: response.status,
      body: await response.clone().json(),
      retryAfter: response.headers.get("retry-after"),
    });
    return response;
  });
  const proxy = createSignerProxy({ ...targets, settings, fetch: fetcher });
  const call = (role: "intake" | "quote") =>
    role === "intake"
      ? proxy(role, feed.request, ipHash, FeedAttestResponse)
      : proxy(role, quote.request, ipHash, SellBackQuoteResponse);
  return { feed, quote, limiter, observed, fetcher, call };
}

// Every response below is produced by a real service and private Hono route.
// The public proxy is the S4 implementation, not a schema-only response mock.
describe("S2 services through the S4 signer proxy", () => {
  it.each(["intake", "quote"] as const)(
    "passes a real %s success through the canonical public response schema",
    async (role) => {
      const f = setup();
      const result = await f.call(role);
      expect(result.asOfSlot).toBe(role === "intake" ? f.feed.state.slot : 10);
      expect(f.observed[0]).toMatchObject({
        role,
        status: 200,
        body: result,
        retryAfter: null,
      });
      expect(role === "intake" ? f.feed.rows : f.quote.logs).toHaveLength(1);
      expect(role === "intake" ? f.feed.signed : f.quote.signed).toHaveLength(
        1,
      );
    },
  );

  it.each(FeedRefusal.options)(
    "preserves the actual Feed business refusal %s",
    async (reason) => {
      const f = setup(reason);
      const result = FeedAttestResponse.parse(await f.call("intake"));
      expect(result.refused).toHaveLength(1);
      expect(result.refused[0]).toMatchObject({ mint, reason });
      expect(result.attestations).toHaveLength(0);
      expect(f.observed[0]).toMatchObject({ status: 200, body: result });
      expect(f.feed.rows).toHaveLength(0);
      expect(f.feed.signed).toHaveLength(0);
    },
  );

  it.each(SellBackRefusalReason.options)(
    "preserves the actual Sell back business refusal %s",
    async (reason) => {
      const f = setup(undefined, reason);
      const result = await f.call("quote");
      expect(result).toEqual({
        asOfSlot: 10,
        ok: false,
        reason,
      });
      expect(f.observed[0]).toMatchObject({ status: 200, body: result });
      expect(f.quote.logs).toHaveLength(0);
      expect(f.quote.signed).toHaveLength(0);
    },
  );

  const errorCases = (["intake", "quote"] as const).flatMap((role) =>
    ([429, 503] as const).flatMap((status) =>
      SignerErrorReason.options.map((reason) => ({ role, status, reason })),
    ),
  );
  it.each(errorCases)(
    "preserves $role $status $reason and Retry-After without opening the circuit",
    async ({ role, status, reason }) => {
      const f = setup();
      const guard =
        role === "intake" ? f.feed.options.guard : f.quote.options.guard;
      guard.assertAuthorized = () => {
        throw new SignerError(status, reason, 7);
      };
      const repeat = settings.transport.breakerFailureThreshold + 1;
      for (let i = 0; i < repeat; i++) {
        await expect(f.call(role)).rejects.toMatchObject({
          status,
          code: reason,
          retryAfterS: 7,
        });
        expect(f.observed.at(-1)).toEqual({
          role,
          status,
          body: { reason },
          retryAfter: "7",
        });
      }
      guard.assertAuthorized = () => undefined;
      const result = await f.call(role);
      expect(result.asOfSlot).toBe(role === "intake" ? f.feed.state.slot : 10);
      expect(f.fetcher).toHaveBeenCalledTimes(repeat + 1);
      expect(f.observed.at(-1)?.status).toBe(200);
    },
  );

  it.each(["intake", "quote"] as const)(
    "preserves the real %s wallet limiter response then recovers",
    async (role) => {
      const f = setup();
      f.limiter.limit = async () => ({ ok: false, retryAfterS: 2.1 });
      await expect(f.call(role)).rejects.toBeInstanceOf(PublicHttpError);
      await expect(f.call(role)).rejects.toMatchObject({
        status: 429,
        code: "rate_limited",
        retryAfterS: 3,
      });
      expect(f.observed[0]).toEqual({
        role,
        status: 429,
        body: { reason: "rate_limited" },
        retryAfter: "3",
      });
      f.limiter.limit = async () => ({ ok: true, retryAfterS: 0 });
      expect((await f.call(role)).asOfSlot).toBe(
        role === "intake" ? f.feed.state.slot : 10,
      );
    },
  );

  it.each(["intake", "quote"] as const)(
    "sanitizes an unknown private %s failure into the shared error code",
    async (role) => {
      const f = setup();
      const guard =
        role === "intake" ? f.feed.options.guard : f.quote.options.guard;
      guard.assertAuthorized = () => {
        throw new Error("private provider credential detail");
      };
      await expect(f.call(role)).rejects.toMatchObject({
        status: 503,
        code: "evidence_unavailable",
      });
      expect(f.observed[0]?.body).toEqual({ reason: "evidence_unavailable" });
      expect(JSON.stringify(f.observed)).not.toContain("private provider");
    },
  );
});
