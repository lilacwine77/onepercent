import { MAINNET_GENESIS_HASH } from "../../packages/config/dist/genesis.js";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { PublicKey } from "@solana/web3.js";

const endpoint =
  process.env.MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const directory = new URL("./", import.meta.url);
const hash = (data) => createHash("sha256").update(data).digest("hex");
const observedAt = new Date().toISOString();
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
    const body = await response.json();
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
if ((await rpc("getGenesisHash", [])) !== MAINNET_GENESIS_HASH)
  throw new Error("Mainnet genesis required");
await mkdir(new URL("accounts/", directory), { recursive: true });
const programs = [];
for (const [name, address, sourceCommit] of [
  [
    "dbc",
    "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
    "f552f20aa3c1c7631427c3827aeea7c58b902813",
  ],
  [
    "damm-v2",
    "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
    "a85c926607433f23f0ea60f4ca7b1ae92f4156cb",
  ],
  ["token-metadata", "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s", null],
]) {
  const program = await account(address);
  if (!program.value?.executable) throw new Error(`Missing executable ${name}`);
  const programBytes = Buffer.from(program.value.data[0], "base64");
  if (programBytes.readUInt32LE() !== 2)
    throw new Error(`Unexpected loader state ${name}`);
  const programDataAddress = new PublicKey(
    programBytes.subarray(4, 36),
  ).toBase58();
  const data = await account(programDataAddress);
  if (!data.value) throw new Error(`Missing program data ${name}`);
  const bytes = Buffer.from(data.value.data[0], "base64");
  if (bytes.readUInt32LE() !== 3)
    throw new Error(`Unexpected program data ${name}`);
  const binary = bytes.subarray(45);
  const metadata = {
    name,
    programId: address,
    sourceCommit,
    sourceCommitStatus: sourceCommit
      ? "D29 reference; binary provenance is the deployed program-data account"
      : "external dependency",
    observedAt,
    contextSlot: data.context.slot,
    programData: programDataAddress,
    deploymentSlot: Number(bytes.readBigUInt64LE(4)),
    upgradeAuthority:
      bytes[12] === 1 ? new PublicKey(bytes.subarray(13, 45)).toBase58() : null,
    file: `${name}.so`,
    byteLength: binary.length,
    sha256: hash(binary),
    observations: [{ observedAt, contextSlot: data.context.slot }],
  };
  await writeFile(new URL(`${name}.so`, directory), binary);
  programs.push(metadata);
  console.log(JSON.stringify(metadata));
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
const accounts = [];
for (const [name, address] of [
  ["damm-customizable", "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck"],
  ["dbc-pool-authority", "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM"],
]) {
  const snapshot = await account(address);
  if (!snapshot.value) throw new Error(`Missing dependency ${name}`);
  const bytes = Buffer.from(snapshot.value.data[0], "base64");
  // Local genesis requires an exact u64; rentEpoch has no bearing on account data.
  await writeFile(
    new URL(`accounts/${name}.json`, directory),
    `${JSON.stringify({ pubkey: address, account: { ...snapshot.value, rentEpoch: 0 } }, null, 2)}\n`,
  );
  accounts.push({
    name,
    address,
    observedAt,
    readSlot: snapshot.context.slot,
    owner: snapshot.value.owner,
    lamports: snapshot.value.lamports,
    bytes: bytes.length,
    sha256: hash(bytes),
  });
}
await writeFile(
  new URL("programs.json", directory),
  `${JSON.stringify({ observedAt, cluster: "mainnet", commitment: "finalized", method: "getAccountInfo", programs, accounts }, null, 2)}\n`,
);
