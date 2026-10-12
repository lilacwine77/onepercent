import { PROGRAM_ID as GOLDEN_PROGRAM_ID } from "../../../../packages/sdk/tests/program-id.js";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { AccountLayout, MintLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  ACCOUNT_SIZES,
  feedBackEstimate,
  PUMP_LAYOUTS,
  STOCK,
} from "@onepercent/config";
import {
  binderPda,
  bondingCurvePda,
  configPda,
  decodeBinder,
  decodeDeck,
  decodeMintLedger,
  deckPda,
  encodeConfig,
  encodeDeck,
  encodeMachine,
  EXTERNAL_IDS,
  feeInPda,
  ledgerPda,
  machinePda,
  userAta,
  vaultAuthPda,
} from "@onepercent/sdk";
import {
  ConfigResponse,
  FeedAttestResponse,
  MachineResponse,
  MeResponse,
} from "@onepercent/sdk/api";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";
import { createMintSafetyClient } from "../../../../packages/market/src/index.js";
import { createFeedChainReader } from "../../../../services/api/src/intake/chain.js";
import {
  createIntakeService,
  type FeedLogRow,
} from "../../../../services/api/src/intake/service.js";
import { checkSignedTransaction } from "../../../../services/api/src/web/send.js";
import * as responseFixtures from "../../../../packages/sdk/src/api/__fixtures__/responses.js";
import type { z } from "zod";
import { reservePorts } from "../../tests/chain/validator.js";

// Explicit identity for an existing local validator artifact, never a remote send target.
export const FEED_PROGRAM_ID = process.env.WEB_FEED_PROGRAM_ID
  ? new PublicKey(process.env.WEB_FEED_PROGRAM_ID)
  : GOLDEN_PROGRAM_ID;
const PROGRAM_ID = FEED_PROGRAM_ID;

const apiPort = 4175;
const fixtureFunding = 100_000_000_000;
const fixtureAccountLamports = 10_000_000;
const fixtureAmount = 1_000_000n;

/**
 * Real validator and production S2 reads/signing, with explicit synthetic
 * provenance and in-memory projections. No remote RPC and no retained ledger.
 */
export async function startFeedValidator(input: {
  wallet: string;
  bags: number;
  split?: boolean;
  empties?: number;
}) {
  const artifact = resolve(
    process.env.WEB_PROGRAM_ARTIFACT ?? "../../target/deploy/onepercent.so",
  );
  const elf = await readFile(artifact);
  assert.equal(elf.subarray(0, 6).toString("hex"), "7f454c460201");
  assert.equal(elf.readUInt32LE(48), 3, "Feed requires the v3 artifact");
  assert.match(
    execFileSync("solana-test-validator", ["--version"], {
      encoding: "utf8",
    }),
    /^solana-test-validator 4\.3\.0(?:\s|$)/,
  );
  const directory = await mkdtemp(join(tmpdir(), "onepercent-web-feed-"));
  const wallet = new PublicKey(input.wallet);
  const intake = Keypair.generate();
  const now = Math.floor(Date.now() / 1000);
  const accounts: string[] = [];
  async function account(
    address: PublicKey,
    owner: PublicKey,
    data: Buffer = Buffer.alloc(0),
    lamports = fixtureAccountLamports,
  ) {
    const file = join(directory, `${address.toBase58()}.json`);
    await writeFile(
      file,
      JSON.stringify({
        pubkey: address.toBase58(),
        account: {
          lamports,
          data: [data.toString("base64"), "base64"],
          owner: owner.toBase58(),
          executable: false,
          rentEpoch: 0,
        },
      }),
    );
    accounts.push("--account", address.toBase58(), file);
  }
  await account(
    wallet,
    SystemProgram.programId,
    Buffer.alloc(0),
    fixtureFunding,
  );
  await account(
    configPda(PROGRAM_ID)[0],
    PROGRAM_ID,
    encodeConfig({
      version: 1,
      bump: configPda(PROGRAM_ID)[1],
      intake_signer: intake.publicKey,
      season_set: 1,
      snapshot_slot: 1n,
      snapshot_ts: BigInt(now - 1),
      stock_up_ts: BigInt(now - 1),
    }),
  );
  await account(
    machinePda(PROGRAM_ID)[0],
    PROGRAM_ID,
    encodeMachine({
      version: 1,
      bump: machinePda(PROGRAM_ID)[1],
      phase: 1,
      vault_auth_bump: vaultAuthPda(PROGRAM_ID)[1],
      deck_bump: deckPda(PROGRAM_ID)[1],
      config_bump: configPda(PROGRAM_ID)[1],
      fee_in_bump: feeInPda(PROGRAM_ID)[1],
    }),
    fixtureFunding,
  );
  await account(
    deckPda(PROGRAM_ID)[0],
    PROGRAM_ID,
    encodeDeck({ bump: deckPda(PROGRAM_ID)[1], version: 1 }),
  );
  const mints: PublicKey[] = [];
  const sources: PublicKey[] = [];
  const emptyAccounts: PublicKey[] = [];
  const splitAccounts: PublicKey[] = [];
  async function token(address: PublicKey, mint: PublicKey, amount: bigint) {
    const data = Buffer.alloc(AccountLayout.span);
    AccountLayout.encode(
      {
        mint,
        owner: wallet,
        amount,
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
    await account(address, TOKEN_PROGRAM_ID, data);
  }
  async function mintAccount(mint: PublicKey, supply: bigint) {
    const data = Buffer.alloc(MintLayout.span);
    MintLayout.encode(
      {
        mintAuthorityOption: 0,
        mintAuthority: PublicKey.default,
        supply,
        decimals: 6,
        isInitialized: true,
        freezeAuthorityOption: 0,
        freezeAuthority: PublicKey.default,
      },
      data,
    );
    await account(mint, TOKEN_PROGRAM_ID, data);
  }
  for (let index = 0; index < input.bags; index++) {
    const mint = Keypair.generate().publicKey;
    mints.push(mint);
    await mintAccount(mint, fixtureAmount);
    const curve = Buffer.alloc(81);
    Buffer.from(PUMP_LAYOUTS.bondingCurveDiscriminatorHex, "hex").copy(curve);
    await account(bondingCurvePda(mint)[0], EXTERNAL_IDS.pumpFun, curve);
    const source = userAta(wallet, mint, TOKEN_PROGRAM_ID);
    sources.push(source);
    await token(
      source,
      mint,
      input.split && index === 0 ? fixtureAmount / 2n : fixtureAmount,
    );
    if (input.split && index === 0) {
      const extra = Keypair.generate().publicKey;
      splitAccounts.push(extra);
      await token(extra, mint, fixtureAmount / 2n);
    }
  }
  const emptyMint = Keypair.generate().publicKey;
  if (input.empties) await mintAccount(emptyMint, 0n);
  for (let index = 0; index < (input.empties ?? 0); index++) {
    const address = Keypair.generate().publicKey;
    emptyAccounts.push(address);
    await token(address, emptyMint, 0n);
  }
  const ports = await reservePorts();
  const port = ports.first;
  const rpcUrl = `http://127.0.0.1:${port}`;
  await ports.release();
  const validator = spawn(
    "solana-test-validator",
    [
      "--ledger",
      join(directory, "ledger"),
      "--reset",
      "--log",
      "--bind-address",
      "127.0.0.1",
      "--rpc-port",
      String(port),
      "--faucet-port",
      String(port + 2),
      "--gossip-port",
      String(port + 3),
      "--dynamic-port-range",
      `${port + 8}-${port + 40}`,
      "--limit-blockstore-size",
      "10000",
      "--upgradeable-program",
      PROGRAM_ID.toBase58(),
      artifact,
      "none",
      ...accounts,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  const record = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-8000);
  };
  validator.stdout.on("data", record);
  validator.stderr.on("data", record);
  let closed = false;
  const ended = new Promise<void>((yes) =>
    validator.once("close", () => {
      closed = true;
      yes();
    }),
  );
  const connection = new Connection(rpcUrl, "confirmed");
  let server: ReturnType<typeof createServer> | undefined;
  async function close() {
    if (server)
      await new Promise<void>((yes) => {
        server!.closeAllConnections();
        server!.close(() => yes());
      });
    if (!closed) {
      validator.kill("SIGTERM");
      const timer = setTimeout(() => validator.kill("SIGKILL"), 3000);
      await ended;
      clearTimeout(timer);
    }
    await rm(directory, { recursive: true, force: true });
  }
  try {
    const deadline = Date.now() + 45_000;
    for (;;) {
      if (closed) throw new Error(`Feed validator exited: ${output}`);
      if ((await connection.getSlot().catch(() => 0)) >= 2) break;
      if (Date.now() > deadline)
        throw new Error(`Feed validator not ready: ${output}`);
      await delay(100);
    }
    const program = await connection.getAccountInfo(PROGRAM_ID);
    assert(program?.executable, "Validator did not load the program");
    assert.equal(program.data.readUInt32LE(0), 2);
    const deployed = await connection.getAccountInfo(
      new PublicKey(program.data.subarray(4, 36)),
    );
    assert(deployed, "Validator program data is missing");
    assert.deepEqual(
      deployed.data.subarray(45, 45 + elf.length),
      elf,
      "Validator must execute the exact checked v3 artifact",
    );
    const rpc = {
      async request<T>(
        method: string,
        params: unknown[],
        schema: z.ZodType<T>,
      ): Promise<T> {
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        });
        const body = (await response.json()) as {
          result: unknown;
          error?: unknown;
        };
        if (body.error)
          throw new Error(
            `Validator ${method} failed: ${JSON.stringify(body.error)}`,
          );
        return schema.parse(body.result);
      },
    };
    const safety = createMintSafetyClient({
      env: { pythHermesUrl: rpcUrl },
      fetch,
      rpc: {
        call: (schema, method, params) => rpc.request(method, params, schema),
      },
    });
    const chain = createFeedChainReader(rpc, PROGRAM_ID, safety);
    const logs: FeedLogRow[] = [];
    const refused = new Map<string, string>();
    const state = {
      feedEnabled: true,
      publicReads: true,
      sendAttempts: 0,
      dropSend: -1,
    };
    const privateKey = createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        intake.secretKey.subarray(0, 32),
      ]),
      format: "der",
      type: "pkcs8",
    });
    const blockTime = async () => {
      const time = await connection.getBlockTime(await connection.getSlot());
      assert(time !== null);
      return time;
    };
    const intakeService = createIntakeService({
      programId: PROGRAM_ID,
      signer: {
        publicKey: intake.publicKey,
        signMessage: (message) => sign(null, message, privateKey),
      },
      guard: { assertAuthorized() {} },
      blockTimeNow: blockTime,
      readState: chain.state,
      readBag: async (wallet, mint, slot, signal) => {
        const reason = refused.get(mint);
        if (reason === "not_supported" || reason === "not_pump_fun")
          return { ok: false, slot, reason };
        return chain.bag(wallet, mint, slot, signal);
      },
      history: async (wallet, mint, snapshotSlot) => ({
        wallet,
        mint,
        snapshotSlot,
        balanceAtS: fixtureAmount,
        first: {
          kind: "swap",
          sender: null,
          slot: 0,
          signature: "synthetic-provenance",
          date: new Date((now - 2) * 1000).toISOString(),
        },
      }),
      live: async () => ({ consumption: [], liveCard: null }),
      indexerTime: blockTime,
      appendLogs: async (rows) => {
        logs.push(...rows);
      },
    });
    async function deck() {
      const info = await connection.getAccountInfo(deckPda(PROGRAM_ID)[0]);
      assert(info);
      return decodeDeck(info.data);
    }
    async function me() {
      const slot = await connection.getSlot();
      const info = await connection.getAccountInfo(
        binderPda(PROGRAM_ID, wallet)[0],
      );
      const binder = info ? decodeBinder(info.data) : null;
      const entries = (await deck()).entries;
      const vaultDeposits = [];
      for (const mint of mints) {
        const ledgerInfo = await connection.getAccountInfo(
          ledgerPda(PROGRAM_ID, mint)[0],
        );
        if (!ledgerInfo) continue;
        const ledger = decodeMintLedger(ledgerInfo.data);
        vaultDeposits.push({
          mint: mint.toBase58(),
          payerIsWallet: ledger.payer.equals(wallet),
          accounted: ledger.accounted.toString(),
          vaultExists: true,
          state: "held",
        });
      }
      return MeResponse.parse({
        ...responseFixtures.me,
        asOfSlot: slot,
        binder: binder
          ? {
              owner: wallet.toBase58(),
              referrer: binder.referrer.toBase58(),
              seasonSpend: binder.season_spend.toString(),
              solOwed: binder.sol_owed.toString(),
              feedNonceBase: binder.feed_nonce_base,
              sbNonce: binder.sb_nonce,
              pullNonce: binder.pull_nonce,
              feedNonceBits: binder.feed_nonce_bits,
              freshInDeck: binder.fresh_in_deck,
              len: binder.len,
              cap: binder.cap,
              reserved: binder.reserved,
              bump: binder.bump,
              flags: binder.flags,
              cards: [],
              closable: binder.fresh_in_deck === 0,
            }
          : null,
        deck: entries.flatMap((entry, deckIndex) =>
          entry.depositor.equals(wallet)
            ? [
                {
                  asOfSlot: slot,
                  deckIndex,
                  mint: entry.mint.toBase58(),
                  amount: entry.amount.toString(),
                  fresh: entry.flags === 1,
                  refed: entry.flags !== 1,
                  deposit: entry.deposit.toString(),
                },
              ]
            : [],
        ),
        pulls: { pending: [], settleable: [] },
        vaultDeposits,
      });
    }
    async function xray() {
      const held = await connection.getTokenAccountsByOwner(wallet, {
        programId: TOKEN_PROGRAM_ID,
      });
      const amounts = new Map<string, bigint>();
      for (const item of held.value) {
        const data = AccountLayout.decode(item.account.data);
        const mint = data.mint.toBase58();
        amounts.set(mint, (amounts.get(mint) ?? 0n) + data.amount);
      }
      const bags = mints
        .filter((mint) => (amounts.get(mint.toBase58()) ?? 0n) > 0n)
        .map((mint, i) => ({
          mint: mint.toBase58(),
          symbol: `TEST${i + 1}`,
          name: `Validator bag ${i + 1}`,
          logoUrl: null,
          amountUi: "1",
          decimals: 6,
          tokenProgram: "spl",
          buckets: ["feedable"],
          reasonCode: "snapshot_at_feed",
        }));
      return XrayResultSchema.parse({
        address: wallet.toBase58(),
        chain: "solana",
        scannedAt: new Date().toISOString(),
        cached: false,
        counts: {
          bags: bags.length,
          feedable: bags.length,
          checkAtFeed: 0,
          notFeedable: 0,
          sellable: 0,
          empty: 0,
          notInSet: 0,
        },
        totals: { sellValueSol: "0", rentBackSol: "0" },
        worst: null,
        bags,
        emptyAccounts: [],
        card: { title: "Validator", condition: "Mint", oneLiner: "Validator" },
        share: {
          landscapeUrl: "http://127.0.0.1/card.png",
          squareUrl: "http://127.0.0.1/card.png",
          xIntentUrl: "https://x.com/intent/post",
        },
      });
    }
    server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const json = (body: unknown, status = 200) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      let body = "";
      for await (const chunk of request) body += chunk;
      try {
        if (url.pathname === "/api/rpc") {
          const upstream = await fetch(rpcUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          });
          return json(await upstream.json());
        }
        if (url.pathname === "/api/send") {
          const tx = (JSON.parse(body) as { tx: string }).tx;
          const signature = checkSignedTransaction(tx);
          if (state.sendAttempts++ !== state.dropSend)
            await connection.sendRawTransaction(Buffer.from(tx, "base64"), {
              skipPreflight: false,
            });
          return json({ signature });
        }
        if (
          !state.publicReads &&
          !["/api/web/config", "/api/config"].includes(url.pathname)
        )
          return json({ reason: "unavailable" }, 503);
        if (url.pathname === "/api/web/config")
          return json({
            lookupTable: null,
            adminMultisig: null,
            flags: { XRAY: true },
            modes: { feed: "live" },
          });
        if (url.pathname === "/api/config")
          return json(
            ConfigResponse.parse({
              ...responseFixtures.config,
              programId: PROGRAM_ID.toBase58(),
              asOfSlot: await connection.getSlot(),
              phase: 1,
              flags: {
                ...responseFixtures.flags,
                FEED: state.feedEnabled,
                XRAY: true,
              },
              roles: {
                ...responseFixtures.config.roles,
                intakeSigner: intake.publicKey.toBase58(),
              },
              season: {
                ...responseFixtures.config.season,
                snapshotTs: now - 1,
                stockUpTs: now - 1,
              },
            }),
          );
        if (url.pathname === "/api/machine")
          return json(
            MachineResponse.parse({
              ...responseFixtures.machine,
              asOfSlot: await connection.getSlot(),
              phase: 1,
              stock: {
                ...responseFixtures.machine.stock,
                stockSol: "0",
                target: STOCK.targetBaseLamports.toString(),
              },
              deck: {
                len: (await deck()).len,
                reservedDust: "0",
                free: (await deck()).len,
              },
              feedBack: {
                estimate: feedBackEstimate([0, 0, 0, 0]).toString(),
                mix: [0, 0, 0, 0],
              },
            }),
          );
        if (url.pathname.startsWith("/api/me/")) return json(await me());
        if (url.pathname.startsWith("/api/xray/")) return json(await xray());
        if (url.pathname === "/api/feed/attest")
          return json(
            FeedAttestResponse.parse(
              await intakeService.handle(JSON.parse(body), "0".repeat(64)),
            ),
          );
        if (url.pathname === "/api/beacon") {
          response.writeHead(204);
          response.end();
          return;
        }
        if (url.pathname === "/api/values") return json({ items: [] });
        return json({ reason: "unavailable" }, 503);
      } catch (error) {
        const failure = error as { reason?: string; status?: number };
        return json(
          { reason: failure.reason ?? "unavailable" },
          failure.status ?? 503,
        );
      }
    });
    await new Promise<void>((yes, no) => {
      server!.once("error", no);
      server!.listen(apiPort, "127.0.0.1", yes);
    });
    return {
      connection,
      wallet,
      mints,
      sources,
      emptyAccounts,
      splitAccounts,
      state,
      refused,
      logs,
      deck,
      me,
      close,
      amount: fixtureAmount,
      artifactSha256: createHash("sha256").update(elf).digest("hex"),
      async deposits() {
        const rent = (size: number) =>
          connection.getMinimumBalanceForRentExemption(size);
        const entry = BigInt(
          (await rent(ACCOUNT_SIZES.deckHeader + ACCOUNT_SIZES.deckEntry)) -
            (await rent(ACCOUNT_SIZES.deckHeader)),
        );
        return {
          entry,
          binder: BigInt(await rent(ACCOUNT_SIZES.binderHeader)),
          firstCoin: BigInt(
            (await rent(ACCOUNT_SIZES.mintLedger)) +
              (await rent(AccountLayout.span)),
          ),
        };
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export type FeedValidator = Awaited<ReturnType<typeof startFeedValidator>>;
