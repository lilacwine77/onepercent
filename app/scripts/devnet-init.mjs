import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import * as sdk from "../packages/sdk/dist/index.js";
import {
  rpc,
  payer,
  pid,
  pub,
  send,
  requireBalance,
} from "./devnet-session.mjs";
const deployment = JSON.parse(
  readFileSync("reports/devnet/deployment.json", "utf8"),
);
assert.equal(deployment.program, pid.toBase58());
const source = JSON.parse(readFileSync("fixtures/devnet/init.json", "utf8"));
const params = Object.fromEntries(
  Object.entries(source).map(([k, v]) => [
    k,
    k === "rent_buffer_lamports"
      ? BigInt(v)
      : Array.isArray(v)
        ? v.map(pub)
        : pub(v),
  ]),
);
if (!(await sdk.fetchConfig(pid, rpc))) {
  await requireBalance(80_000_000);
  await send("initialize", [
    sdk.initializeInstruction(pid, {
      authority: payer.publicKey,
      programData: pub(deployment.programData),
      params,
    }),
  ]);
}
const config = await sdk.fetchConfig(pid, rpc),
  machine = await sdk.fetchMachine(pid, rpc);
assert(config && machine);
for (const field of [
  "admin",
  "keeper",
  "executor",
  "intake_signer",
  "quote_signer",
  "launch_wallet",
  "team_wallet",
  "token_mint",
])
  assert(config[field].equals(params[field]), `Config mismatch: ${field}`);
assert.equal(config.admin_paused, 0);
assert.equal(config.guardian_paused, 0);
assert.equal(config.disabled_roles, 0);
assert.deepEqual(config.guardians.map(String), params.guardians.map(String));
assert(config.vrf_queues[config.active_queue].equals(params.vrf_queue));
assert.deepEqual(
  config.team_wallets.map(String),
  params.team_wallets.map(String),
);
writeFileSync(
  "reports/devnet/initialized.json",
  JSON.stringify(
    { config, machine },
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);
console.log(
  JSON.stringify({
    config: sdk.configPda(pid)[0].toBase58(),
    machine: sdk.machinePda(pid)[0].toBase58(),
    phase: machine.phase,
    adminPaused: config.admin_paused,
    guardianPaused: config.guardian_paused,
    balance: await rpc.getBalance(payer.publicKey),
  }),
);
