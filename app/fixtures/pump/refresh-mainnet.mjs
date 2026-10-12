import { MAINNET_GENESIS_HASH } from "../../packages/config/dist/genesis.js";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { PublicKey } from "@solana/web3.js";

const rpcUrl =
  process.env.MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const dir = new URL("../mainnet/pump/", import.meta.url);
await mkdir(dir, { recursive: true });
const date = new Date().toISOString();
const programs = {
  pump: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  pump_amm: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  pump_fees: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
  mayhem: "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e",
};
export async function rpc(method, params, url = rpcUrl) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await fetch(url, {
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
    if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
    return body.result;
  }
  throw new Error(`${method} rate limited`);
}
const pda = (program, ...seeds) =>
  PublicKey.findProgramAddressSync(seeds, new PublicKey(program))[0].toBase58();
const account = (address, url) =>
  rpc(
    "getAccountInfo",
    [address, { encoding: "base64", commitment: "finalized" }],
    url,
  );
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const genesisHash = await rpc("getGenesisHash", []);
if (genesisHash !== MAINNET_GENESIS_HASH)
  throw new Error("Mainnet genesis required");
const observations = [];
async function dump(name, address, type = "account") {
  const response = await account(address);
  if (!response.value) throw new Error(`Missing ${name}: ${address}`);
  const { value, context } = response;
  const data = Buffer.from(value.data[0], "base64");
  const meta = {
    name,
    address,
    owner: value.owner,
    lamports: value.lamports,
    executable: value.executable,
    slot: context.slot,
    checkedAt: date,
    bytes: data.length,
    sha256: sha256(data),
  };
  if (type === "program") {
    if (data.readUInt32LE(0) !== 2)
      throw new Error(`Unexpected loader state for ${name}`);
    const dataAddress = new PublicKey(data.subarray(4, 36)).toBase58();
    const programData = await account(dataAddress);
    const bytes = Buffer.from(programData.value.data[0], "base64");
    if (bytes.readUInt32LE(0) !== 3)
      throw new Error(`Unexpected ProgramData for ${name}`);
    const binary = bytes.subarray(45);
    Object.assign(meta, {
      programDataAddress: dataAddress,
      deploySlot: Number(bytes.readBigUInt64LE(4)),
      upgradeAuthority:
        bytes[12] === 1
          ? new PublicKey(bytes.subarray(13, 45)).toBase58()
          : null,
      binaryBytes: binary.length,
      binarySha256: sha256(binary),
      programDataReadSlot: programData.context.slot,
    });
    await writeFile(new URL(`${name}.so`, dir), binary);
  } else {
    await writeFile(new URL(`${name}.bin`, dir), data);
  }
  await writeFile(
    new URL(`${name}.meta.json`, dir),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
  observations.push(meta);
  console.log(name, meta.slot, meta.deploySlot ?? meta.bytes);
  return data;
}
for (const [name, address] of Object.entries(programs)) {
  await dump(name, address, "program");
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
const global = await dump(
  "global",
  "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf",
);
const accounts = {
  curve_fee_config: pda(
    programs.pump_fees,
    Buffer.from("fee_config"),
    new PublicKey(programs.pump).toBuffer(),
  ),
  pool_fee_config: pda(
    programs.pump_fees,
    Buffer.from("fee_config"),
    new PublicKey(programs.pump_amm).toBuffer(),
  ),
  mayhem_global_params: pda(programs.mayhem, Buffer.from("global-params")),
  mayhem_sol_vault: pda(programs.mayhem, Buffer.from("sol-vault")),
  pool_global_config: "ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw",
  buyback_recipient: new PublicKey(global.subarray(741, 773)).toBase58(),
  graduated_curve: pda(
    programs.pump,
    Buffer.from("bonding-curve"),
    new PublicKey("ADPN2aqzY5RhkBC7bNQWFhTFFEYKY4drHUQG887Cpump").toBuffer(),
  ),
  graduated_pool: "7mQDGteiaD4Tkupg9hStyPQNeSTNTRaUEhh1zJ1awp8x",
};
for (const [name, address] of Object.entries(accounts)) {
  await dump(name, address);
  await new Promise((resolve) => setTimeout(resolve, 800));
}
const devnet = [];
for (const [name, address] of [
  ["global", "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"],
  ["pump", programs.pump],
]) {
  const response = await account(address, "https://api.devnet.solana.com");
  devnet.push({
    name,
    address,
    present: response.value !== null,
    slot: response.context.slot,
    owner: response.value?.owner ?? null,
    executable: response.value?.executable ?? null,
  });
}
await writeFile(
  new URL("./programs.json", import.meta.url),
  `${JSON.stringify({ checkedAt: date, programs: observations.filter((item) => item.deploySlot !== undefined) }, null, 2)}\n`,
);
await writeFile(
  new URL("./read-verification.json", import.meta.url),
  `${JSON.stringify({ checkedAt: date, mainnet: observations, devnet }, null, 2)}\n`,
);
