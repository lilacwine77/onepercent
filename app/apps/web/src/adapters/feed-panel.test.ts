// @vitest-environment node
import { Buffer } from "node:buffer";
import { afterEach, expect, it, vi } from "vitest";
import { FEED_RULES } from "@onepercent/config";
import { WEB } from "@onepercent/config/web";
import { t } from "@onepercent/copy";
import { classifyWallet, XrayResultSchema } from "@onepercent/eligibility";
import { AccountLayout, AccountState } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { PHASE } from "@onepercent/sdk";
import {
  analyzeWalletHistory,
  evaluateFeedProvenance,
} from "../../../../packages/service-kit/src/intake/provenance";
import type { IntakeTransaction } from "../../../../packages/service-kit/src/intake/types";
import mintFixture from "../../../../packages/eligibility/fixtures/mainnet/no-suffix.json";
import curveFixture from "../../../../packages/eligibility/fixtures/mainnet/no-suffix-curve.json";
import xrayFixture from "../xray/__fixtures__/result.json";
import {
  emptyFeedDisplay,
  type FeedDisplay,
  type FeedWallet,
} from "../data/feed";
import { feedGate, feedRows, refusalMessage } from "./feed-panel";

const mint = Keypair.generate().publicKey;
function snapshot(fresh = 0): FeedWallet {
  return {
    core: {
      binder: { fresh_in_deck: fresh },
      machine: { phase: PHASE.stockUp, end_ts: 0n },
      config: {
        season_set: 1,
        stock_up_ts: 0n,
        admin_paused: 0,
        guardian_paused: 0,
      },
      blockTime: 1,
    },
    inventory: {
      bags: [{ mint, amount: 10n, decimals: 0, feedable: true }],
      emptyAccounts: [],
      slot: 1,
    },
  } as unknown as FeedWallet;
}
function display(lamports = FEED_RULES.confirmAboveLamports + 1n): FeedDisplay {
  return {
    ...emptyFeedDisplay,
    quotedAt: Date.now(),
    values: [
      {
        mint: mint.toBase58(),
        amount: 10n,
        decimals: 0,
        symbol: "DUST",
        name: "Dust",
        logo: null,
        value: { status: "ok", lamports, capped: false, label: "if_sold_now" },
      },
    ],
  };
}
const rows = (
  value: FeedDisplay,
  input = snapshot(),
  unchecked = new Set<string>(),
) =>
  feedRows({
    snapshot: input,
    display: value,
    unchecked,
    confirmed: new Set(),
    refused: new Map(),
  });
afterEach(() => vi.restoreAllMocks());

it("defaults eligible bags on, retains a single Feed choice, and requires high-value consent", () => {
  expect(rows(display())[0]).toMatchObject({
    feed: true,
    needsConfirm: true,
    confirmed: false,
    canFeed: { open: true },
  });
  expect(rows(display(), snapshot(), new Set([mint.toBase58()]))[0]!.feed).toBe(
    false,
  );
  expect(
    rows(display(), snapshot(FEED_RULES.freshCapPerWallet))[0],
  ).toMatchObject({
    feed: false,
    canFeed: { open: false, reason: { key: "feed.capReached" } },
  });
});

it("never presents a stale, changed-amount or estimate quote as executable", () => {
  const value = display();
  vi.spyOn(Date, "now").mockReturnValue(
    value.quotedAt + WEB.configRefreshMs + 1,
  );
  expect(rows(value)[0]!.value).toEqual({ kind: "none" });
  vi.restoreAllMocks();
  value.values[0]!.amount = 11n;
  expect(rows(value)[0]!.value).toEqual({ kind: "none" });
  value.values[0]!.amount = 10n;
  value.values[0]!.value = {
    status: "ok",
    label: "est",
    lamports: 1n,
    capped: true,
  };
  expect(rows(value)[0]!.value).toEqual({ kind: "none" });
});

it("disables Feed independently of chain-rendered exits", () => {
  const active = snapshot();
  active.core = {
    ...active.core!,
    config: { ...active.core!.config, stock_up_ts: 1n },
    machine: { ...active.core!.machine, phase: PHASE.onAir },
  };
  expect(feedGate(active, false)).toEqual({
    open: false,
    reason: { key: "feed.phase.paused" },
  });
  const setup = snapshot();
  setup.core = {
    ...setup.core!,
    machine: { ...setup.core!.machine, phase: PHASE.setup },
  };
  expect(feedGate(setup, false)).toEqual({
    open: false,
    reason: { key: "feed.phase.beforeUndated" },
  });
  const ended = snapshot();
  ended.core = {
    ...ended.core!,
    machine: { ...ended.core!.machine, phase: PHASE.buysClosed },
  };
  expect(feedGate(ended, true)).toEqual({
    open: false,
    reason: { key: "feed.phase.over" },
  });
});

function oneHop() {
  const sender = Keypair.generate().publicKey.toBase58();
  const recipient = Keypair.generate().publicKey;
  const destination = Keypair.generate().publicKey.toBase58();
  const source = Keypair.generate().publicKey.toBase58();
  const id = mintFixture.address;
  const purchased = {
    account: source,
    accountIndex: 1,
    owner: sender,
    mint: id,
    amount: 10n,
  };
  const purchase: IntakeTransaction = {
    signature: "purchase",
    slot: 10,
    transactionIndex: 0,
    blockTime: null,
    signers: [sender],
    feePayer: sender,
    fee: 1n,
    lamports: new Map([[sender, { pre: 100n, post: 89n }]]),
    preTokenBalances: [],
    postTokenBalances: [purchased],
    creationCosts: new Map(),
  };
  const transfer: IntakeTransaction = {
    ...purchase,
    signature: "transfer",
    slot: 30,
    preTokenBalances: [purchased],
    postTokenBalances: [
      {
        ...purchased,
        account: destination,
        accountIndex: 2,
        owner: recipient.toBase58(),
      },
    ],
  };
  const history = (wallet: string, transactions: IntakeTransaction[]) =>
    analyzeWalletHistory({
      wallet,
      mint: id,
      snapshotSlot: 20,
      transactions,
      complete: true,
    });
  const provenance = {
    wallet: recipient.toBase58(),
    mint: id,
    snapshotSlot: 20,
    snapshotDate: null,
    balanceNow: 10n,
    history: history(recipient.toBase58(), [transfer]),
    senderHistory: history(sender, [purchase, transfer]),
    teamWallets: [],
    consumption: [],
    liveCard: null,
  };
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      mint: new PublicKey(id),
      owner: recipient,
      amount: 10n,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: AccountState.Initialized,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  );
  const raw = (fixture: typeof mintFixture) => ({
    address: fixture.address,
    owner: fixture.owner,
    lamports: BigInt(fixture.lamports),
    data: Buffer.from(fixture.dataBase64, "base64"),
  });
  const classified = classifyWallet({
    owner: recipient.toBase58(),
    tokenAccounts: [
      { address: destination, owner: mintFixture.owner, lamports: 1n, data },
    ],
    mints: new Map([[id, raw(mintFixture)]]),
    curves: new Map([[id, raw(curveFixture)]]),
    prices: {},
    solUsd: 0,
    slotS: provenance.snapshotSlot,
    snapshot: new Map([[id, { balanceAtS: provenance.history.balanceAtS }]]),
  }).bags[0]!;
  const value: FeedDisplay = {
    ...emptyFeedDisplay,
    xray: XrayResultSchema.parse({
      ...xrayFixture,
      address: recipient.toBase58(),
      bags: [
        {
          mint: id,
          symbol: "DUST",
          name: "Dust",
          logoUrl: null,
          amountUi: "0.00001",
          decimals: classified.decimals,
          tokenProgram: classified.tokenProgram,
          buckets: classified.buckets,
          reasonCode: classified.reason,
        },
      ],
    }),
  };
  const active = snapshot();
  active.inventory.bags[0]!.mint = new PublicKey(id);
  active.inventory.bags[0]!.decimals = classified.decimals;
  return { sender, provenance, classified, value, active };
}

it("lets the real intake decide an eligible one-hop recipient absent at the snapshot", () => {
  const { sender, provenance, classified, value, active } = oneHop();
  expect(provenance.history.balanceAtS).toBe(0n);
  expect(provenance.senderHistory.balanceAtS).toBe(10n);
  expect(classified).toMatchObject({
    buckets: ["not_feedable_season"],
    reason: "snapshot_not_held",
  });
  expect(evaluateFeedProvenance(provenance)).toEqual({
    eligible: true,
    path: "hop",
    via: sender,
    holder: sender,
  });
  const row = rows(value, active)[0]!;
  expect(row).toMatchObject({
    feed: true,
    canFeed: { open: true, reason: null },
    note: { key: "feed.row.checkAtFeed" },
  });
  expect(t("feed.row.checkAtFeed")).toBe(t("xray.reason.snapshot_at_feed"));
});

it.each(["late_purchase", "hop_used", "live_card"] as const)(
  "keeps the real intake's %s refusal authoritative after the final check",
  (reason) => {
    const { sender, provenance, value, active } = oneHop();
    const result = evaluateFeedProvenance({
      ...provenance,
      ...(reason === "late_purchase"
        ? {
            history: {
              ...provenance.history,
              first: {
                ...provenance.history.first!,
                kind: "swap" as const,
                sender: null,
              },
            },
          }
        : reason === "hop_used"
          ? {
              consumption: [
                {
                  holder: sender,
                  mint: provenance.mint,
                  usedBy: Keypair.generate().publicKey.toBase58(),
                  date: null,
                },
              ],
            }
          : { liveCard: { date: null } }),
    });
    expect(result.eligible).toBe(false);
    if (result.eligible) throw new Error("Expected an intake refusal");
    const refused = refusalMessage(result.reason, result.date);
    expect(
      feedRows({
        snapshot: active,
        display: value,
        unchecked: new Set(),
        confirmed: new Set(),
        refused: new Map([[provenance.mint, refused]]),
      })[0],
    ).toMatchObject({
      feed: false,
      canFeed: { open: false, reason: refused },
      note: null,
    });
  },
);

it("keeps mint safety and the fresh cap ahead of a possible one-hop check", () => {
  const { value, active } = oneHop();
  active.inventory.bags[0]!.feedable = false;
  active.inventory.bags[0]!.reasonCode = "freeze_authority";
  expect(rows(value, active)[0]).toMatchObject({
    feed: false,
    canFeed: { open: false, reason: { key: "xray.reason.freeze_authority" } },
  });
  active.inventory.bags[0]!.feedable = true;
  active.core!.binder!.fresh_in_deck = FEED_RULES.freshCapPerWallet;
  expect(rows(value, active)[0]).toMatchObject({
    feed: false,
    canFeed: { open: false, reason: { key: "feed.capReached" } },
  });
});
