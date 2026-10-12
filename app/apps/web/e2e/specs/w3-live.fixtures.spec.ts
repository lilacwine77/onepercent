import { PROGRAM_ID } from "../../../../packages/sdk/tests/program-id.js";
import { expect, test, type Page } from "@playwright/test";
import {
  PHASE,
  binderPda,
  configPda,
  machinePda,
  deckPda,
  encodeBinder,
  encodeConfig,
  encodeMachine,
  deckHeaderLayout,
} from "@onepercent/sdk";
import { PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { installWallet } from "../mock-wallet/index";
import webConfig from "../../../../packages/web-api/fixtures/web-config.json" with { type: "json" };
import { MeResponse } from "@onepercent/sdk/api";
import { fixtureRpcResult, type FixtureAccount } from "../helpers/w3-rpc";

// On failure, print what the page shows so CI logs explain the state without artifacts.
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const text = await page
    .locator("main")
    .innerText({ timeout: 2_000 })
    .catch(() => "(main not readable)");
  const alerts = await page
    .getByRole("alert")
    .allInnerTexts()
    .catch(() => []);
  console.log(
    `[w3 failure] main:\n${text.slice(0, 1500)}\n[w3 failure] alerts: ${JSON.stringify(alerts)}`,
  );
});
import config from "../../../../packages/web-api/fixtures/config.json" with { type: "json" };

// These are browser fixture checks. They never submit a transaction or certify
// the unmerged P2 instructions against a deployed program.
const queue = new PublicKey(new Uint8Array(32).fill(3));
const mint = new PublicKey(new Uint8Array(32).fill(7));
function account(data: Uint8Array, owner = PROGRAM_ID.toBase58()) {
  return {
    executable: false,
    owner,
    lamports: 10_000_000,
    rentEpoch: 0,
    data: [Buffer.from(data).toString("base64"), "base64"],
  };
}
async function connect(page: Page) {
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Fixture Wallet", exact: true })
    .click();
  // Connected: the header's one wallet control names the wallet (Disconnect is in its dialog).
  await expect(
    page.getByRole("button", { name: /^Wallet \S+…\S+$/ }),
  ).toBeVisible();
}
async function stats(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          fixtureWallet: {
            stats: { signatures: number; sendAttempts: number };
          };
        }
      ).fixtureWallet.stats,
  );
}
async function rpcFixture(
  page: Page,
  accounts: Map<string, FixtureAccount | null>,
  limited = false,
) {
  const methods: string[] = [];
  const capacity = { active: 0, peak: 0, rejected: 0 };
  await page.route("**/api/rpc", async (route) => {
    const { method, params = [], id } = route.request().postDataJSON();
    methods.push(method);
    if (limited && capacity.active >= 2) {
      capacity.rejected++;
      return route.fulfill({
        status: 503,
        headers: { "Retry-After": "1" },
        json: { error: "rpc_capacity" },
      });
    }
    capacity.active++;
    capacity.peak = Math.max(capacity.peak, capacity.active);
    try {
      // Keep two reads in flight long enough to exercise real browser bursts.
      if (limited) await new Promise((resolve) => setTimeout(resolve, 100));
      const result = fixtureRpcResult(method, params, accounts);
      await route.fulfill({ json: { jsonrpc: "2.0", id, result } });
    } catch (error) {
      unexpected(page, `${method}: ${String(error)}`);
      await route.fulfill({
        json: {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: String(error) },
        },
      });
    } finally {
      capacity.active--;
    }
  });
  return { methods, capacity };
}

const unrecorded = new WeakMap<Page, string[]>();
function unexpected(page: Page, message: string) {
  unrecorded.get(page)!.push(message);
  console.error(`[W3 unmocked request] ${message}`);
}
test.beforeEach(async ({ page }) => {
  unrecorded.set(page, []);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/config") return route.fulfill({ json: config });
    if (path === "/api/web/config") return route.fulfill({ json: webConfig });
    if (path === "/api/beacon") return route.fulfill({ status: 204 });
    if (path === "/api/events") return route.fulfill({ json: [] });
    if (path === "/api/stream")
      return route.fulfill({
        contentType: "text/event-stream",
        body: 'event: ping\ndata: {"ts":1800000000}\n\n',
      });
    unexpected(page, `${route.request().method()} ${path}`);
    return route.fulfill({
      status: 500,
      json: { error: "unrecorded_fixture_request" },
    });
  });
});
test.afterEach(async ({ page }) => {
  expect(
    unrecorded.get(page),
    "Every W3 API/RPC request must have an explicit fixture",
  ).toEqual([]);
});

async function coveredRip(page: Page, limited = false) {
  // A long end-to-end flow; slower CI runners need more than the default 30 s.
  test.slow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const wallet = await installWallet(page);
  if (limited)
    await page.addInitScript(() => {
      localStorage.setItem("onepercent.wallet", "Fixture Wallet");
      const failures: string[] = [];
      Object.defineProperty(window, "ripVisibleFailures", { value: failures });
      new MutationObserver(() => {
        for (const node of document.querySelectorAll(".rip-trust")) {
          const message = node.textContent?.trim() ?? "";
          if (
            node.getClientRects().length &&
            (node.getAttribute("role") === "alert" ||
              message.includes("The machine didn’t answer. Try again."))
          )
            failures.push(message);
        }
      }).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });
  await page.route("**/api/config", (route) =>
    route.fulfill({
      json: {
        ...config,
        programId: PROGRAM_ID.toBase58(),
        phase: "OnAir",
        flags: { ...config.flags, PACKS: true },
      },
    }),
  );
  await page.route("**/api/machine", (route) =>
    route.fulfill({
      json: {
        asOfSlot: 100,
        phase: PHASE.onAir,
        stock: {
          stockSol: "100000000000",
          book: "100000000000",
          target: "0",
          belowTarget: false,
          buckets: [],
        },
        coverage: { maxQty: [10, 10, 10, 5] },
        deck: { len: 200, reservedDust: "0", free: 200 },
        jackpot: { tokens: "0", cost: "0", sol: "0" },
        onePct: Array.from({ length: 4 }, () => ({ state: 0, amount: "0" })),
        sellBack: { budget: "0", paidHour: "0", floor: "0" },
        pendingPulls: "0",
        vrf: {
          queue: queue.toBase58(),
          occupancyBps: 0,
          oldestItemAgeSeconds: 0,
          busy: false,
        },
        feedBack: { estimate: "0", mix: [0, 0, 0, 0] },
      },
    }),
  );
  const clock = Buffer.alloc(40);
  clock.writeBigInt64LE(100n, 32);
  const { methods, capacity } = await rpcFixture(
    page,
    new Map<string, FixtureAccount | null>([
      [
        binderPda(PROGRAM_ID, new PublicKey(wallet.address))[0].toBase58(),
        null,
      ],
      [
        configPda(PROGRAM_ID)[0].toBase58(),
        account(
          encodeConfig({
            version: 1,
            bump: configPda(PROGRAM_ID)[1],
            vrf_queues: [
              queue,
              PublicKey.default,
              PublicKey.default,
              PublicKey.default,
            ],
          }),
        ),
      ],
      [
        machinePda(PROGRAM_ID)[0].toBase58(),
        account(
          encodeMachine({
            version: 1,
            bump: machinePda(PROGRAM_ID)[1],
            phase: PHASE.onAir,
            end_ts: 1000n,
            buckets: Array.from({ length: 16 }, (_, index) =>
              index === 0
                ? {
                    class: 1,
                    enabled: 1,
                    amount: 100000000000n,
                    cost: 100000000000n,
                  }
                : {},
            ),
          }),
        ),
      ],
      [
        deckPda(PROGRAM_ID)[0].toBase58(),
        account(
          deckHeaderLayout.encode({
            version: 1,
            bump: deckPda(PROGRAM_ID)[1],
            len: 200,
            cap: 200,
          }),
        ),
      ],
      [
        SYSVAR_CLOCK_PUBKEY.toBase58(),
        account(clock, "Sysvar1111111111111111111111111111111111111"),
      ],
    ]),
    limited,
  );
  await page.route("**/api/me/*", (route) =>
    route.fulfill({
      json: MeResponse.parse({
        asOfSlot: 100,
        binder: null,
        deck: [],
        pulls: { pending: [], settleable: [] },
        vaultDeposits: [],
        royalties: {
          count24h: 0,
          lamports24h: null,
          total: null,
          settlementReceipts: { lamports24h: "0", total: "0" },
        },
      }),
    }),
  );
  await page.goto("/rip?n=99");
  if (limited)
    await expect(
      page.getByRole("button", { name: /^Wallet \S+…\S+$/ }),
    ).toBeVisible();
  else await connect(page);
  await expect.poll(() => methods.includes("getBalance")).toBe(true);
  const rip = page.locator(".rip-oval");
  await expect(rip).toBeVisible();
  await expect(rip).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByText("The machine didn’t answer. Try again.", {
      exact: true,
    }),
  ).toHaveCount(0);
  const rejectedBeforePreparation = capacity.rejected;
  await expect(
    page.getByRole("radio", { name: "×10", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "×5", exact: true }).click();
  await rip.click();
  const preview = page.getByRole("dialog", { name: "Before you Rip" });
  // Preparation is bounded at 5 s in the app; slower CI runners need headroom above it.
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect(preview.getByText(/5 ×/)).toBeVisible();
  await expect(preview.getByText("Not refundable.")).toBeVisible();
  await expect(preview.getByText(/Refundable deposits · ≈/)).toBeVisible();
  await expect(preview.getByText("1 transaction, 1 approval")).toBeVisible();
  await expect(preview.getByText(/Pull deposit ·/)).not.toBeVisible();
  await preview.getByText("Details", { exact: true }).click();
  await expect(preview.getByText(/Pull deposit ·/)).toBeVisible();
  await expect(preview.getByText(/Card slots ·/)).toBeVisible();
  await expect(preview.getByText(/Network fee ·/)).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Sign and Rip" }),
  ).toBeEnabled();
  expect(await stats(page)).toMatchObject({ signatures: 0, sendAttempts: 0 });
  expect(methods).not.toContain("simulateTransaction");
  expect(methods).toContain("getLatestBlockhash");
  expect(methods).toContain("getMinimumBalanceForRentExemption");
  expect(methods).toContain("getFeeForMessage");
  expect(methods).not.toContain("sendTransaction");
  await expect(page.getByRole("alert")).toHaveCount(0);
  if (limited) {
    expect(rejectedBeforePreparation).toBeGreaterThan(0);
    expect(capacity.rejected).toBeGreaterThan(rejectedBeforePreparation);
    expect(capacity.peak).toBe(2);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { ripVisibleFailures: string[] })
            .ripVisibleFailures,
      ),
    ).toEqual([]);
  }
  await preview.getByRole("button", { name: "Cancel" }).click();
  await expect(preview).toHaveCount(0);
  expect(await stats(page)).toMatchObject({ signatures: 0, sendAttempts: 0 });
}

test("W3 fixtures: a covered live Rip prices quantity and rent before asking for a signature", async ({
  page,
}) => {
  await coveredRip(page);
});

test("W3 fixtures: live Rip loads and prepares through a limiting RPC proxy without a visible failure", async ({
  page,
}) => {
  await coveredRip(page, true);
});

test("W3 fixtures: My cards retains Redeem when the config, machine and quote services are unavailable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const wallet = await installWallet(page);
  const owner = new PublicKey(wallet.address);
  const [binder, bump] = binderPda(PROGRAM_ID, owner);
  const bytes = encodeBinder({
    owner,
    bump,
    cards: [
      { mint, amount: 1_000_000n, kind: 0, seq_lo: 1 },
      { mint, amount: 1_000_000n, kind: 1, seq_lo: 2 },
    ],
  });
  await rpcFixture(
    page,
    new Map<string, FixtureAccount | null>([
      [binder.toBase58(), account(bytes)],
      [configPda(PROGRAM_ID)[0].toBase58(), null],
      [machinePda(PROGRAM_ID)[0].toBase58(), null],
      [deckPda(PROGRAM_ID)[0].toBase58(), null],
      [SYSVAR_CLOCK_PUBKEY.toBase58(), null],
      [mint.toBase58(), null],
    ]),
  );
  for (const path of ["config", "machine", "me/*", "values", "sell_back/*"]) {
    await page.route(`**/api/${path}`, (route) =>
      route.fulfill({ status: 503, json: { error: "unavailable" } }),
    );
  }
  await page.goto("/cards");
  await connect(page);
  await expect(
    page.getByRole("button", { name: "Redeem all", exact: true }),
  ).toBeEnabled();
  await expect(
    page.locator('.mc-bulk-btn[data-action="sell_back"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('.mc-bulk-btn[data-action="feed_back"]'),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Rescue page ↗" }).first(),
  ).toHaveAttribute("href", "/rescue");
  expect(await stats(page)).toMatchObject({ signatures: 0, sendAttempts: 0 });
});
