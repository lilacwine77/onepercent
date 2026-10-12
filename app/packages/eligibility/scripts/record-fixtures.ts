/** Manual: node --env-file=/path/to/.env.local --conditions=development --import tsx scripts/record-fixtures.ts
 * Never run in CI. Records public mint/curve accounts, never a person's wallet scan.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { getExtensionTypes, unpackMint } from "@solana/spl-token";
import { z } from "zod";
import { JupiterPriceSource } from "../../../services/api/src/xray/price-source.js";
import { PROGRAM_IDS, WSOL_MINT } from "../src/params.js";

const root = new URL("../fixtures/", import.meta.url);
const providerRoot = new URL(
  "../../../services/api/src/xray/__fixtures__/",
  import.meta.url,
);
const rpcUrl =
  process.env.HELIUS_RPC_URL ??
  (process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : undefined);
if (!rpcUrl) throw new Error("Set HELIUS_RPC_URL or HELIUS_API_KEY");
const accountSchema = z
  .object({
    owner: z.string(),
    lamports: z.number(),
    data: z.tuple([z.string(), z.literal("base64")]),
    executable: z.boolean(),
    rentEpoch: z.number(),
  })
  .passthrough();
const accountResultSchema = z.object({
  context: z.object({ slot: z.number() }),
  value: accountSchema.nullable(),
});
const rpc = async <T>(
  method: string,
  params: unknown,
  schema: z.ZodType<T>,
): Promise<{ result: T }> => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as {
    result?: unknown;
    error?: { code: number };
  };
  if (!response.ok || body.error)
    throw new Error(
      `Fixture RPC failed: ${method} (${response.status}, ${body.error?.code ?? "no-code"})`,
    );
  return { result: schema.parse(body.result) };
};
const save = async (name: string, value: unknown, provider = false) => {
  const folder = provider ? providerRoot : root;
  const path = new URL(`${name}.json`, folder);
  await mkdir(new URL(".", path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};
const curvePda = (mint: string) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()],
    new PublicKey(PROGRAM_IDS.pumpFun),
  )[0].toBase58();
const record = async (name: string, address: string, note: string) => {
  const { result } = await rpc(
    "getAccountInfo",
    [address, { encoding: "base64", commitment: "confirmed" }],
    accountResultSchema,
  );
  if (!result.value) return null;
  const { owner, lamports, data } = result.value;
  let extensions: number[] = [];
  const bytes = Buffer.from(data[0], "base64");
  if (owner === PROGRAM_IDS.token2022 && bytes[165] === 1) {
    const mint = unpackMint(
      new PublicKey(address),
      { ...result.value, owner: new PublicKey(owner), data: bytes },
      new PublicKey(owner),
    );
    extensions = getExtensionTypes(mint.tlvData).filter((type) => type !== 0);
    note += ` Extensions: ${extensions.join(", ")}.`;
  }
  const fixture = {
    address,
    owner,
    lamports: String(lamports),
    dataBase64: data[0],
    slot: result.context.slot,
    recordedAt: new Date().toISOString(),
    source: "mainnet",
    note,
  };
  await save(`mainnet/${name}`, fixture);
  console.log(
    `${name}: slot ${fixture.slot}, ${bytes.length} bytes${extensions.length ? `, extensions ${extensions.join(",")}` : ""}`,
  );
  return fixture;
};
const slot = (await rpc("getSlot", [{ commitment: "confirmed" }], z.number()))
  .result as number;
const prices = new JupiterPriceSource(
  { getSlot: async () => slot },
  {
    ...(process.env.JUPITER_API_KEY
      ? { apiKey: process.env.JUPITER_API_KEY }
      : {}),
    record: (kind, response) =>
      kind === "recent"
        ? undefined
        : save(
            `jupiter-${kind}`,
            {
              recordedAt: new Date().toISOString(),
              source: "mainnet",
              response,
            },
            true,
          ),
  },
);
const known = [
  ["fartcoin", "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump"],
  ["catcraft", "ADPN2aqzY5RhkBC7bNQWFhTFFEYKY4drHUQG887Cpump"],
  ["bonk", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"],
  ["usdc", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"],
  ["transfer-hook", "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn"],
  ["permanent-delegate", "12J6fSpv4j7Xtzjh8BharHY9aSJCBsMgycJsDTdCjHJ"],
  ["transfer-fee", "CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo"],
  ["pnut", "2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump"],
  ["wsol", WSOL_MINT],
] as const;
for (const [name, mint] of known) {
  await record(name, mint, `Public ${name} mint.`);
  if (name === "fartcoin" || name === "catcraft" || name === "pnut")
    await record(
      `${name}-curve`,
      curvePda(mint),
      `${name} canonical pump.fun curve.`,
    );
}
const recent = await prices.getRecentForRecording();
let foundNoSuffix = false;
let foundIncomplete = false;
let additional = 0;
for (const token of recent) {
  const address = curvePda(token.id);
  const { result } = await rpc(
    "getAccountInfo",
    [address, { encoding: "base64", commitment: "confirmed" }],
    accountResultSchema,
  );
  const bytes = result.value
    ? Buffer.from(result.value.data[0], "base64")
    : null;
  if (
    !bytes ||
    result.value.owner !== PROGRAM_IDS.pumpFun ||
    bytes.subarray(0, 8).toString("hex") !== "17b7f83760d8ac60"
  )
    continue;
  const quote =
    bytes.length >= 115
      ? new PublicKey(bytes.subarray(83, 115)).toBase58()
      : PublicKey.default.toBase58();
  const incomplete =
    bytes[48] === 0 &&
    (quote === WSOL_MINT || quote === PublicKey.default.toBase58());
  const noSuffix = !token.id.endsWith("pump");
  let name = "";
  if (noSuffix && !foundNoSuffix) {
    name = "no-suffix";
    foundNoSuffix = true;
  } else if (incomplete && !foundIncomplete) {
    name = "incomplete";
    foundIncomplete = true;
  } else if (additional < 7) {
    name = `pump-extra-${++additional}`;
  }
  if (!name) continue;
  await record(
    name,
    token.id,
    "Discovered through Jupiter Tokens v2 recent; canonical curve verified independently on-chain.",
  );
  await record(
    `${name}-curve`,
    address,
    `Canonical pump.fun curve; complete=${bytes[48]}, quote=${quote}.`,
  );
  if (foundNoSuffix && foundIncomplete && additional >= 7) break;
}
await prices.getPrices(known.map(([, mint]) => mint));
await prices.getTokenInfo(known.map(([, mint]) => mint));
await save(
  "helius-getSlot",
  {
    recordedAt: new Date().toISOString(),
    source: "mainnet",
    response: await rpc("getSlot", [{ commitment: "confirmed" }], z.number()),
  },
  true,
);
await save(
  "helius-getBlockTime",
  {
    recordedAt: new Date().toISOString(),
    source: "mainnet",
    response: await rpc("getBlockTime", [slot], z.number().nullable()),
  },
  true,
);
await save("idl-bonding-curve", {
  source:
    "https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/pump.json",
  recordedAt: new Date().toISOString(),
  discriminatorBytes: 8,
  fields: (
    (await fetch(
      "https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/pump.json",
    ).then((response) => response.json())) as {
      types: { name: string; type: { fields: unknown[] } }[];
    }
  ).types.find((type) => type.name === "BondingCurve")?.type.fields,
  offsets: { realQuoteReserves: 32, complete: 48, quoteMint: 83 },
});
console.log(
  `Recorded to ${fileURLToPath(root)}. noSuffix=${foundNoSuffix}, incomplete=${foundIncomplete}`,
);
