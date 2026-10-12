import { PROGRAM_ID } from "../../../../packages/sdk/tests/program-id.js";
import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  buildRedeemTransactions,
  fetchBinder,
  fetchMintDecimals,
  fetchPull,
  pullPda,
} from "@onepercent/sdk";
import { identifyCards } from "../../src/adapters/cards.js";
import { readMachine } from "../../src/data/chain.js";
import { editionLiveFlags, editionModels } from "../../src/adapters/edition.js";
import { crossCheckReveal } from "../../src/tx/watch-pull.js";
import { loadPullEvidence } from "../../src/data/pull.js";
import {
  connectValidatorWallet,
  prepareValidatorPage,
  randomnessForTier,
  validatorContext,
  waitForPull,
} from "../helpers/validator.js";
import { fulfillLocal } from "../helpers/vrf.js";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
const context = await validatorContext();
const { rpc, buyer, manifest } = context;
const queue = new PublicKey(manifest.queue);
const titles = [
  "Silver Foil",
  "Blue Foil",
  "Holo Foil",
  "Black Foil",
  "Jackpot",
  "The 1%",
];
async function stats(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          fixtureWallet: {
            stats: { signatures: number; sendAttempts: number; drop: number };
          };
        }
      ).fixtureWallet.stats,
  );
}
async function open(page: Page, route: string) {
  await prepareValidatorPage(page, context);
  await page.goto(route);
  await connectValidatorWallet(page);
}
async function buy(page: Page, quantity: number, tier?: number) {
  const nonce =
    (await fetchBinder(PROGRAM_ID, rpc, buyer.publicKey))?.pull_nonce ?? 0;
  const address = pullPda(PROGRAM_ID, buyer.publicKey, nonce)[0];
  const requestIndex = (await rpc.getAccountInfo(
    queue,
    "confirmed",
  ))!.data.readUInt32LE(0);
  await page
    .getByRole("radiogroup", { name: "Packs", exact: true })
    .getByRole("radio", { name: `×${quantity}`, exact: true })
    .click();
  await page.locator(".rip-oval").click();
  const preview = page.getByRole("dialog", {
    name: "Before you Rip",
    exact: true,
  });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("SOL");
  const before = await stats(page);
  await preview
    .getByRole("button", { name: "Sign and Rip", exact: true })
    .click();
  const pending = await waitForPull(rpc, address);
  expect(pending.status).toBe(1);
  await expect(
    page.locator(`.rip-verify[href="/verify/${pending.seq}"]`),
  ).toHaveCount(0);
  expect((await stats(page)).signatures).toBeGreaterThan(before.signatures);
  const state = await readMachine(rpc);
  const liveFlags = editionLiveFlags(
    editionModels({
      ...state,
      deckLen: state.deck.len,
      vrf: {
        queue: queue.toBase58(),
        occupancyBps: 0,
        oldestItemAgeSeconds: 0,
        busy: false,
      },
    })[0]!,
  );
  // The special scenario is injected only in the local genesis fixture.
  const randomness = tier
    ? randomnessForTier(pending.seq, 0, tier, liveFlags)
    : createHash("sha256")
        .update(`browser-x${quantity}:${pending.seq}`)
        .digest();
  await fulfillLocal(rpc, buyer, queue, address, requestIndex, randomness);
  const revealed = await fetchPull(PROGRAM_ID, rpc, address);
  expect(revealed?.status).toBe(2);
  const evidence = await loadPullEvidence(rpc, address, pending.seq, revealed!);
  expect(evidence).not.toBeNull();
  const packs = await crossCheckReveal(
    evidence!,
    { buyer: buyer.publicKey.toBase58(), edition: 0, qty: quantity },
    revealed!,
  );
  if (tier) expect(packs[0]?.tier).toBe(tier);
  await expect(
    page.locator(`.rip-verify[href="/verify/${pending.seq}"]`),
  ).toBeVisible({ timeout: 45_000 });
  return { address, packs, revealed: revealed! };
}
async function redeemExcept(keep: number) {
  const binder = await fetchBinder(PROGRAM_ID, rpc, buyer.publicKey);
  if (!binder || binder.cards.length <= keep) return;
  const selected = binder.cards
    .map((card, cardIndex) => ({ ...card, cardIndex }))
    .slice(keep);
  const cards = await Promise.all(
    selected.map(async (card) => ({
      ...card,
      tokenProgram: (await fetchMintDecimals(rpc, card.mint)).tokenProgram,
    })),
  );
  for (const tx of buildRedeemTransactions(PROGRAM_ID, {
    wallet: buyer.publicKey,
    blockhash: (await rpc.getLatestBlockhash("confirmed")).blockhash,
    cards,
  })) {
    if (tx instanceof Transaction) tx.sign(buyer);
    else tx.sign([buyer]);
    const signature = await rpc.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    await expect
      .poll(
        async () =>
          (await rpc.getSignatureStatuses([signature])).value[0]
            ?.confirmationStatus,
      )
      .toMatch(/confirmed|finalized/);
  }
}

test("W3.02: a pre-aged pending Pull refunds through My cards", async ({
  page,
}) => {
  expect(
    manifest.pull,
    "The browser run requires the refund genesis scenario",
  ).toBeTruthy();
  const address = new PublicKey(manifest.pull!);
  expect((await fetchPull(PROGRAM_ID, rpc, address))?.status).toBe(1);
  await open(page, "/cards");
  await page.getByRole("button", { name: /^Refund/ }).click();
  await expect
    .poll(async () => await fetchPull(PROGRAM_ID, rpc, address))
    .toBeNull();
  expect((await stats(page)).signatures).toBe(1);
});

for (const tier of [6, 5, 1, 2, 3, 4]) {
  test(`W3.01: injected ${titles[tier - 1]} reveal equals confirmed PackRevealed`, async ({
    page,
  }) => {
    await open(page, "/rip");
    const result = await buy(page, 1, tier);
    await expect(page.locator(".rip-result")).toContainText(titles[tier - 1]!);
    const binder = await fetchBinder(PROGRAM_ID, rpc, buyer.publicKey);
    const card = binder?.cards.find(
      (row) => row.seq_lo === Number(result.revealed.seq) && row.kind === tier,
    );
    expect(card?.amount).toBe(result.packs[0]?.hit_amount);
    expect(card?.mint.toBase58()).toBe(result.packs[0]?.hit_mint);
  });
}

test("W3.03 and W3.08: x10 order, Turbo, RipLine and prepended Settle without a keeper", async ({
  page,
}) => {
  const nonce = (await fetchBinder(PROGRAM_ID, rpc, buyer.publicKey))!
    .pull_nonce;
  const previous = pullPda(PROGRAM_ID, buyer.publicKey, nonce - 1)[0];
  expect((await fetchPull(PROGRAM_ID, rpc, previous))?.status).toBe(2);
  await open(page, "/rip");
  await page.getByRole("button", { name: "Turbo", exact: true }).click();
  const result = await buy(page, 10);
  await expect(page.locator(".rip-line li")).toHaveCount(10);
  expect(result.packs.map((row) => row.pack)).toEqual(
    Array.from({ length: 10 }, (_, index) => index),
  );
  expect(await fetchPull(PROGRAM_ID, rpc, previous)).toBeNull();
  for (let index = 1; index < 10; index++) {
    await page.getByRole("button", { name: "Next pack", exact: true }).click();
    await expect(
      page.getByText(`Pack ${index + 1} of 10`, { exact: true }),
    ).toBeVisible();
  }
});

test("W3.05: nine Binder cards use two Redeem transactions and retry only the remainder", async ({
  page,
}) => {
  await redeemExcept(9);
  const binder = await fetchBinder(PROGRAM_ID, rpc, buyer.publicKey);
  expect(binder?.len).toBe(9);
  await open(page, "/cards");
  await expect(page.locator(".mc-cell[data-id]")).toHaveCount(9);
  expect(
    await page
      .locator(".mc-cell[data-id]")
      .evaluateAll((items) =>
        items.map((item) => (item as HTMLElement).dataset.id).sort(),
      ),
  ).toEqual(
    identifyCards(binder!.cards)
      .map((card) => card.cardId)
      .sort(),
  );
  await page.evaluate(() => {
    (
      window as unknown as { fixtureWallet: { stats: { drop: number } } }
    ).fixtureWallet.stats.drop = 1;
  });
  const validity = await rpc.getLatestBlockhash("confirmed");
  await page.getByRole("button", { name: "Redeem all", exact: true }).click();
  await page.locator(".mc-sheet-foot .mc-oval").click();
  await expect
    .poll(
      async () => (await fetchBinder(PROGRAM_ID, rpc, buyer.publicKey))?.len,
    )
    .toBe(1);
  expect((await stats(page)).sendAttempts).toBe(2);
  // An uncertain wallet return stays locked until its real validity window ends.
  await expect
    .poll(() => rpc.getBlockHeight("confirmed"), { timeout: 100_000 })
    .toBeGreaterThan(validity.lastValidBlockHeight);
  await page.reload();
  await expect(page.locator(".mc-cell[data-id]")).toHaveCount(1);
  await page.getByRole("button", { name: "Redeem all", exact: true }).click();
  await page.locator(".mc-sheet-foot .mc-oval").click();
  await expect
    .poll(
      async () => (await fetchBinder(PROGRAM_ID, rpc, buyer.publicKey))?.len,
    )
    .toBe(0);
  expect((await stats(page)).signatures).toBe(1);
});
