import { DEVNET_GENESIS_HASH } from "../packages/config/dist/genesis.js";
// Public devnet evidence only. This command cannot sign or submit transactions.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Connection, PublicKey } from "@solana/web3.js";

const rpc = new Connection("https://api.devnet.solana.com", {
  commitment: "finalized",
  disableRetryOnRateLimit: true,
});
const genesis = await rpc.getGenesisHash();
assert.equal(genesis, DEVNET_GENESIS_HASH);
const program = new PublicKey("DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr");
const payer = new PublicKey("DpMXTAcBPhEpNA2joqP6eEgJkfetjzRiQyVUfQoqZG93");
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const pda = (seed) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed)], program)[0];
const keys = {
  payer,
  program,
  programData: PublicKey.findProgramAddressSync(
    [program.toBuffer()],
    loader,
  )[0],
  config: pda("config"),
  machine: pda("machine"),
  deck: pda("deck"),
  feeIn: pda("fee_in"),
  vaultAuth: pda("vault_auth"),
  dbc: new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"),
  dammV2: new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"),
  dbcConfig: new PublicKey("AonXiWUzyniqiaVyK7Bd8kjavgX6KBissnSmWwzVhX8k"),
  dammConfig: new PublicKey("A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck"),
  pump: new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
  pumpSwap: new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"),
  vrf: new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"),
  sharedQueue: new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh"),
};
const accounts = await rpc.getMultipleAccountsInfoAndContext(
  Object.values(keys),
);
const observations = Object.fromEntries(
  Object.entries(keys).map(([name, key], i) => {
    const account = accounts.value[i];
    return [
      name,
      {
        address: key.toBase58(),
        exists: account !== null,
        lamports: account?.lamports ?? 0,
        owner: account?.owner.toBase58() ?? null,
        executable: account?.executable ?? false,
        bytes: account?.data.length ?? 0,
      },
    ];
  }),
);
for (const name of ["dbc", "dammV2", "pump", "pumpSwap", "vrf"])
  assert(observations[name].executable, `${name} unavailable`);
assert.equal(observations.sharedQueue.owner, keys.vrf.toBase58());
const artifact = await readFile(
  new URL("../target/deploy/onepercent.so", import.meta.url),
);
assert.equal(artifact.subarray(0, 6).toString("hex"), "7f454c460201");
assert.equal(artifact.readUInt32LE(48), 3);
// Operational capacity: double the ELF length, rounded to a 64 KiB boundary.
const maxLen = Math.ceil((artifact.length * 2) / 65536) * 65536;
const sizes = {
  program: 36,
  programData: 45 + maxLen,
  buffer: 37 + artifact.length,
  config: 872,
  machine: 3808,
  deck: 64,
  feeIn: 0,
  dbcConfig: 1048,
  dbcPool: 424,
  splMint: 82,
  splTokenAccount: 165,
  mintLedger: 80,
  launchLut: 56 + 17 * 32,
};
const rent = {};
for (const [name, bytes] of Object.entries(sizes))
  rent[name] = {
    bytes,
    lamports: await rpc.getMinimumBalanceForRentExemption(bytes),
  };
const deploymentRentPeak =
  rent.program.lamports + rent.programData.lamports + rent.buffer.lamports;
const deploymentRentRetained =
  rent.program.lamports + rent.programData.lamports;
const report = {
  recordedAt: new Date().toISOString(),
  genesis,
  slot: accounts.context.slot,
  observations,
  artifact: {
    bytes: artifact.length,
    sha256: createHash("sha256").update(artifact).digest("hex"),
    maxLen,
  },
  rent,
  deploymentRentPeak,
  deploymentRentRetained,
  completeBudget: false,
  missingBudgetItems: [
    "deployment message fees",
    "launch metadata and simulated wallet debit",
    "transport policy",
    "Feed fixtures and Rip coverage",
    "separate disposable upgrade drill",
  ],
};
await mkdir("reports/devnet", { recursive: true });
await writeFile(
  "reports/devnet/preflight.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
