import { DEVNET_GENESIS_HASH } from "@onepercent/config";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { t } from "@onepercent/copy";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";
import {
  decodeDeck,
  deckPda,
  EXTERNAL_IDS,
  fetchConfig,
  IDL,
  parseOnepercentLogs,
  userAta,
  vaultAta,
  vaultAuthPda,
  type Config,
  type IndexedOnepercentEvent,
} from "@onepercent/sdk";
import { ConfigResponse } from "@onepercent/sdk/api";
import { unpackAccount } from "@solana/spl-token";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import init from "../../../../fixtures/devnet/init.json" with { type: "json" };
import provisioning from "../../../../fixtures/devnet/provisioning.json" with { type: "json" };
import { base58 } from "../../src/util/bytes.js";
import { installWallet } from "../mock-wallet/index.js";

// This project never starts a backend or substitutes API/attestation fixtures.
// An explicit disposable wallet must already hold two available pump fixtures.
test.describe.configure({ timeout: 240_000 });
test.use({ trace: "off" });

const DEVNET_GENESIS = DEVNET_GENESIS_HASH;
type Stage = "feed" | "take_back";
type Receipt = { stage: Stage; signature: string; submitted: boolean };
type Entry = { mint: string; amount: string; deposit: string };

function roleAddresses(config: Config): string[] {
  return [
    config.admin,
    ...config.guardians,
    config.keeper,
    config.executor,
    config.intake_signer,
    config.quote_signer,
    config.launch_wallet,
    config.team_wallet,
    ...config.team_wallets,
  ].map((key) => key.toBase58());
}

async function disposableSigner(): Promise<Keypair> {
  const path = process.env.WEB_DEVNET_WALLET;
  if (!path || !isAbsolute(path))
    throw new Error(
      "WEB_DEVNET_WALLET must explicitly name a disposable test wallet outside the repository",
    );
  const root = fileURLToPath(new URL("../../../../../", import.meta.url));
  try {
    const resolved = await realpath(path);
    const location = relative(await realpath(root), resolved);
    const reserved =
      /(?:^|[-_.])(?:payer|admin|keeper|executor|intake|quote|guardian|launch|program|mint|lut)(?:[-_.]|$)/i;
    if (
      (!location.startsWith("..") && !isAbsolute(location)) ||
      [path, resolved].some(
        (item) =>
          reserved.test(basename(item)) ||
          basename(item) === "devnet-test-wallet.json",
      )
    )
      throw new Error("Reserved wallet file");
    const metadata = await stat(resolved);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0)
      throw new Error("The disposable wallet must be a private file");
    const value: unknown = JSON.parse(await readFile(resolved, "utf8"));
    if (
      !Array.isArray(value) ||
      value.length !== 64 ||
      !value.every(
        (byte: unknown) =>
          Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255,
      )
    )
      throw new Error("Invalid signer encoding");
    const bytes = Uint8Array.from(value as number[]);
    try {
      return Keypair.fromSecretKey(Uint8Array.from(bytes));
    } finally {
      bytes.fill(0);
      value.fill(0);
    }
  } catch {
    // Never include key material or the file contents in Playwright reports.
    throw new Error(
      "WEB_DEVNET_WALLET must contain a valid disposable test signer, outside the repository and separate from funding/role wallets",
    );
  }
}

test("W2 devnet: real X-ray, two Feed deposits and one take-back", async ({
  page,
}, testInfo) => {
  if (!process.env.WEB_DEVNET_URL)
    throw new Error(
      "WEB_DEVNET_URL must name an existing app with the Feed adapter in live mode",
    );
  const endpoint = process.env.WEB_DEVNET_RPC_URL ?? clusterApiUrl("devnet");
  if (new URL(endpoint).protocol !== "https:")
    throw new Error("WEB_DEVNET_RPC_URL must use HTTPS and serve devnet");
  const rpc = new Connection(endpoint, "confirmed");
  const assertDevnet = async () => {
    if (
      provisioning.cluster !== "devnet" ||
      provisioning.genesis !== DEVNET_GENESIS ||
      (await rpc.getGenesisHash()) !== DEVNET_GENESIS
    )
      throw new Error("The Feed devnet spec refuses any other genesis");
  };
  await assertDevnet();
  const configResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/config",
  );
  await page.goto("/x");
  const response = await configResponse;
  expect(
    response.ok(),
    "The real public config endpoint must be available",
  ).toBe(true);
  const publicConfig = ConfigResponse.parse(await response.json());
  expect(publicConfig.cluster).toBe("devnet");
  expect(publicConfig.programId).toBe(provisioning.deployment.program);
  expect(publicConfig.flags.XRAY).toBe(true);
  expect(publicConfig.flags.FEED).toBe(true);
  const programId = new PublicKey(publicConfig.programId);
  const config = await fetchConfig(programId, rpc);
  if (!config) throw new Error("The devnet Config account is unavailable");
  const forbidden = new Set([
    ...Object.values(provisioning.roles).flat(),
    ...Object.values(init).flat(),
    ...Object.values(publicConfig.roles ?? {}).flat(),
    ...roleAddresses(config),
    provisioning.deployment.authority,
    provisioning.addresses.wallet,
  ]);
  const signer = await disposableSigner();
  const owner = signer.publicKey;
  const address = owner.toBase58();
  if (forbidden.has(address))
    throw new Error(
      "Role, launch and deployment payer wallets cannot run the Feed user journey",
    );
  const receipts: Receipt[] = [];
  const evidence: Record<string, unknown> = {
    cluster: "devnet",
    genesis: DEVNET_GENESIS,
    programId: programId.toBase58(),
    wallet: address,
    receipts,
  };
  async function ownerDeck() {
    const info = await rpc.getAccountInfoAndContext(
      deckPda(programId)[0],
      "confirmed",
    );
    if (
      !info.value ||
      info.value.executable ||
      !info.value.owner.equals(programId)
    )
      throw new Error(
        "The devnet Deck account is unavailable or has the wrong owner",
      );
    return {
      slot: info.context.slot,
      entries: decodeDeck(info.value.data)
        .entries.filter((entry) => entry.depositor.equals(owner))
        .map((entry): Entry => ({
          mint: entry.mint.toBase58(),
          amount: entry.amount.toString(),
          deposit: entry.deposit.toString(),
        })),
    };
  }
  async function balance(mint: string) {
    const accounts = await rpc.getTokenAccountsByOwner(owner, {
      mint: new PublicKey(mint),
    });
    return accounts.value.reduce((total, item) => {
      const account = unpackAccount(
        item.pubkey,
        item.account,
        item.account.owner,
      );
      if (!account.owner.equals(owner) || account.mint.toBase58() !== mint)
        throw new Error("Unexpected token account identity");
      return total + account.amount;
    }, 0n);
  }
  async function snapshot(mints: string[]) {
    return {
      nativeLamports: await rpc.getBalance(owner),
      tokens: Object.fromEntries(
        await Promise.all(
          mints.map(async (mint) => [mint, (await balance(mint)).toString()]),
        ),
      ),
      deck: await ownerDeck(),
    };
  }
  try {
    const baseline = await ownerDeck();
    const available: { mint: string; amount: bigint }[] = [];
    for (const fixture of provisioning.pumpFixtures) {
      const amount = await balance(fixture.mint);
      if (
        amount > 0n &&
        !baseline.entries.some((entry) => entry.mint === fixture.mint)
      )
        available.push({ mint: fixture.mint, amount });
    }
    if (available.length < 2)
      throw new Error(
        "Two funded pump fixture mints with no current owner deposit are required; this spec does not provision assets or take back old deposits",
      );
    const selected = available.slice(0, 2);
    const mints = selected.map((item) => item.mint);
    const takeBackMint = mints[0]!;
    const remainingMint = mints[1]!;
    evidence.selected = selected;
    const before = await snapshot(mints);
    if (before.nativeLamports === 0)
      throw new Error(
        "The disposable wallet needs devnet SOL for fees and deposits; this spec does not fund wallets",
      );
    evidence.before = before;
    let stage: Stage = "feed";
    const allowedPrograms = new Set(
      [
        programId,
        EXTERNAL_IDS.splToken,
        EXTERNAL_IDS.token2022,
        EXTERNAL_IDS.associatedToken,
        EXTERNAL_IDS.computeBudget,
        EXTERNAL_IDS.ed25519,
      ].map((key) => key.toBase58()),
    );
    await installWallet(page, {
      signer,
      sendTransaction: async (bytes) => {
        await assertDevnet();
        const currentConfig = await fetchConfig(programId, rpc);
        if (!currentConfig || roleAddresses(currentConfig).includes(address))
          throw new Error(
            "The test wallet is no longer independent of protocol roles",
          );
        const transaction = VersionedTransaction.deserialize(bytes);
        expect(transaction.message.header.numRequiredSignatures).toBe(1);
        expect(transaction.message.staticAccountKeys[0]!.equals(owner)).toBe(
          true,
        );
        const lookups = [];
        for (const lookup of transaction.message.addressTableLookups) {
          const table = await rpc.getAddressLookupTable(lookup.accountKey);
          if (!table.value)
            throw new Error("Transaction lookup table is unavailable");
          lookups.push(table.value);
        }
        const message = TransactionMessage.decompile(transaction.message, {
          addressLookupTableAccounts: lookups,
        });
        let actions = 0;
        for (const ix of message.instructions) {
          expect(
            allowedPrograms.has(ix.programId.toBase58()),
            "Unexpected program in a Feed user transaction",
          ).toBe(true);
          if (
            ix.programId.equals(EXTERNAL_IDS.splToken) ||
            ix.programId.equals(EXTERNAL_IDS.token2022)
          ) {
            expect(stage).toBe("feed");
            if (ix.data[0] === 12) {
              const mint = ix.keys[1]!.pubkey;
              expect(mints).toContain(mint.toBase58());
              expect(ix.keys[3]!.pubkey.equals(owner)).toBe(true);
              expect([
                userAta(owner, mint, ix.programId).toBase58(),
                vaultAta(programId, mint, ix.programId).toBase58(),
              ]).toContain(ix.keys[2]!.pubkey.toBase58());
            } else {
              expect(
                ix.data[0],
                "Only checked transfers and owner account closes belong to Feed",
              ).toBe(9);
              expect(ix.keys[1]!.pubkey.equals(owner)).toBe(true);
              expect(ix.keys[2]!.pubkey.equals(owner)).toBe(true);
            }
          }
          if (ix.programId.equals(EXTERNAL_IDS.associatedToken)) {
            expect(ix.keys[0]!.pubkey.equals(owner)).toBe(true);
            expect(mints).toContain(ix.keys[3]!.pubkey.toBase58());
            expect([address, vaultAuthPda(programId)[0].toBase58()]).toContain(
              ix.keys[2]!.pubkey.toBase58(),
            );
          }
          if (!ix.programId.equals(programId)) continue;
          const discriminator = IDL.instructions.find(
            (item) => item.name === stage,
          )?.discriminator;
          if (!discriminator)
            throw new Error(
              "The SDK does not describe the expected instruction",
            );
          expect(ix.data.subarray(0, discriminator.length)).toEqual(
            Buffer.from(discriminator),
          );
          expect(ix.keys[0]!.pubkey.equals(owner)).toBe(true);
          if (stage === "take_back") {
            expect(ix.keys[3]!.pubkey.toBase58()).toBe(takeBackMint);
          } else {
            // The SDK Feed ABI places each mint first in a four-account group.
            const mintKeys = ix.keys
              .slice(7)
              .filter((_, index) => index % 4 === 0);
            expect(mintKeys.length).toBeGreaterThan(0);
            for (const key of mintKeys)
              expect(mints).toContain(key.pubkey.toBase58());
          }
          actions++;
        }
        if (stage === "take_back") expect(actions).toBe(1);
        const receipt = {
          stage,
          signature: base58(transaction.signatures[0]!),
          submitted: false,
        };
        receipts.push(receipt);
        const signature = await rpc.sendRawTransaction(bytes, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 0,
        });
        expect(signature).toBe(receipt.signature);
        receipt.submitted = true;
      },
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Fixture Wallet", exact: true })
      .click();
    const xrayResponse = page.waitForResponse(
      (item) => new URL(item.url()).pathname === `/api/xray/${address}`,
    );
    await page.locator(".xray-field input").fill(address);
    await page.locator(".xray-field button").click();
    const scan = await xrayResponse;
    expect(
      scan.ok(),
      "A real X-ray response is required, including any deployed challenge policy",
    ).toBe(true);
    const xray = XrayResultSchema.parse(await scan.json());
    expect(xray.address).toBe(address);
    for (const mint of mints)
      expect(
        xray.bags.find((bag) => bag.mint === mint)?.buckets,
        `Fixture ${mint} must be feedable in the real X-ray`,
      ).toContain("feedable");
    evidence.xray = { scannedAt: xray.scannedAt, cached: xray.cached };
    await page.locator("a.xray-next[href='/feed']").click();
    for (const mint of mints)
      await expect(
        page.locator(`.feed-row[data-mint='${mint}'] input[type=checkbox]`),
      ).toBeVisible();
    const checkboxes = page.locator(".feed-row input[type=checkbox]");
    for (let index = 0; index < (await checkboxes.count()); index++)
      await checkboxes.nth(index).uncheck();
    for (const mint of mints)
      await page
        .locator(`.feed-row[data-mint='${mint}'] input[type=checkbox]`)
        .check();
    await expect(page.locator(".feed-row input:checked")).toHaveCount(2);
    const [attestation] = await Promise.all([
      page.waitForResponse(
        (item) =>
          new URL(item.url()).pathname === "/api/feed/attest" &&
          item.request().method() === "POST",
        { timeout: 90_000 },
      ),
      (async () => {
        await page.locator(".feed-summary > button").click();
        await expect
          .poll(
            async () => {
              const confirm = page.getByRole("dialog").getByRole("button", {
                name: t("feed.confirm.yes"),
                exact: true,
              });
              if (await confirm.isVisible()) await confirm.click();
              return page.locator(".feed-done").isVisible();
            },
            {
              timeout: 90_000,
              message:
                "The real Feed flow must finish with chain-confirmed deposits",
            },
          )
          .toBe(true);
      })(),
    ]);
    expect(
      attestation.ok(),
      "The live intake signer must attest these bags",
    ).toBe(true);
    const afterFeed = await snapshot(mints);
    evidence.afterFeed = afterFeed;
    expect(afterFeed.deck.entries).toHaveLength(baseline.entries.length + 2);
    for (const item of selected) {
      expect(afterFeed.tokens[item.mint]).toBe("0");
      expect(
        afterFeed.deck.entries.filter((entry) => entry.mint === item.mint),
      ).toEqual([
        expect.objectContaining({
          mint: item.mint,
          amount: item.amount.toString(),
        }),
      ]);
    }
    await expect(
      page.getByRole("heading", { name: t("takeBack.title"), exact: true }),
    ).toBeVisible();
    await expect(page.locator(".machine-row")).toHaveCount(
      afterFeed.deck.entries.length,
    );
    stage = "take_back";
    const takeBackIndex = afterFeed.deck.entries.findIndex(
      (entry) => entry.mint === takeBackMint,
    );
    await page
      .locator(".machine-row")
      .nth(takeBackIndex)
      .getByRole("button", { name: t("takeBack.button"), exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Take back/ })
      .click();
    await expect
      .poll(
        async () =>
          (await ownerDeck()).entries.filter(
            (entry) => entry.mint === takeBackMint,
          ).length,
        { timeout: 60_000 },
      )
      .toBe(0);
    const afterTakeBack = await snapshot(mints);
    evidence.afterTakeBack = afterTakeBack;
    expect(afterTakeBack.deck.entries).toHaveLength(
      baseline.entries.length + 1,
    );
    expect(afterTakeBack.tokens[takeBackMint]).toBe(
      selected[0]!.amount.toString(),
    );
    expect(afterTakeBack.tokens[remainingMint]).toBe("0");
    expect(afterTakeBack.deck.entries).toEqual(
      expect.arrayContaining([
        ...baseline.entries,
        expect.objectContaining({
          mint: remainingMint,
          amount: selected[1]!.amount.toString(),
        }),
      ]),
    );
    await expect(page.locator(".machine-row")).toHaveCount(
      afterTakeBack.deck.entries.length,
    );
    await page.reload();
    await expect(page.locator(".machine-row")).toHaveCount(
      afterTakeBack.deck.entries.length,
    );
    const events: IndexedOnepercentEvent[] = [];
    for (const receipt of receipts) {
      expect(receipt.submitted).toBe(true);
      const readReceipt = () =>
        rpc.getTransaction(receipt.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
      await expect
        .poll(async () => Boolean(await readReceipt()), { timeout: 30_000 })
        .toBe(true);
      const landed = await readReceipt();
      expect(landed?.meta?.err).toBeNull();
      if (!landed?.meta)
        throw new Error("A confirmed transaction receipt is required");
      const keys = landed.transaction.message.getAccountKeys({
        accountKeysFromLookups: landed.meta.loadedAddresses,
      });
      const parsed = parseOnepercentLogs({
        programId: programId.toBase58(),
        logs: landed.meta.logMessages ?? null,
        err: landed.meta.err,
        topLevelProgramIds: landed.transaction.message.compiledInstructions.map(
          (ix) => keys.get(ix.programIdIndex)!.toBase58(),
        ),
      });
      expect(parsed.malformed || parsed.truncated || parsed.unknownEvent).toBe(
        false,
      );
      events.push(...parsed.events);
      Object.assign(receipt, {
        slot: landed.slot,
        feeLamports: landed.meta.fee,
        events: parsed.events,
      });
    }
    const fed = events.filter((event) => event.name === "BagFed");
    expect(fed).toHaveLength(2);
    for (const item of selected)
      expect(fed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              depositor: address,
              mint: item.mint,
              amount: item.amount,
            }),
          }),
        ]),
      );
    const returned = events.filter((event) => event.name === "BagTakenBack");
    expect(returned).toHaveLength(1);
    expect(returned[0]!.data).toEqual(
      expect.objectContaining({
        depositor: address,
        mint: takeBackMint,
        amount: selected[0]!.amount,
      }),
    );
  } finally {
    await testInfo.attach("feed-devnet-public-evidence", {
      contentType: "application/json",
      body: JSON.stringify(
        evidence,
        (_, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
        2,
      ),
    });
  }
});
