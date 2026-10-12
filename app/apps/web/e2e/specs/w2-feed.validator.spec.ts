import { expect, test, type Page } from "@playwright/test";
import { sol } from "@onepercent/copy";
import { installWallet } from "../mock-wallet/index.js";
import {
  startFeedValidator,
  type FeedValidator,
} from "../helpers/feed-validator.js";

test.describe.configure({ timeout: 180_000 });
let validator: FeedValidator | undefined;
test.afterEach(async ({ page }) => {
  await page.close();
  await validator?.close();
  validator = undefined;
});

type WalletStats = {
  prompts: number;
  sendAttempts: number;
  behavior: string;
  drop: number;
};
async function stats(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { fixtureWallet: { stats: WalletStats } })
        .fixtureWallet.stats,
  );
}
async function connect(
  page: Page,
  bags: number,
  options: {
    split?: boolean;
    empties?: number;
    signAndSend?: boolean;
    dropSend?: number;
  } = {},
) {
  let sendAttempts = 0;
  const wallet = await installWallet(page, {
    signAndSend: options.signAndSend,
    sendTransaction: async (bytes) => {
      if (!validator) throw new Error("Validator is not running");
      // The wallet returns its real signature even if a transport loses this send.
      // Reconciliation must then prove absence after expiry before retrying it.
      if (sendAttempts++ === options.dropSend) return;
      await validator.connection.sendRawTransaction(bytes, {
        skipPreflight: false,
        maxRetries: 0,
      });
    },
  });
  validator = await startFeedValidator({
    wallet: wallet.address,
    bags,
    ...options,
  });
  await page.goto("/feed");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Fixture Wallet", exact: true })
    .click();
  await expect(page.locator(".feed-row input[type=checkbox]")).toHaveCount(
    bags,
  );
  await expect(page.locator(".feed-summary > button")).toBeEnabled();
  return validator;
}
async function approvals(page: Page) {
  const line = await page.locator(".feed-lines").innerText();
  const match = line.match(/(\d+) approval/);
  expect(match, "The preview must disclose the approval count").not.toBeNull();
  return Number(match![1]);
}

for (const signAndSend of [true, false]) {
  test(`W2.01 / W2.02: 16 bags and 3 exits, ${signAndSend ? "send" : "sign"} capability`, async ({
    page,
  }) => {
    const chain = await connect(page, 16, { signAndSend });
    const planned = await approvals(page);
    const before = await stats(page);
    await page.locator(".feed-summary > button").click();
    await expect
      .poll(async () => (await chain.deck()).len, { timeout: 60_000 })
      .toBe(16);
    await expect(page.locator(".machine-row")).toHaveCount(16);
    expect((await stats(page)).prompts - before.prompts).toBe(planned);
    expect(chain.logs.flatMap((entry) => entry.bags)).toHaveLength(16);
    expect(
      chain.logs
        .flatMap((entry) => entry.bags)
        .every((bag) => bag.amount === chain.amount.toString()),
    ).toBe(true);
    // A live feature flag disables intake, never an owner's exit.
    chain.state.feedEnabled = false;
    chain.state.publicReads = false;
    await page.reload();
    await expect(page.locator(".machine-row")).toHaveCount(16);
    const rent = await chain.deposits();
    for (let taken = 0; taken < 3; taken++) {
      const beforeDeck = await chain.deck();
      const entry = beforeDeck.entries[0]!;
      const balance = await chain.connection.getBalance(chain.wallet);
      await page.locator(".machine-row button").first().click();
      const exitButton = page
        .getByRole("dialog")
        .getByRole("button", { name: /Take back/ });
      const approvalCount = (await exitButton.innerText()).match(
        /(\d+) approval/,
      );
      expect(approvalCount).not.toBeNull();
      const promptsBeforeExit = (await stats(page)).prompts;
      await exitButton.click();
      await expect.poll(async () => (await chain.deck()).len).toBe(15 - taken);
      expect((await stats(page)).prompts - promptsBeforeExit).toBe(
        Number(approvalCount![1]),
      );
      const returned = await chain.connection.getTokenAccountsByOwner(
        chain.wallet,
        { mint: entry.mint },
      );
      expect(returned.value).toHaveLength(1);
      expect(returned.value[0]!.account.data.readBigUInt64LE(64)).toBe(
        entry.amount,
      );
      const after = await chain.connection.getBalance(chain.wallet);
      // Rent is returned by the program. The destination ATA and transaction fee
      // are accounted separately, instead of asserting an exact wallet balance.
      const signatures = await chain.connection.getSignaturesForAddress(
        chain.wallet,
        { limit: 1 },
      );
      const transaction = await chain.connection.getTransaction(
        signatures[0]!.signature,
        { maxSupportedTransactionVersion: 0 },
      );
      expect(
        BigInt(
          after -
            balance +
            returned.value[0]!.account.lamports +
            transaction!.meta!.fee,
        ),
      ).toBe(BigInt(entry.deposit));
      expect(BigInt(entry.deposit)).toBe(rent.entry);
      await expect(page.locator(".machine-row")).toHaveCount(15 - taken);
    }
    await test.info().attach("feed-validator-evidence", {
      contentType: "application/json",
      body: JSON.stringify({
        validatorVersion: "4.3.0",
        artifactSha256: chain.artifactSha256,
        walletCapability: signAndSend
          ? "signAndSendTransaction"
          : "signTransaction",
        fed: 16,
        takenBack: 3,
        approvalsForFeed: planned,
        deckAfter: (await chain.deck()).len,
      }),
    });
  });
}

test("W2.03: transaction 3 fails and retry sends only remaining bags", async ({
  page,
}) => {
  const chain = await connect(page, 4, { dropSend: 2 });
  await page.locator(".feed-summary > button").click();
  await expect(page.locator(".feed-flow").first()).toContainText(
    /went through/,
    { timeout: 120_000 },
  );
  expect((await chain.deck()).len).toBe(2);
  const landed = new Set(
    (await chain.deck()).entries.map((entry) => entry.mint.toBase58()),
  );
  const before = chain.logs.length;
  await page.locator(".feed-summary > button").click();
  await expect
    .poll(async () => (await chain.deck()).len, { timeout: 30_000 })
    .toBe(4);
  expect(
    chain.logs
      .slice(before)
      .flatMap((entry) => entry.bags)
      .every((bag) => !landed.has(bag.mint)),
  ).toBe(true);
  expect((await stats(page)).sendAttempts).toBe(5);
});

test("W2.06 / W2.08 / W2.09: merges first, closes empties, and reads deposits from Rent", async ({
  page,
}) => {
  const chain = await connect(page, 1, { split: true, empties: 2 });
  const rent = await chain.deposits();
  await expect(page.locator(".feed-lines")).toContainText(
    sol(rent.entry + rent.binder + rent.firstCoin),
  );
  const empties = await chain.connection.getMultipleAccountsInfo(
    chain.emptyAccounts,
  );
  const reclaimed = empties.reduce(
    (sum, account) => sum + BigInt(account!.lamports),
    0n,
  );
  await expect(page.locator(".feed-rent")).toContainText(sol(reclaimed));
  const planned = await approvals(page);
  const before = await stats(page);
  const walletBefore = await chain.connection.getBalance(chain.wallet);
  const allClosed = [
    ...chain.emptyAccounts,
    ...chain.splitAccounts,
    ...chain.sources,
  ];
  const rentReturned = (
    await chain.connection.getMultipleAccountsInfo(allClosed)
  ).reduce((sum, account) => sum + BigInt(account!.lamports), 0n);
  await page.locator(".feed-summary > button").click();
  await expect
    .poll(async () => (await chain.deck()).len, { timeout: 30_000 })
    .toBe(1);
  await expect(page.locator(".feed-done")).toBeVisible();
  expect((await stats(page)).prompts - before.prompts).toBe(planned);
  expect(
    await chain.connection.getMultipleAccountsInfo([
      ...chain.emptyAccounts,
      ...chain.splitAccounts,
      ...chain.sources,
    ]),
  ).toEqual(
    Array(
      chain.emptyAccounts.length +
        chain.splitAccounts.length +
        chain.sources.length,
    ).fill(null),
  );
  expect(
    chain.logs.flatMap((entry) => entry.bags).map((bag) => bag.amount),
  ).toEqual([chain.amount.toString()]);
  expect((await chain.deck()).entries[0]!.amount).toBe(chain.amount);
  const signatures = await chain.connection.getSignaturesForAddress(
    chain.wallet,
  );
  let fees = 0n;
  for (const { signature } of signatures) {
    const tx = await chain.connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
    fees += BigInt(tx!.meta!.fee);
  }
  const walletAfter = await chain.connection.getBalance(chain.wallet);
  expect(
    BigInt(walletAfter - walletBefore) +
      fees +
      rent.entry +
      rent.binder +
      rent.firstCoin,
  ).toBe(rentReturned);
});

test("W2.05: production intake refusals remain per bag", async ({ page }) => {
  const chain = await connect(page, 2);
  chain.refused.set(chain.mints[0]!.toBase58(), "not_supported");
  await page.locator(".feed-summary > button").click();
  await expect
    .poll(async () => (await chain.deck()).len, { timeout: 30_000 })
    .toBe(1);
  expect((await chain.deck()).entries[0]!.mint.equals(chain.mints[1]!)).toBe(
    true,
  );
  expect(
    (await chain.connection.getTokenAccountBalance(chain.sources[0]!)).value
      .amount,
  ).toBe(chain.amount.toString());
  await page.locator(".feed-out > summary").click();
  await expect(page.locator(".feed-out")).toContainText(
    "Not supported (token extensions)",
  );
});

test("W2.04: expired approval rebuilds on the next tap", async ({ page }) => {
  const chain = await connect(page, 1);
  await page.evaluate(() => {
    (
      window as unknown as { fixtureWallet: { stats: WalletStats } }
    ).fixtureWallet.stats.behavior = "hold";
  });
  const initial = await stats(page);
  await page.locator(".feed-summary > button").click();
  await expect
    .poll(async () => (await stats(page)).prompts)
    .toBe(initial.prompts + 1);
  const validity = await chain.connection.getLatestBlockhash();
  await expect
    .poll(async () => await chain.connection.getBlockHeight("finalized"), {
      timeout: 120_000,
    })
    .toBeGreaterThan(validity.lastValidBlockHeight + 5);
  await page.evaluate(() =>
    (
      window as unknown as { fixtureWallet: { release(): void } }
    ).fixtureWallet.release(),
  );
  await expect(page.locator(".feed-flow").first()).toContainText(
    /Took too long/,
  );
  expect((await chain.deck()).len).toBe(0);
  await page.locator(".feed-summary > button").click();
  await expect
    .poll(async () => (await chain.deck()).len, { timeout: 30_000 })
    .toBe(1);
});
