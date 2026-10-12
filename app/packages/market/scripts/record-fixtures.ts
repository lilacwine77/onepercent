import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import {
  decodeBondingCurve,
  decodePumpPool,
  deriveBondingCurve,
  deriveCanonicalPool,
} from "../src/chain/pump-layouts.js";
import {
  majorSellProbeAmount,
  dailyCloseTimes,
} from "../src/listing/evidence.js";
import { pythPriceUpdateSchema } from "../src/pyth/hermes.js";
import { loadMarketEnv } from "../src/env.js";
import {
  HIT_LIST,
  LAMPORTS_PER_SOL,
  BPS_DENOMINATOR,
  MARKET,
  MILLISECONDS_PER_SECOND,
  WSOL_MINT,
  XRAY,
} from "../src/params.js";

// Manual only: pnpm fixtures:record --env-file /absolute/path/to/.env.local
// All secrets enter through loadMarketEnv; neither requests nor errors print them.
const envFileIndex = process.argv.indexOf("--env-file");
const input =
  envFileIndex < 0
    ? process.env
    : {
        ...process.env,
        ...parseEnv(await readFile(process.argv[envFileIndex + 1]!, "utf8")),
      };
const env = loadMarketEnv(input);
const directory = fileURLToPath(new URL("../tests/fixtures/", import.meta.url));
const tokenSchema = z
  .object({
    id: z.string(),
    symbol: z.string(),
    name: z.string(),
    priceBlockId: z.number().optional(),
    launchpad: z.string().nullish(),
    graduatedPool: z.string().nullish(),
    graduatedAt: z.string().nullish(),
  })
  .passthrough();
const tokensSchema = z.array(tokenSchema);
type Fixture = {
  recordedAt: string;
  request: { method: string; url: string; body?: unknown };
  response: { status: number; headers: Record<string, string>; body: unknown };
  synthetic?: { from: string; edit: string };
  provenance?: Record<string, unknown>;
};
// Check credential components too: an upstream error can echo a key without
// echoing the complete RPC URL. Long path segments cover path-based RPC tokens.
const rpcUrl = env.solanaRpcUrl ? new URL(env.solanaRpcUrl) : undefined;
const secrets = [
  env.jupiterApiKey,
  env.pythHermesApiKey,
  env.solanaRpcUrl,
  rpcUrl?.username,
  rpcUrl?.password,
  ...[...(rpcUrl?.searchParams.entries() ?? [])]
    .filter(([name]) => /key|token|secret|auth|password|credential/i.test(name))
    .map(([, value]) => value),
  ...(rpcUrl?.pathname.split("/").filter((part) => part.length >= 16) ?? []),
]
  .filter((value): value is string => Boolean(value))
  .flatMap((value) => {
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      // Keep the original component when the provider uses literal percent text.
    }
    return [value, decoded, encodeURIComponent(decoded)];
  });

function assertRedacted(value: unknown): void {
  const encoded = JSON.stringify(value);
  if (
    secrets.some(
      (secret) =>
        encoded.includes(secret) ||
        encoded.includes(JSON.stringify(secret).slice(1, -1)),
    )
  ) {
    throw new Error("Fixture redaction failed");
  }
}

async function save(name: string, fixture: Fixture): Promise<void> {
  assertRedacted(fixture);
  const destination = `${directory}${name}.json`;
  await mkdir(destination.slice(0, destination.lastIndexOf("/")), {
    recursive: true,
  });
  await writeFile(destination, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`${name}: HTTP ${fixture.response.status}`);
}

async function request(
  url: string,
  body?: unknown,
  withoutKey = false,
): Promise<Fixture> {
  const rpc = url === env.solanaRpcUrl;
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  if (
    !withoutKey &&
    url.startsWith(MARKET.jupiter.baseUrl) &&
    env.jupiterApiKey
  ) {
    headers.set("x-api-key", env.jupiterApiKey);
  }
  if (
    !withoutKey &&
    url.startsWith(env.pythHermesUrl) &&
    env.pythHermesApiKey
  ) {
    headers.set("authorization", `Bearer ${env.pythHermesApiKey}`);
  }
  const method = body === undefined ? "GET" : "POST";
  let response: Response | undefined;
  for (let attempt = 0; attempt < MARKET.http.maxAttempts; attempt++) {
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(MARKET.http.timeoutMs),
      });
    } catch {
      throw new Error("Fixture request failed; provider details withheld");
    }
    if (response.status !== 429) break;
    const reset =
      Number(response.headers.get("x-ratelimit-reset")) *
      MILLISECONDS_PER_SECOND;
    const delay = Math.min(
      MARKET.http.rateLimitWaitMaxMs,
      Math.max(
        MARKET.http.backoffBaseMs,
        reset - Date.now() + MILLISECONDS_PER_SECOND,
      ),
    );
    console.log(
      `Provider throttled recording; waiting ${delay} ms before retry.`,
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  if (!response) throw new Error("No provider response");
  const raw = await response.text();
  let responseBody: unknown;
  try {
    responseBody = JSON.parse(raw);
  } catch {
    responseBody = raw;
  }
  const responseHeaders = Object.fromEntries(
    [...response.headers].filter(([name]) => name.startsWith("x-ratelimit-")),
  );
  const fixture: Fixture = {
    recordedAt: new Date().toISOString(),
    request: {
      method,
      url: rpc ? "https://rpc.invalid/" : url,
      ...(body === undefined ? {} : { body }),
    },
    response: {
      status: response.status,
      headers: responseHeaders,
      body: responseBody,
    },
  };
  assertRedacted(fixture);
  return fixture;
}

async function jupiter(path: string): Promise<Fixture> {
  const fixture = await request(`${MARKET.jupiter.baseUrl}${path}`);
  if (fixture.response.status !== 200) {
    throw new Error(
      "Jupiter fixture recording did not return a successful response",
    );
  }
  return fixture;
}

function pricePath(mints: string[]): string {
  return `/price/v3?ids=${mints.join(",")}`;
}

function tokenPath(mints: string[]): string {
  return `/tokens/v2/search?query=${mints.join(",")}`;
}

async function main(): Promise<void> {
  if (process.argv.includes("--x2b-swap-only")) {
    await recordSwaps();
    await recordHistorical();
    await recordSwapEdges();
    return;
  }
  if (process.argv.includes("--x2b-edges-only")) {
    await recordSwapEdges();
    return;
  }
  if (process.argv.includes("--chain-only")) {
    await recordChain();
    return;
  }
  if (process.argv.includes("--edges-only")) {
    await recordEdges();
    return;
  }
  if (!env.solanaRpcUrl)
    throw new Error("SOLANA_RPC_URL is required for recording");
  const slot = await request(env.solanaRpcUrl, {
    jsonrpc: "2.0",
    id: 1,
    method: "getSlot",
    params: [{ commitment: "confirmed" }],
  });
  await save("rpc/get-slot", slot);
  const currentSlot = z
    .object({ result: z.number().int().positive() })
    .parse(slot.response.body).result;
  const verified = tokensSchema.parse(
    (await jupiter("/tokens/v2/tag?query=verified")).response.body,
  );
  const traded = tokensSchema.parse(
    (await jupiter("/tokens/v2/toptraded/24h")).response.body,
  );
  const recent = tokensSchema.parse(
    (await jupiter("/tokens/v2/recent")).response.body,
  );
  // The discovery endpoints are recorder-only; runtime clients use search by mint.
  const candidates = verified
    .filter(
      (token) =>
        token.priceBlockId !== undefined &&
        currentSlot - token.priceBlockId > 600_000 &&
        currentSlot - token.priceBlockId < 3_000_000,
    )
    .slice(0, XRAY.priceIdsPerCall);
  const staleProbe = await jupiter(
    pricePath(candidates.map((token) => token.id)),
  );
  const priceRecord = z
    .record(z.string(), z.object({ blockId: z.number() }).passthrough())
    .parse(staleProbe.response.body);
  const staleMint = candidates.find(
    (token) =>
      priceRecord[token.id] &&
      currentSlot - priceRecord[token.id]!.blockId > 600_000,
  )?.id;
  if (!staleMint)
    throw new Error(
      "No real days-old price found; select a new discovery sample",
    );
  const graduated = traded
    .filter((token) => token.launchpad === "pump.fun" && token.graduatedPool)
    .sort((a, b) =>
      (b.graduatedAt ?? "").localeCompare(a.graduatedAt ?? ""),
    )[0];
  const live = recent.find(
    (token) => token.launchpad === "pump.fun" && !token.graduatedPool,
  );
  const pump = traded.find((token) => token.symbol === "PUMP");
  if (!graduated || !live || !pump)
    throw new Error("Missing required live token sample");
  const omittedMint = "11111111111111111111111111111111";
  const fixedMints = [
    ...HIT_LIST.launchMajors.map((token) => token.mint),
    WSOL_MINT,
  ].sort();
  const mints = [
    ...new Set([
      ...fixedMints,
      staleMint,
      omittedMint,
      pump.id,
      graduated.id,
      live.id,
      ...traded.map((token) => token.id),
      ...verified.map((token) => token.id),
    ]),
  ]
    .slice(0, 120)
    .sort();
  const sampleRoles = {
    staleMint,
    omittedMint,
    pumpMint: pump.id,
    graduatedMint: graduated.id,
    liveMint: live.id,
  };
  const majors = await jupiter(pricePath(fixedMints));
  majors.provenance = {
    sampleRoles,
    discovery: "Jupiter Tokens v2 verified, toptraded/24h and recent",
  };
  await save("jupiter/prices-majors", majors);
  await save("jupiter/prices-wsol", await jupiter(pricePath([WSOL_MINT])));
  await save("jupiter/prices-stale", await jupiter(pricePath([staleMint])));
  await save("jupiter/prices-omitted", await jupiter(pricePath([omittedMint])));
  for (let offset = 0; offset < mints.length; offset += XRAY.priceIdsPerCall) {
    await save(
      `jupiter/prices-batch-${offset / XRAY.priceIdsPerCall + 1}`,
      await jupiter(
        pricePath(mints.slice(offset, offset + XRAY.priceIdsPerCall)),
      ),
    );
  }
  for (
    let offset = 0;
    offset < mints.length;
    offset += MARKET.jupiter.tokensMintsPerCall
  ) {
    const fixture = await jupiter(
      tokenPath(
        mints.slice(offset, offset + MARKET.jupiter.tokensMintsPerCall),
      ),
    );
    fixture.provenance = { sampleRoles };
    await save(
      `jupiter/tokens-batch-${offset / MARKET.jupiter.tokensMintsPerCall + 1}`,
      fixture,
    );
  }
  await save("jupiter/tokens-majors", await jupiter(tokenPath(fixedMints)));
  await save(
    "jupiter/tokens-specials",
    await jupiter(tokenPath([pump.id, graduated.id, live.id].sort())),
  );

  const latestUrl = (feed: string) =>
    `${env.pythHermesUrl.replace(/\/$/, "")}/v2/updates/price/latest?ids[]=${feed}&parsed=true`;
  const unauthenticated = await request(
    latestUrl(HIT_LIST.solUsdPythFeedId),
    undefined,
    true,
  );
  await save("pyth/hermes-unauthorized", unauthenticated);
  const livePrices = z
    .record(z.string(), z.object({ usdPrice: z.number() }).passthrough())
    .parse(majors.response.body);
  const feeds = [
    { symbol: "SOL", mint: WSOL_MINT, pythFeedId: HIT_LIST.solUsdPythFeedId },
    ...HIT_LIST.launchMajors,
  ];
  for (const feed of feeds) {
    if (env.pythHermesApiKey) {
      await save(
        `pyth/latest-${feed.symbol.toLowerCase()}`,
        await request(latestUrl(feed.pythFeedId)),
      );
      continue;
    }
    const usd = livePrices[feed.mint]?.usdPrice;
    if (!usd)
      throw new Error("Missing display USD value for synthetic Hermes sample");
    const publishTime = Math.floor(
      Date.parse(majors.recordedAt) / MILLISECONDS_PER_SECOND,
    );
    const value = {
      price: BigInt(Math.round(usd * 100_000_000)).toString(),
      conf: "1",
      expo: -8,
      publish_time: publishTime,
    };
    await save(`pyth/latest-${feed.symbol.toLowerCase()}`, {
      recordedAt: majors.recordedAt,
      request: { method: "GET", url: latestUrl(feed.pythFeedId) },
      response: {
        status: 200,
        headers: {},
        body: {
          parsed: [
            {
              id: feed.pythFeedId,
              price: value,
              ema_price: value,
              metadata: { slot: currentSlot },
            },
          ],
        },
      },
      synthetic: {
        from: "../jupiter/prices-majors.json",
        edit: "User-approved schema-only Hermes sample because no Hermes key is available. Display USD copied from the recorded Jupiter response; confidence and metadata are synthetic. This is not recorded Pyth market evidence.",
      },
    });
  }
  console.log(
    `Recorded ${mints.length} unique mints; provider secrets withheld.`,
  );
  await recordEdges();
  await recordChain();
  await recordSwaps();
  await recordHistorical();
  await recordSwapEdges();
}

async function recordEdges(): Promise<void> {
  const latest = JSON.parse(
    await readFile(`${directory}pyth/latest-sol.json`, "utf8"),
  ) as Fixture;
  const pythBodySchema = z
    .object({
      parsed: z.array(
        z
          .object({
            price: z
              .object({
                price: z.string(),
                conf: z.string(),
                publish_time: z.number(),
              })
              .passthrough(),
          })
          .passthrough(),
      ),
    })
    .passthrough();
  const stale = structuredClone(latest);
  const staleBody = pythBodySchema.parse(stale.response.body);
  staleBody.parsed[0]!.price.publish_time -= 61;
  stale.response.body = staleBody;
  stale.synthetic = {
    from: "latest-sol.json",
    edit: "Reading moved 61 seconds before the frozen fixture clock.",
  };
  await save("pyth/latest-sol-stale", stale);
  const wide = structuredClone(latest);
  const wideBody = pythBodySchema.parse(wide.response.body);
  wideBody.parsed[0]!.price.conf = (
    (BigInt(wideBody.parsed[0]!.price.price) * 101n + 9_999n) /
    10_000n
  ).toString();
  wide.response.body = wideBody;
  wide.synthetic = {
    from: "latest-sol.json",
    edit: "Confidence rounded upward to 101 basis points.",
  };
  await save("pyth/latest-sol-wide", wide);
  const prefixed = structuredClone(latest);
  prefixed.request.url = prefixed.request.url.replace("/v2/", "/hermes/v2/");
  prefixed.synthetic = {
    from: "latest-sol.json",
    edit: "Request base path prefixed with /hermes to exercise URL joining.",
  };
  await save("pyth/latest-sol-prefixed", prefixed);
  const empty = JSON.parse(
    await readFile(`${directory}jupiter/prices-wsol.json`, "utf8"),
  ) as Fixture;
  empty.response.body = {};
  empty.synthetic = {
    from: "prices-wsol.json",
    edit: "wSOL omitted to exercise unavailable fallback.",
  };
  await save("jupiter/prices-wsol-empty", empty);
}

main().catch(() => {
  console.error(
    "Fixture recording failed. No provider URL, key or upstream error was logged.",
  );
  process.exitCode = 1;
});

// Chain refreshes are separate from X2a display-price recordings.
async function recordChain(): Promise<void> {
  if (!env.solanaRpcUrl) throw new Error("SOLANA_RPC_URL is required");
  const curves: Record<string, string> = {
    "curve-81-a": "4P6MUhM7nAAEjivtr2x8MiiMRGA9UibTaJqoKBtdpump",
    "curve-81-b": "CSB7Ad4nwJVg4AxEHzGpbyz5tWw1UB9zGaMvp14Fpump",
    "curve-150-pnut": "2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump",
    "curve-150-fartcoin": "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump",
    "curve-166-live": "27J92C2eG7yMpNdG5MQE1swrw4z9U6BiHwKQWTYBpump",
    "curve-166-complete": "CbcyNo7m1amFWqEQm2m4PLv1UNvpcL3C1Ujm6AkzpKoU",
    "curve-115-non-sol": "8XuSJqe3Ki9iAHeKHH6g2D7Qrsw8UxgucWXGfdpkpump",
    "curve-151-pqc": "7K52aYQW9rWGjwZmQ7o2d1P6E7bji6hSMsqaLy5EcxLh",
    "curve-cap-sample": "4hG8Ea1FefyAAtqdnXS4VhKxrV1nHgT2MqaumCPybgom",
  };
  const accountSchema = z
    .object({
      result: z
        .object({
          value: z
            .object({ data: z.tuple([z.string(), z.literal("base64")]) })
            .passthrough(),
        })
        .passthrough(),
    })
    .passthrough();
  async function rpc(method: string, params: unknown[]) {
    const fixture = await request(env.solanaRpcUrl!, {
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    });
    if (
      fixture.response.status !== 200 ||
      !z
        .object({ result: z.unknown() })
        .passthrough()
        .safeParse(fixture.response.body).success
    )
      throw new Error("RPC recording did not return a result");
    return fixture;
  }
  const idlSchema = z
    .object({
      types: z.array(
        z.object({ name: z.string(), type: z.unknown() }).passthrough(),
      ),
    })
    .passthrough();
  async function idl(file: string, name: string) {
    const source = `https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/${file}.json`;
    const fixture = await request(source);
    const parsedResult = idlSchema.safeParse(fixture.response.body);
    if (!parsedResult.success) {
      console.log(
        "Published layout schema paths:",
        parsedResult.error.issues.map((issue) => issue.path.join(".")),
      );
      throw new Error("Published layout schema failure");
    }
    const parsed = parsedResult.data;
    const fields = z
      .object({
        fields: z.array(
          z.object({ name: z.string(), type: z.unknown() }).passthrough(),
        ),
      })
      .passthrough()
      .parse(parsed.types.find((entry) => entry.name === name)?.type).fields;
    return {
      source,
      fields,
      sha256: createHash("sha256")
        .update(JSON.stringify(fixture.response.body))
        .digest("hex"),
    };
  }
  function sequential(data: Buffer, fields: { name: string; type: unknown }[]) {
    let offset = 8;
    const values: Record<string, string | number | boolean> = {};
    const offsets: Record<string, number> = {};
    for (const { name, type } of fields) {
      const size =
        type === "u64"
          ? 8
          : type === "pubkey"
            ? 32
            : type === "i128"
              ? 16
              : type === "u16"
                ? 2
                : type === "bool" || type === "u8"
                  ? 1
                  : undefined;
      if (!size) throw new Error("Published layout unsupported representation");
      offsets[name] = offset;
      values[name] =
        offset + size <= data.length
          ? type === "u64"
            ? data.readBigUInt64LE(offset).toString()
            : type === "i128"
              ? (
                  data.readBigUInt64LE(offset) +
                  (data.readBigInt64LE(offset + 8) << 64n)
                ).toString()
              : type === "pubkey"
                ? new PublicKey(data.subarray(offset, offset + size)).toBase58()
                : type === "u16"
                  ? data.readUInt16LE(offset)
                  : type === "bool"
                    ? data[offset] === 1
                    : data[offset]!
          : type === "bool"
            ? false
            : type === "pubkey"
              ? PublicKey.default.toBase58()
              : type === "u8" || type === "u16"
                ? 0
                : "0";
      offset += size;
    }
    return { values, offsets };
  }
  function verify(
    decoded: Record<string, unknown>,
    expected: Record<string, string | number | boolean>,
    names: Record<string, string>,
  ) {
    const result: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(names)) {
      const raw = decoded[key];
      const actual = typeof raw === "bigint" ? raw.toString() : raw;
      if (actual !== expected[field])
        throw new Error("Live account and published layout disagree");
      result[key] = expected[field];
    }
    return result;
  }
  console.log("Chain recording: reading published layouts");
  const curveIdl = await idl("pump", "BondingCurve");
  console.log("Chain recording: first layout validated");
  const poolIdl = await idl("pump_amm", "Pool");
  const curveFields = {
    virtualTokenReserves: "virtual_token_reserves",
    virtualQuoteReserves: "virtual_quote_reserves",
    realTokenReserves: "real_token_reserves",
    realQuoteReserves: "real_quote_reserves",
    tokenTotalSupply: "token_total_supply",
    complete: "complete",
    creator: "creator",
    mayhem: "is_mayhem_mode",
    cashback: "is_cashback_coin",
    quoteMint: "quote_mint",
    creatorFeeBps: "creator_fee_bps",
  };
  for (const [name, mint] of Object.entries(curves)) {
    console.log(`Chain recording: ${name}`);
    const fixture = await rpc("getAccountInfo", [
      deriveBondingCurve(mint),
      { encoding: "base64", commitment: "confirmed" },
    ]);
    const data = Buffer.from(
      accountSchema.parse(fixture.response.body).result.value.data[0],
      "base64",
    );
    const reference = sequential(data, curveIdl.fields);
    fixture.provenance = {
      mint,
      length: data.length,
      layoutSource: curveIdl.source,
      layoutSha256: curveIdl.sha256,
      offsets: reference.offsets,
      expectedDecoded: verify(
        { ...decodeBondingCurve(data) },
        reference.values,
        curveFields,
      ),
    };
    await save(`rpc/${name}`, fixture);
  }
  const wif = HIT_LIST.launchMajors.find(
    (token) => token.symbol === "WIF",
  )!.mint;
  await save(
    "rpc/curve-wif-absent",
    await rpc("getAccountInfo", [
      deriveBondingCurve(wif),
      { encoding: "base64", commitment: "confirmed" },
    ]),
  );
  await save(
    "rpc/pool-pnut-absent",
    await rpc("getAccountInfo", [
      deriveCanonicalPool(curves["curve-150-pnut"]!),
      { encoding: "base64", commitment: "confirmed" },
    ]),
  );
  for (const symbol of ["BONK", "POPCAT"]) {
    const mint = HIT_LIST.launchMajors.find(
      (token) => token.symbol === symbol,
    )!.mint;
    await save(
      `rpc/curve-${symbol.toLowerCase()}-absent`,
      await rpc("getAccountInfo", [
        deriveBondingCurve(mint),
        { encoding: "base64", commitment: "confirmed" },
      ]),
    );
  }
  await save(
    "rpc/pool-fartcoin-absent",
    await rpc("getAccountInfo", [
      deriveCanonicalPool(curves["curve-150-fartcoin"]!),
      { encoding: "base64", commitment: "confirmed" },
    ]),
  );
  const sample = curves["curve-151-pqc"]!;
  const pool = await rpc("getAccountInfo", [
    deriveCanonicalPool(sample),
    { encoding: "base64", commitment: "confirmed" },
  ]);
  const data = Buffer.from(
    accountSchema.parse(pool.response.body).result.value.data[0],
    "base64",
  );
  const decoded = decodePumpPool(data);
  const reference = sequential(data, poolIdl.fields);
  pool.provenance = {
    mint: sample,
    length: data.length,
    layoutSource: poolIdl.source,
    layoutSha256: poolIdl.sha256,
    offsets: reference.offsets,
    expectedDecoded: verify({ ...decoded }, reference.values, {
      index: "index",
      creator: "creator",
      baseMint: "base_mint",
      quoteMint: "quote_mint",
      quoteTokenAccount: "pool_quote_token_account",
      lpSupply: "lp_supply",
      coinCreator: "coin_creator",
      mayhem: "is_mayhem_mode",
      cashback: "is_cashback_coin",
      virtualQuoteReserves: "virtual_quote_reserves",
    }),
  };
  await save("rpc/pool-pqc", pool);
  await save(
    "rpc/vault-pqc",
    await rpc("getTokenAccountBalance", [
      decoded.quoteTokenAccount,
      { commitment: "confirmed" },
    ]),
  );
  for (const token of HIT_LIST.launchMajors)
    await save(
      `rpc/mint-${token.symbol.toLowerCase()}`,
      await rpc("getAccountInfo", [
        token.mint,
        { encoding: "jsonParsed", commitment: "confirmed" },
      ]),
    );
  for (const [name, mint] of [
    ["mint-pqc", sample],
    ["mint-catcraft", "ADPN2aqzY5RhkBC7bNQWFhTFFEYKY4drHUQG887Cpump"],
    ["mint-pump", "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn"],
  ] as const)
    await save(
      `rpc/${name}`,
      await rpc("getAccountInfo", [
        mint,
        { encoding: "jsonParsed", commitment: "confirmed" },
      ]),
    );
  const largest = await rpc("getTokenLargestAccounts", [
    sample,
    { commitment: "confirmed" },
  ]);
  await save("rpc/holders-pqc-largest", largest);
  const accounts = z
    .object({
      result: z
        .object({
          value: z.array(z.object({ address: z.string() }).passthrough()),
        })
        .passthrough(),
    })
    .passthrough()
    .parse(largest.response.body).result.value;
  await save(
    "rpc/holders-pqc-owners",
    await rpc("getMultipleAccounts", [
      accounts.map(({ address }) => address),
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]),
  );
  await save(
    "rpc/holders-pqc-supply",
    await rpc("getTokenSupply", [sample, { commitment: "confirmed" }]),
  );
}

// Fixture quantities are protocol test inputs. Nothing here signs or broadcasts.
async function recordSwaps(): Promise<void> {
  const wif = HIT_LIST.launchMajors[0];
  const unit = (10n ** BigInt(wif.decimals)).toString();
  async function quote(
    name: string,
    query: Record<string, string>,
    build = false,
  ): Promise<Fixture> {
    // Avoid burst throttling while preserving all rate headers in the recording.
    await new Promise((resolve) =>
      setTimeout(resolve, MILLISECONDS_PER_SECOND),
    );
    const url = new URL(
      build ? "/swap/v2/build" : "/swap/v2/order",
      MARKET.jupiter.baseUrl,
    );
    for (const [key, value] of Object.entries(query))
      url.searchParams.set(key, value);
    const fixture = await request(url.href);
    await save(`jupiter/${name}`, fixture);
    return fixture;
  }
  const sell = {
    inputMint: wif.mint,
    outputMint: WSOL_MINT,
    amount: unit,
    swapMode: "ExactIn",
  };
  await quote("swap-sell-wif", sell);
  await quote("swap-buy-wif", {
    inputMint: WSOL_MINT,
    outputMint: wif.mint,
    amount: LAMPORTS_PER_SOL.toString(),
    swapMode: "ExactIn",
  });
  await quote("swap-no-route", {
    inputMint: WSOL_MINT,
    outputMint: wif.mint,
    amount: "1",
    swapMode: "ExactIn",
  });
  await quote(
    "swap-build-wif",
    {
      inputMint: wif.mint,
      outputMint: WSOL_MINT,
      amount: unit,
      taker: PublicKey.default.toBase58(),
      slippageBps: HIT_LIST.capMaxPriceImpactBps.toString(),
      maxAccounts: MARKET.jupiter.buildMaxAccounts.toString(),
      platformFeeBps: "0",
    },
    true,
  );
  const latest = async (symbol: string) => {
    const fixture = JSON.parse(
      await readFile(`${directory}pyth/latest-${symbol}.json`, "utf8"),
    ) as Fixture;
    const parsed = z
      .object({ parsed: z.array(pythPriceUpdateSchema) })
      .passthrough()
      .parse(fixture.response.body).parsed[0];
    if (!parsed) throw new Error("Missing recorded Pyth input");
    return parsed.price;
  };
  const sol = await latest("sol");
  const quoteBody = z
    .object({ outAmount: z.string().regex(/^\d+$/) })
    .passthrough();
  for (const token of HIT_LIST.launchMajors) {
    const label = token.symbol.toLowerCase();
    await save(
      `jupiter/token-major-${label}`,
      await jupiter(tokenPath([token.mint])),
    );
    const amount = majorSellProbeAmount(
      sol,
      await latest(label),
      token.decimals,
    );
    const probe = await quote(`swap-major-${label}-probe`, {
      inputMint: token.mint,
      outputMint: WSOL_MINT,
      amount: amount.toString(),
      swapMode: "ExactIn",
      excludeRouters: MARKET.jupiter.listingProbeExcludeRouters.join(","),
    });
    probe.provenance = {
      note: "Real quote for the exact bigint probe amount computed from recorded Pyth examples. Synthetic examples are not live oracle evidence.",
      solFixture: "../pyth/latest-sol.json",
      tokenFixture: `../pyth/latest-${label}.json`,
    };
    await save(`jupiter/swap-major-${label}-probe`, probe);
    const buy = await quote(`swap-major-${label}-buy`, {
      inputMint: WSOL_MINT,
      outputMint: token.mint,
      amount: LAMPORTS_PER_SOL.toString(),
      swapMode: "ExactIn",
    });
    const base = BigInt(quoteBody.parse(buy.response.body).outAmount);
    let first: bigint | undefined;
    for (let index = 0; index < MARKET.ladder.maxRungs; index++) {
      const rungAmount = base * 2n ** BigInt(index);
      const rung = await quote(`swap-major-${label}-ladder-${index}`, {
        inputMint: token.mint,
        outputMint: WSOL_MINT,
        amount: rungAmount.toString(),
        swapMode: "ExactIn",
      });
      if (rung.response.status !== 200) break;
      const output = BigInt(quoteBody.parse(rung.response.body).outAmount);
      first ??= output;
      if (
        first === 0n ||
        (output * base * BigInt(BPS_DENOMINATOR)) / (first * rungAmount) <
          BigInt(MARKET.ladder.stopBelowRecoveryBps)
      )
        break;
    }
  }
}

async function recordHistorical(): Promise<void> {
  const seed = JSON.parse(
    await readFile(`${directory}pyth/latest-wif.json`, "utf8"),
  ) as Fixture;
  const point = z
    .object({ parsed: z.array(pythPriceUpdateSchema) })
    .passthrough()
    .parse(seed.response.body).parsed[0]!;
  const times = dailyCloseTimes(Date.parse(seed.recordedAt));
  for (const [index, time] of times.entries()) {
    const url = new URL(
      `${env.pythHermesUrl.replace(/\/+$/, "")}/v2/updates/price/${time}`,
    );
    url.searchParams.append("ids[]", point.id);
    url.searchParams.set("parsed", "true");
    if (env.pythHermesApiKey) {
      await save(`pyth/historical-wif-${index}`, await request(url.href));
      continue;
    }
    const value = {
      price: index % 2 === 0 ? "100000000" : "110000000",
      conf: "1",
      expo: -8,
      publish_time: time,
    };
    const fixture: Fixture = {
      ...structuredClone(seed),
      request: { method: "GET", url: url.href },
      response: {
        status: 200,
        headers: {},
        body: { parsed: [{ ...point, price: value, ema_price: value }] },
      },
      synthetic: {
        from: "latest-wif.json",
        edit: "User-approved synthetic historical Hermes sample; no historical API credentials available. UTC midnight and alternating 1.00/1.10 USD close values exercise the sample deviation calculation. Not actual market history.",
      },
    };
    await save(`pyth/historical-wif-${index}`, fixture);
  }
}

async function recordSwapEdges(): Promise<void> {
  const curve = JSON.parse(
    await readFile(`${directory}rpc/curve-166-live.json`, "utf8"),
  ) as Fixture;
  const body = z
    .object({
      result: z
        .object({
          value: z
            .object({ data: z.tuple([z.string(), z.literal("base64")]) })
            .passthrough(),
        })
        .passthrough(),
    })
    .passthrough()
    .parse(curve.response.body);
  const real = decodeBondingCurve(
    Buffer.from(body.result.value.data[0], "base64"),
  ).realQuoteReserves;
  const mint = z.string().parse(curve.provenance?.mint);
  for (const [name, output] of [
    ["swap-curve-cap-boundary", real],
    ["swap-curve-above-reserves", real + 1n],
  ] as const) {
    const fixture = JSON.parse(
      await readFile(`${directory}jupiter/swap-sell-wif.json`, "utf8"),
    ) as Fixture;
    const url = new URL("/swap/v2/order", MARKET.jupiter.baseUrl);
    for (const [key, value] of Object.entries({
      inputMint: mint,
      outputMint: WSOL_MINT,
      amount: "1",
      swapMode: "ExactIn",
    }))
      url.searchParams.set(key, value);
    fixture.request.url = url.href;
    fixture.response.body = {
      ...z.record(z.string(), z.unknown()).parse(fixture.response.body),
      inputMint: mint,
      outputMint: WSOL_MINT,
      inAmount: "1",
      outAmount: output.toString(),
      otherAmountThreshold: output.toString(),
      routePlan: [],
      requestId: `synthetic-${name}`,
    };
    fixture.synthetic = {
      from: "swap-sell-wif.json",
      edit: `Boundary-only quote with input mint from ../rpc/curve-166-live.json, amount 1, output/minimum ${output} lamports against ${real} recorded real reserve lamports. Input/output metadata and routePlan adjusted. Not an observed executable quote; isolates the cap rule.`,
    };
    await save(`jupiter/${name}`, fixture);
  }
}
