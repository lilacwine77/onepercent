import assert from "node:assert/strict";
import { createPrivateKey, sign } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { AccountLayout, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  VersionedTransaction,
} from "@solana/web3.js";
import { ATTESTATIONS, PUMP_LAYOUTS } from "@onepercent/config";
import {
  attestationExpiry,
  bagsHash,
  binderPda,
  bondingCurvePda,
  configPda,
  DECK_FLAGS,
  decodeDeck,
  deckPda,
  encodeBinder,
  encodeConfig,
  encodeDeck,
  encodeMachine,
  EXTERNAL_IDS,
  feedMessage,
  IDL,
  ledgerPda,
  machinePda,
  PHASE,
  userAta,
  vaultAta,
} from "@onepercent/sdk";
import { PROGRAM_ID } from "../../../../packages/sdk/tests/program-id.js";
import * as published from "../../../../packages/sdk/src/api/__fixtures__/responses.js";
import { checkSignedTransaction } from "../../../../services/api/src/web/send.js";
import { installWallet } from "../mock-wallet/index.js";
import { fixtureRpcResult, type FixtureAccount } from "../helpers/w3-rpc.js";

test.describe.configure({ timeout: 60_000 });
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const text = await page
    .locator("main")
    .innerText({ timeout: 2_000 })
    .catch(() => "Main is unavailable");
  console.log(`[W2 fixture failure] ${text.slice(0, 2000)}`);
});

// Browser fixtures only: signed bytes update explicit local test state. No RPC
// endpoint receives them, and these checks do not certify on-chain execution.
const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));
const mint = key(91);
const otherMint = key(92);
const amount = 1_000_000n;
const deposit = 80_000;
function account(data: Uint8Array, owner = PROGRAM_ID): FixtureAccount {
  return {
    executable: false,
    owner: owner.toBase58(),
    lamports: 10_000_000,
    rentEpoch: 0,
    data: [Buffer.from(data).toString("base64"), "base64"],
  };
}
function mintAccount() {
  const data = Buffer.alloc(MintLayout.span);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: amount,
      decimals: 6,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  );
  return account(data, TOKEN_PROGRAM_ID);
}
function tokenAccount(
  wallet: PublicKey,
  tokenMint: PublicKey,
  balance: bigint,
) {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      mint: tokenMint,
      owner: wallet,
      amount: balance,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  );
  return account(data, TOKEN_PROGRAM_ID);
}
async function walletStats(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          fixtureWallet: {
            stats: {
              prompts: number;
              signatures: number;
              sendAttempts: number;
            };
          };
        }
      ).fixtureWallet.stats,
  );
}
async function setup(
  page: Page,
  options: {
    deposited?: boolean;
    servicesDown?: boolean;
    signAndSend?: boolean;
    feedSuccess?: boolean;
  } = {},
) {
  const accounts = new Map<string, FixtureAccount | null>();
  const intakeSigner = Keypair.generate();
  const intake = intakeSigner.publicKey;
  const signingKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      intakeSigner.secretKey.subarray(0, 32),
    ]),
    format: "der",
    type: "pkcs8",
  });
  let submitted = 0;
  const updateDeck = (deposited: boolean) =>
    accounts.set(
      deckPda(PROGRAM_ID)[0].toBase58(),
      account(
        encodeDeck({
          version: 1,
          bump: deckPda(PROGRAM_ID)[1],
          total_fed: 1n,
          total_taken_back: deposited ? 0n : 1n,
          entries: deposited
            ? [{ depositor: wallet, mint, amount, deposit, flags: 1 }]
            : [],
        }),
      ),
    );
  const recordSigned = async (bytes: Uint8Array) => {
    assert.equal(
      submitted,
      0,
      "Fixture transactions must not be submitted twice",
    );
    const tx = VersionedTransaction.deserialize(bytes);
    assert(tx.signatures[0]!.some((byte) => byte !== 0));
    const expected = IDL.instructions.find(
      (ix) => ix.name === (options.feedSuccess ? "feed" : "take_back"),
    )!.discriminator;
    const instructions = tx.message.compiledInstructions.filter((ix) =>
      tx.message.staticAccountKeys[ix.programIdIndex]!.equals(PROGRAM_ID),
    );
    assert.equal(instructions.length, 1);
    assert.deepEqual(
      Array.from(instructions[0]!.data.subarray(0, expected.length)),
      expected,
    );
    submitted++;
    updateDeck(Boolean(options.feedSuccess));
    accounts.set(
      userAta(wallet, mint, TOKEN_PROGRAM_ID).toBase58(),
      options.feedSuccess ? null : tokenAccount(wallet, mint, amount),
    );
    if (options.feedSuccess)
      accounts.set(
        binderPda(PROGRAM_ID, wallet)[0].toBase58(),
        account(
          encodeBinder({
            owner: wallet,
            bump: binderPda(PROGRAM_ID, wallet)[1],
            fresh_in_deck: 1,
            feed_nonce_bits: 1,
          }),
        ),
      );
  };
  const connected = await installWallet(page, {
    signAndSend: options.signAndSend,
    sendTransaction: recordSigned,
  });
  const wallet = new PublicKey(connected.address);
  const core = !options.servicesDown;
  accounts.set(
    wallet.toBase58(),
    account(Buffer.alloc(0), SystemProgram.programId),
  );
  accounts.set(
    configPda(PROGRAM_ID)[0].toBase58(),
    core
      ? account(
          encodeConfig({
            version: 1,
            bump: configPda(PROGRAM_ID)[1],
            intake_signer: intake,
            season_set: 1,
            snapshot_slot: 1n,
            snapshot_ts: 1n,
            stock_up_ts: 1n,
          }),
        )
      : null,
  );
  accounts.set(
    machinePda(PROGRAM_ID)[0].toBase58(),
    core
      ? account(
          encodeMachine({
            version: 1,
            bump: machinePda(PROGRAM_ID)[1],
            phase: PHASE.stockUp,
          }),
        )
      : null,
  );
  accounts.set(binderPda(PROGRAM_ID, wallet)[0].toBase58(), null);
  updateDeck(Boolean(options.deposited));
  for (const tokenMint of [mint, otherMint]) {
    accounts.set(tokenMint.toBase58(), mintAccount());
    accounts.set(ledgerPda(PROGRAM_ID, tokenMint)[0].toBase58(), null);
    accounts.set(
      vaultAta(PROGRAM_ID, tokenMint, TOKEN_PROGRAM_ID).toBase58(),
      null,
    );
    const curve = Buffer.alloc(81);
    Buffer.from(PUMP_LAYOUTS.bondingCurveDiscriminatorHex, "hex").copy(curve);
    accounts.set(
      bondingCurvePda(tokenMint)[0].toBase58(),
      account(curve, EXTERNAL_IDS.pumpFun),
    );
    accounts.set(
      userAta(wallet, tokenMint, TOKEN_PROGRAM_ID).toBase58(),
      options.deposited ? null : tokenAccount(wallet, tokenMint, amount),
    );
  }
  const unexpected: string[] = [];
  const methods: string[] = [];
  const attestRequests: string[][] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body });
    if (path === "/api/web/config")
      return json({
        lookupTable: null,
        adminMultisig: null,
        flags: { XRAY: true },
        modes: { feed: "live" },
      });
    if (path === "/api/beacon") return route.fulfill({ status: 204 });
    if (path === "/api/events") return json([]);
    if (path === "/api/stream")
      return route.fulfill({
        contentType: "text/event-stream",
        body: 'event: ping\ndata: {"ts":100}\n\n',
      });
    if (path.startsWith("/api/logo/")) return route.fulfill({ status: 404 });
    if (path === "/api/rpc") {
      const { method, params = [], id } = route.request().postDataJSON();
      methods.push(method);
      try {
        let result: unknown;
        if (method === "getAccountInfo" || method === "getMultipleAccounts") {
          const read = (address: string) => {
            assert(accounts.has(address), `Unrecorded account ${address}`);
            const info = accounts.get(address)!;
            const slice = params[1]?.dataSlice;
            if (!info || !slice) return info;
            const bytes = Buffer.from(info.data[0]!, "base64").subarray(
              slice.offset,
              slice.offset + slice.length,
            );
            return { ...info, data: [bytes.toString("base64"), "base64"] };
          };
          result = {
            context: { slot: 100 },
            value:
              method === "getAccountInfo"
                ? read(params[0])
                : params[0].map(read),
          };
        } else if (method === "getTokenAccountsByOwner") {
          result = {
            context: { slot: 100 },
            value: [...accounts].flatMap(([pubkey, info]) =>
              info !== null &&
              info.owner === params[1].programId &&
              Buffer.from(info.data[0]!, "base64").length === AccountLayout.span
                ? [{ pubkey, account: info }]
                : [],
            ),
          };
        } else if (method === "getRecentPrioritizationFees") result = [];
        else if (method === "getBlockHeight") result = 100;
        else if (method === "simulateTransaction")
          result = {
            context: { slot: 100 },
            value: { err: null, logs: [], unitsConsumed: 10000 },
          };
        else if (method === "getSignatureStatuses")
          result = {
            context: { slot: 100 },
            value: params[0].map(() =>
              submitted
                ? {
                    slot: 100,
                    confirmations: null,
                    err: null,
                    confirmationStatus: "finalized",
                  }
                : null,
            ),
          };
        else result = fixtureRpcResult(method, params, accounts);
        return json({ jsonrpc: "2.0", id, result });
      } catch (error) {
        unexpected.push(`${method}: ${String(error)}`);
        return json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Unrecorded fixture request" },
        });
      }
    }
    if (path === "/api/send") {
      const { tx } = route.request().postDataJSON();
      const signature = checkSignedTransaction(tx);
      await recordSigned(Buffer.from(tx, "base64"));
      return json({ signature });
    }
    if (options.servicesDown) return json({ error: "unavailable" }, 503);
    if (path === "/api/config")
      return json({
        ...published.config,
        programId: PROGRAM_ID.toBase58(),
        phase: PHASE.stockUp,
        flags: { ...published.flags, FEED: true },
        roles: { ...published.config.roles, intakeSigner: intake.toBase58() },
      });
    if (path === "/api/machine")
      return json({ ...published.machine, phase: PHASE.stockUp });
    if (path.startsWith("/api/me/")) {
      const encoded = accounts.get(deckPda(PROGRAM_ID)[0].toBase58());
      assert(encoded);
      const deck = decodeDeck(Buffer.from(encoded.data[0]!, "base64"));
      return json({
        ...published.me,
        asOfSlot: 100,
        binder: null,
        deck: deck.entries.flatMap((entry, deckIndex) =>
          entry.depositor.equals(wallet)
            ? [
                {
                  asOfSlot: 100,
                  deckIndex,
                  mint: entry.mint.toBase58(),
                  amount: entry.amount.toString(),
                  fresh: Boolean(entry.flags & DECK_FLAGS.fresh),
                  refed: Boolean(entry.flags & DECK_FLAGS.refed),
                  deposit: entry.deposit.toString(),
                },
              ]
            : [],
        ),
        vaultDeposits: [],
      });
    }
    if (path.startsWith("/api/xray/"))
      return json({ error: "unavailable" }, 503);
    if (path.startsWith("/api/royalties/")) return json([]);
    if (path === "/api/values") return json({ items: [] });
    if (path === "/api/feed/attest") {
      const body = route.request().postDataJSON();
      const mints: string[] = body.chunks.flatMap((chunk: { mint: string }[]) =>
        chunk.map((bag) => bag.mint),
      );
      attestRequests.push(mints);
      if (options.feedSuccess) {
        const expiry = Number(
          attestationExpiry(100n, ATTESTATIONS.feedTtlSeconds),
        );
        const bags = mints.map((address) => ({
          mint: new PublicKey(address),
          amount,
        }));
        const message = feedMessage({
          programId: PROGRAM_ID,
          wallet,
          nonce: 0,
          expiry: BigInt(expiry),
          bags,
        });
        return json({
          asOfSlot: 100,
          wallet: wallet.toBase58(),
          signer: intake.toBase58(),
          snapshotSlot: 1,
          refused: [],
          attestations: [
            {
              chunk: 0,
              nonce: 0,
              expiry,
              bagsHash: bagsHash(bags).toString("hex"),
              message: message.toString("base64"),
              signature: sign(null, message, signingKey).toString("base64"),
              bags: bags.map((bag) => ({
                mint: bag.mint.toBase58(),
                amount: bag.amount.toString(),
                decimals: 6,
                tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
                source: userAta(wallet, bag.mint, TOKEN_PROGRAM_ID).toBase58(),
                mergeFrom: [],
              })),
            },
          ],
        });
      }
      return json({
        asOfSlot: 100,
        wallet: wallet.toBase58(),
        signer: intake.toBase58(),
        snapshotSlot: 1,
        attestations: [],
        refused: mints.map((mint) => ({
          mint,
          reason: "snapshot_not_held",
          date: "2026-10-01",
        })),
      });
    }
    unexpected.push(`${route.request().method()} ${path}`);
    return json({ error: "unrecorded_fixture_request" }, 500);
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/feed");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Fixture Wallet", exact: true })
    .click();
  return { unexpected, methods, attestRequests, submitted: () => submitted };
}

test("W2 fixtures: D30 selection previews approvals and keeps dated intake refusals visible", async ({
  page,
}) => {
  const fixture = await setup(page);
  const boxes = page.locator(".feed-row input[type=checkbox]");
  await expect(boxes).toHaveCount(2);
  await expect(boxes.nth(0)).toBeChecked();
  await expect(boxes.nth(1)).toBeChecked();
  await expect(page.locator(".feed-lines")).toContainText(
    "2 transactions, 2 approvals",
  );
  await expect(page.getByRole("button", { name: /^Sell/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Keep/ })).toHaveCount(0);
  await boxes.nth(1).uncheck();
  await expect(page.locator(".feed-lines")).toContainText(
    "1 transaction, 1 approval",
  );
  const before = await walletStats(page);
  await page.locator(".feed-summary > button").click();
  await expect(page.locator(".feed-out > summary")).toBeVisible();
  await expect(page.locator(".feed-out")).not.toHaveAttribute("open");
  await expect(page.locator(".feed-out .feed-footnote")).not.toBeVisible();
  await page.locator(".feed-out > summary").click();
  await expect(page.locator(".feed-out .feed-footnote")).toBeVisible();
  await expect(page.locator(".feed-out .feed-footnote")).toHaveText(
    "Not held at the snapshot (bought Oct 1)",
  );
  expect(fixture.attestRequests).toEqual([[mint.toBase58()]]);
  expect((await walletStats(page)).prompts).toBe(before.prompts);
  expect(fixture.methods).not.toContain("simulateTransaction");
  expect(fixture.unexpected).toEqual([]);
});

for (const signAndSend of [true, false]) {
  test(`W2 fixtures: In the machine signs and reconciles take-back with services down (${signAndSend ? "send" : "sign"})`, async ({
    page,
  }) => {
    const fixture = await setup(page, {
      deposited: true,
      servicesDown: true,
      signAndSend,
    });
    await expect(
      page.getByRole("heading", { name: "In the machine" }),
    ).toBeVisible();
    await expect(page.locator(".machine-row")).toHaveCount(1);
    const before = await walletStats(page);
    await page.locator(".machine-row button").click();
    const dialog = page.getByRole("dialog", { name: "Take back", exact: true });
    await expect(dialog).toBeVisible();
    const approve = dialog.getByRole("button", { name: /^Take back/ });
    await expect(approve).toContainText("1 approval");
    expect(fixture.submitted()).toBe(0);
    await approve.click();
    await expect(page.locator(".machine-row")).toHaveCount(0);
    await expect(page.locator(".feed-machine")).toContainText(
      /Back in your wallet/,
    );
    expect(fixture.submitted()).toBe(1);
    expect((await walletStats(page)).prompts - before.prompts).toBe(1);
    expect(fixture.methods).toContain("simulateTransaction");
    expect(fixture.attestRequests).toEqual([]);
    expect(fixture.unexpected).toEqual([]);
  });
}

test("W2 fixtures: a signed Feed reconciles before the simplified success and In the machine rows", async ({
  page,
}) => {
  const fixture = await setup(page, { feedSuccess: true });
  await expect(page.locator(".feed-row input[type=checkbox]")).toHaveCount(2);
  await page.locator(".feed-row input[type=checkbox]").nth(1).uncheck();
  await expect(page.locator(".feed-lines")).toContainText(
    "1 transaction, 1 approval",
  );
  const before = await walletStats(page);
  await page.locator(".feed-summary > button").click();
  await expect(page.locator(".feed-done-line")).toHaveText(
    "Done. 1 Dust Card in the machine ✳ +0.01 SOL refund",
  );
  await expect(
    page.getByRole("heading", { name: "In the machine" }),
  ).toBeVisible();
  await expect(page.locator(".machine-row")).toHaveCount(1);
  await expect(page.locator(".machine-row button")).toBeEnabled();
  expect(fixture.submitted()).toBe(1);
  expect((await walletStats(page)).prompts - before.prompts).toBe(1);
  expect(fixture.methods).toContain("simulateTransaction");
  expect(fixture.attestRequests).toEqual([[mint.toBase58()]]);
  expect(fixture.unexpected).toEqual([]);
});
