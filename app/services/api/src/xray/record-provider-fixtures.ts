import { warnCause } from "@onepercent/service-kit";
/** Manual only, from app/services/api:
 * node --env-file=/absolute/path/.env.local --import tsx src/xray/record-provider-fixtures.ts
 * Queries a deterministic synthetic owner and recorded public mints only.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_IDS } from "@onepercent/eligibility";
import { z } from "zod";
import { heliusRpcUrl, parseXrayEnv } from "./env.js";

const providerRoot = new URL("./__fixtures__/", import.meta.url);
const accountRoot = new URL(
  "../../../../packages/eligibility/fixtures/",
  import.meta.url,
);
const slot = z.number().int().nonnegative().safe();
const context = z.object({ slot });
const account = z.object({
  owner: z.string(),
  lamports: slot,
  data: z.tuple([z.string(), z.literal("base64")]),
  executable: z.boolean(),
  rentEpoch: z.number(),
});
const envelope = z.object({
  result: z.unknown().optional(),
  error: z.object({ code: z.number() }).optional(),
});
async function readJson(url: URL): Promise<unknown> {
  return JSON.parse(await readFile(url, "utf8")) as unknown;
}

async function record(): Promise<void> {
  if (process.argv.length !== 2)
    throw new Error("No recording arguments are accepted");
  const env = parseXrayEnv({ ...process.env, XRAY_SOURCE: "live" });
  const rpcUrl = heliusRpcUrl(env);
  const wallet = z
    .object({ source: z.literal("synthetic"), owner: z.string(), slotS: slot })
    .parse(await readJson(new URL("wallets/trencher.json", accountRoot)));
  // Refuse a changed owner rather than ever persisting a real wallet scan.
  const owner = new PublicKey(
    createHash("sha256").update("xray-synthetic:trencher").digest(),
  ).toBase58();
  if (wallet.owner !== owner)
    throw new Error("Synthetic fixture owner mismatch");
  const mints = await Promise.all(
    ["fartcoin", "catcraft", "no-suffix"].map(
      async (name) =>
        z
          .object({
            source: z.literal("mainnet"),
            address: z.string(),
            owner: z.enum([PROGRAM_IDS.splToken, PROGRAM_IDS.token2022]),
          })
          .parse(await readJson(new URL(`mainnet/${name}.json`, accountRoot)))
          .address,
    ),
  );
  const requests: {
    name: string;
    method: string;
    params: unknown;
    schema: z.ZodType;
    mintAccounts?: boolean;
  }[] = [
    ...[
      ["spl", PROGRAM_IDS.splToken],
      ["token2022", PROGRAM_IDS.token2022],
    ].map(([kind, programId]) => ({
      name: `helius-getTokenAccountsByOwner-${kind}`,
      method: "getTokenAccountsByOwner",
      params: [
        owner,
        { programId },
        { encoding: "base64", commitment: "confirmed" },
      ],
      schema: z.object({ context, value: z.array(z.never()).length(0) }),
    })),
    {
      name: "helius-getMultipleAccounts",
      method: "getMultipleAccounts",
      params: [mints, { encoding: "base64", commitment: "confirmed" }],
      schema: z.object({
        context,
        value: z.array(account).length(mints.length),
      }),
      mintAccounts: true,
    },
    {
      name: "helius-getAssetsByOwner",
      method: "getAssetsByOwner",
      params: {
        ownerAddress: owner,
        page: 1,
        limit: 1000,
        options: { showFungible: true, showZeroBalance: true },
      },
      schema: z.object({
        items: z.array(z.never()).length(0),
        total: z.number().optional(),
        limit: z.number().optional(),
        page: z.number().optional(),
      }),
    },
    {
      name: "helius-getTransactionsForAddress",
      method: "getTransactionsForAddress",
      params: [
        owner,
        {
          transactionDetails: "full",
          encoding: "jsonParsed",
          sortOrder: "desc",
          commitment: "finalized",
          limit: 1,
          maxSupportedTransactionVersion: 1,
          filters: {
            slot: { lte: wallet.slotS },
            tokenAccounts: "balanceChanged",
            tokenTransfer: { mint: mints[0] },
          },
        },
      ],
      schema: z.object({
        data: z.array(z.never()).length(0),
        paginationToken: z.string().nullable().optional(),
      }),
    },
  ];
  for (const item of requests) {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: item.method,
        params: item.params,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const body = envelope.parse(await response.json());
    if (!response.ok || body.error)
      throw new Error("Provider recording request failed");
    const result = item.schema.parse(body.result);
    const recorded = {
      source: "mainnet",
      recordedAt: new Date().toISOString(),
      note: item.mintAccounts
        ? "Public recorded mint accounts only."
        : "Actual empty response queried for the synthetic trencher owner. No real wallet was queried.",
      request: { method: item.method, params: item.params },
      response: { jsonrpc: "2.0", id: 1, result },
    };
    await writeFile(
      new URL(`${item.name}.json`, providerRoot),
      JSON.stringify(recorded, null, 2) + "\n",
    );
    const recordedSlot = z.object({ context: context.optional() }).parse(result)
      .context?.slot;
    console.log(
      JSON.stringify({
        fixture: item.name,
        ...(recordedSlot === undefined ? {} : { slot: recordedSlot }),
      }),
    );
  }
}
try {
  await record();
} catch (error) {
  warnCause("provider_fixture_recording_failed", error);
  console.error("Provider fixture recording failed");
  process.exitCode = 1;
}
