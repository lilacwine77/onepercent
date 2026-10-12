import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import * as sdk from "../packages/sdk/dist/index.js";
import { rpc, payer, pid, send, requireBalance } from "./devnet-session.mjs";
const deployment = sdk.createDeploymentSelector({ devnet: pid })("devnet");
const before = await sdk.fetchMachine(pid, rpc);
assert(before);
await requireBalance(1_000_000);
const signature = await send("collect-pump-fees", [
  sdk.collectCreatorFeesIx(deployment, { payer: payer.publicKey }),
]);
const after = await sdk.fetchMachine(pid, rpc);
const report = {
  signature,
  stockBefore: String(before.stock_sol),
  stockAfter: String(after.stock_sol),
  stockDelta: String(after.stock_sol - before.stock_sol),
  teamBefore: String(before.team_sol),
  teamAfter: String(after.team_sol),
};
writeFileSync("reports/devnet/pump-fees.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
