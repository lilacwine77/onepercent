import { PROGRAM_ID } from "../../../../packages/sdk/tests/program-id.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { FeatureFlags } from "@onepercent/sdk/api";
import { fetchMintDecimals, fetchPull, drawTier } from "@onepercent/sdk";
import { createPublicData } from "../../../../services/api/src/public/data/index.js";
import type { Page } from "@playwright/test";
import type { Manifest } from "../../../../scripts/e2e-validator.js";
import { installWallet } from "../mock-wallet/index.js";

export async function validatorContext() {
  const endpoint = new URL(process.env.WEB_VALIDATOR_RPC_URL ?? "");
  assert(
    endpoint.protocol === "http:" &&
      endpoint.hostname === "127.0.0.1" &&
      !endpoint.username &&
      !endpoint.password,
    "Only disposable localhost validator RPC is allowed",
  );
  assert(
    process.env.WEB_VALIDATOR_MANIFEST,
    "Run through test:e2e:validator:run",
  );
  const manifest = JSON.parse(
    await readFile(process.env.WEB_VALIDATOR_MANIFEST, "utf8"),
  ) as Manifest;
  const rpc = new Connection(endpoint.href, "confirmed");
  const buyer = Keypair.fromSecretKey(
    Uint8Array.from(manifest.wallets.buyer.secretKey),
  );
  assert.equal(buyer.publicKey.toBase58(), manifest.wallets.buyer.publicKey);
  return { rpc, buyer, manifest };
}
export async function prepareValidatorPage(
  page: Page,
  context: Awaited<ReturnType<typeof validatorContext>>,
) {
  const { rpc, buyer, manifest } = context;
  const flags = FeatureFlags.parse(
    Object.fromEntries(
      Object.keys(FeatureFlags.shape).map((name) => [
        name,
        ["PACKS", "FEED", "TV_LIVE"].includes(name),
      ]),
    ),
  );
  const reader = createPublicData({
    runtime: {
      env: { CLUSTER: "devnet", PROGRAM_ID: PROGRAM_ID.toBase58() },
      rpc: {
        async request(
          method: string,
          params: unknown[],
          schema: { parse(value: unknown): unknown },
        ) {
          const result = (await fetch(rpc.rpcEndpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          }).then((response) => response.json())) as {
            result?: unknown;
            error?: unknown;
          };
          assert(!result.error, JSON.stringify(result.error));
          return schema.parse(result.result);
        },
        async chainNow() {
          const account = await rpc.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
          assert(account);
          return account.data.readBigInt64LE(32);
        },
      },
      pool: {
        query: async () => {
          throw new Error("No indexer in the browser validator harness");
        },
      },
    } as unknown as Parameters<typeof createPublicData>[0]["runtime"],
    flags,
    vrf: async () => ({
      queue: manifest.queue,
      occupancyBps: 0,
      oldestItemAgeSeconds: 0,
      busy: false,
    }),
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body });
    try {
      if (url.pathname === "/api/rpc") {
        const response = await fetch(rpc.rpcEndpoint, {
          method: "POST",
          body: route.request().postData(),
          headers: { "content-type": "application/json" },
        });
        return route.fulfill({
          status: response.status,
          contentType: "application/json",
          body: await response.text(),
        });
      }
      if (url.pathname === "/api/config") return json(await reader.config());
      if (url.pathname === "/api/machine") return json(await reader.machine());
      if (url.pathname === "/api/web/config")
        return json({
          lookupTable: null,
          adminMultisig: null,
          flags: { XRAY: false },
          modes: { rip: "live", cards: "live", verify: "live", feed: "live" },
        });
      if (url.pathname === "/api/values") {
        const body = route.request().postDataJSON() as {
          items: { mint: string; amount: string }[];
        };
        return json({
          items: await Promise.all(
            body.items.map(async (item) => ({
              ...item,
              symbol: null,
              name: null,
              logo: null,
              decimals: (await fetchMintDecimals(rpc, new PublicKey(item.mint)))
                .decimals,
              value: { status: "unavailable", reason: "CAP_UNAVAILABLE" },
            })),
          ),
        });
      }
      if (url.pathname === "/api/events") return json([]);
      if (url.pathname === "/api/beacon") return route.fulfill({ status: 204 });
      return json({ error: "unavailable" }, 503);
    } catch {
      return json({ error: "unavailable" }, 503);
    }
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  return installWallet(page, { signer: buyer, rpc });
}
export async function connectValidatorWallet(page: Page) {
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Fixture Wallet", exact: true })
    .click();
}
export async function waitForPull(rpc: Connection, address: PublicKey) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    const pull = await fetchPull(PROGRAM_ID, rpc, address);
    if (pull) return pull;
    await delay(100);
  }
  throw new Error("The browser buy did not produce its expected Pull");
}
export function randomnessForTier(
  seq: bigint,
  edition: number,
  tier: number,
  liveFlags: number,
) {
  for (let nonce = 0; nonce < 100_000; nonce++) {
    const bytes = createHash("sha256")
      .update(`onepercent-w3-tier:${seq}:${tier}:${nonce}`)
      .digest();
    if (drawTier(bytes, seq, 0, edition, liveFlags).tier === tier) return bytes;
  }
  throw new Error("Requested tier unavailable in the injected live mask");
}
