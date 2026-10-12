import {
  MAINNET_GENESIS_HASH,
  DEVNET_GENESIS_HASH,
} from "../packages/config/dist/genesis.js";
// Public reads only: never imports a signer or a transaction sender.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { PublicKey } from "@solana/web3.js";

const baseline = JSON.parse(
  readFileSync("fixtures/meteora/programs.json", "utf8"),
);
const directory = "reports/devnet/meteora-pin-audit";
mkdirSync(directory, { recursive: true });
const result = {
  observedAt: new Date().toISOString(),
  method: "getAccountInfo",
  commitment: "finalized",
  programs: [],
};
for (const [cluster, endpoint, genesis] of [
  ["mainnet", "https://api.mainnet-beta.solana.com", MAINNET_GENESIS_HASH],
  ["devnet", "https://api.devnet.solana.com", DEVNET_GENESIS_HASH],
]) {
  async function rpc(method, params) {
    assert(
      [
        "getGenesisHash",
        "getAccountInfo",
        "getBlockTime",
        "getBalance",
      ].includes(method),
    );
    for (let i = 0; i < 8; i++) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(30000),
      });
      if (response.status === 429 || response.status >= 500) {
        await response.arrayBuffer();
        await delay(2000 * (i + 1));
        continue;
      }
      assert(response.ok, `RPC HTTP ${response.status}`);
      const body = await response.json();
      assert(!body.error, `RPC error ${body.error?.code}`);
      await delay(800);
      return body.result;
    }
    throw Error("Public RPC retry budget exhausted");
  }
  assert.equal(await rpc("getGenesisHash", []), genesis);
  const account = (address) =>
    rpc("getAccountInfo", [
      address,
      { encoding: "base64", commitment: "finalized" },
    ]);
  for (const pin of baseline.programs.filter((p) =>
    ["dbc", "damm-v2"].includes(p.name),
  )) {
    const program = (await account(pin.programId)).value;
    assert(
      program?.executable &&
        program.owner === "BPFLoaderUpgradeab1e11111111111111111111111",
    );
    const raw = Buffer.from(program.data[0], "base64");
    assert.equal(raw.readUInt32LE(0), 2);
    const programData = new PublicKey(raw.subarray(4, 36)).toBase58();
    const data = await account(programData);
    assert(data.value?.owner === program.owner);
    const bytes = Buffer.from(data.value.data[0], "base64");
    assert.equal(bytes.readUInt32LE(0), 3);
    const elf = bytes.subarray(45);
    const sha256 = createHash("sha256").update(elf).digest("hex");
    let trimmedLength = elf.length;
    while (trimmedLength > 0 && elf[trimmedLength - 1] === 0) trimmedLength--;
    const deploymentSlot = Number(bytes.readBigUInt64LE(4));
    const row = {
      cluster,
      endpoint,
      name: pin.name,
      programId: pin.programId,
      programData,
      observedSlot: data.context.slot,
      deploymentSlot,
      deploymentTime: await rpc("getBlockTime", [deploymentSlot]),
      upgradeAuthority:
        bytes[12] === 1
          ? new PublicKey(bytes.subarray(13, 45)).toBase58()
          : null,
      bytes: elf.length,
      sha256,
      trailingZeroTrimmedSha256: createHash("sha256")
        .update(elf.subarray(0, trimmedLength))
        .digest("hex"),
      baselineSha256: pin.sha256,
      baselineDeploymentSlot: pin.deploymentSlot,
      matchesCapturedPin: sha256 === pin.sha256,
      referenceCommit: pin.sourceCommit,
      sourceToBinaryProof: "Not established by a raw binary comparison",
    };
    writeFileSync(`${directory}/${cluster}-${pin.name}.so`, elf);
    result.programs.push(row);
    console.log(JSON.stringify(row));
    writeFileSync(
      `${directory}/observations.json`,
      JSON.stringify(result, null, 2),
    );
  }
  if (cluster === "devnet") {
    result.payerBalance = await rpc("getBalance", [
      "DpMXTAcBPhEpNA2joqP6eEgJkfetjzRiQyVUfQoqZG93",
      { commitment: "finalized" },
    ]);
    writeFileSync(
      `${directory}/observations.json`,
      JSON.stringify(result, null, 2),
    );
  }
}
