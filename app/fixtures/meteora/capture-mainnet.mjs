import { MAINNET_GENESIS_HASH } from "../../packages/config/dist/genesis.js";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { PublicKey } from "@solana/web3.js";

// Evidence capture only. No signing, simulation or transaction submission.
const endpoint =
  process.env.MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const directory = new URL("./", import.meta.url);
const observedAt = new Date().toISOString();
const hash = (data) => createHash("sha256").update(data).digest("hex");
const addressAt = (data, offset) =>
  new PublicKey(data.subarray(offset, offset + 32)).toBase58();
const dbc = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
const damm = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
const wsol = "So11111111111111111111111111111111111111112";

async function rpc(method, params) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (response.status === 429) {
      await new Promise((resolve) =>
        setTimeout(resolve, 2_000 + attempt * 1_000),
      );
      continue;
    }
    if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
    const body = JSON.parse(
      (await response.text()).replace(
        /"rentEpoch"\s*:\s*(\d+)/gu,
        '"rentEpoch":"$1"',
      ),
    );
    if (body.error) throw new Error(`${method} RPC ${body.error.code}`);
    return body.result;
  }
  throw new Error(`${method} rate limited`);
}

const account = (address) =>
  rpc("getAccountInfo", [
    address,
    { encoding: "base64", commitment: "finalized" },
  ]);
if ((await rpc("getGenesisHash", [])) !== MAINNET_GENESIS_HASH) {
  throw new Error("Mainnet genesis required");
}
await mkdir(new URL("accounts/", directory), { recursive: true });
const captures = [];
async function capture(name, address, owner) {
  const result = await account(address);
  if (!result.value || result.value.owner !== owner)
    throw new Error(`Wrong or missing ${name}`);
  const bytes = Buffer.from(result.value.data[0], "base64");
  const metadata = {
    name,
    address,
    observedAt,
    readSlot: result.context.slot,
    owner,
    bytes: bytes.length,
    sha256: hash(bytes),
  };
  await writeFile(
    new URL(`accounts/${name}.json`, directory),
    `${JSON.stringify(
      {
        ...metadata,
        pubkey: address,
        commitment: "finalized",
        rpcRentEpoch: result.value.rentEpoch,
        account: { ...result.value, rentEpoch: 0 },
      },
      null,
      2,
    )}\n`,
  );
  captures.push(metadata);
  return bytes;
}

for (const [name, address, expectedMigrated] of [
  ["dbc-active", "AYgu3bEE4n6Eq13rTNX4RkwXHSaiWq51DJ9fVHt9uLjs", 0],
  ["dbc-migrated", "HsFQ9BMxtREZ15mpngqgtnUd9gH5bCzv19Xq87QgGdLP", 1],
]) {
  const data = await capture(name, address, dbc);
  if (data.length !== 424 || data[305] !== expectedMigrated)
    throw new Error(`Changed DBC fixture ${name}`);
  const config = addressAt(data, 72);
  const mint = addressAt(data, 136);
  const configData = await capture(`${name}-config`, config, dbc);
  if (addressAt(configData, 8) !== wsol)
    throw new Error(`Wrong quote mint ${name}`);
  const sorted = [
    new PublicKey(mint).toBuffer(),
    new PublicKey(wsol).toBuffer(),
  ].sort(Buffer.compare);
  const expected = PublicKey.findProgramAddressSync(
    [
      Buffer.from("pool"),
      new PublicKey(config).toBuffer(),
      sorted[1],
      sorted[0],
    ],
    new PublicKey(dbc),
  )[0].toBase58();
  if (expected !== address) throw new Error(`Non-canonical ${name}`);
  const base = await account(addressAt(data, 168));
  if (!base.value) throw new Error(`Missing base vault ${name}`);
  await capture(`${name}-base-vault`, addressAt(data, 168), base.value.owner);
  await capture(
    `${name}-quote-vault`,
    addressAt(data, 200),
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  );
}

const poolAddress = "9nScc7xkdzyawXA64cnamkFo7asCMDXKGqNQpsX1WPtp";
const pool = await capture("damm-migrated", poolAddress, damm);
if (pool.length !== 1112 || addressAt(pool, 200) !== wsol)
  throw new Error("Changed DAMM fixture");
const dammConfig = "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck";
const sorted = [pool.subarray(168, 200), pool.subarray(200, 232)].sort(
  Buffer.compare,
);
const expectedDamm = PublicKey.findProgramAddressSync(
  [
    Buffer.from("pool"),
    new PublicKey(dammConfig).toBuffer(),
    sorted[1],
    sorted[0],
  ],
  new PublicKey(damm),
)[0].toBase58();
if (expectedDamm !== poolAddress) throw new Error("Non-canonical DAMM fixture");
await capture("damm-customizable", dammConfig, damm);
await capture(
  "damm-migrated-base-vault",
  addressAt(pool, 232),
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
await capture(
  "damm-migrated-quote-vault",
  addressAt(pool, 264),
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
await writeFile(
  new URL("decoder-accounts.json", directory),
  `${JSON.stringify({ observedAt, cluster: "mainnet", commitment: "finalized", accounts: captures }, null, 2)}\n`,
);

console.log(
  JSON.stringify({
    accounts: captures.length,
    firstSlot: captures[0]?.readSlot,
    lastSlot: captures.at(-1)?.readSlot,
  }),
);
