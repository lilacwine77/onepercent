import { writeFileSync } from "node:fs";
import { SystemProgram } from "@solana/web3.js";
import {
  rpc,
  payer,
  key,
  keyRoot,
  send,
  requireBalance,
} from "./devnet-session.mjs";
// Operational fee reserves, not protocol economics or funds from the Machine.
const roles = [
  ["keeper", 50_000_000],
  ["executor", 50_000_000],
  ["guardian-1", 5_000_000],
  ["guardian-2", 5_000_000],
];
const instructions = [],
  rows = [];
let total = 0;
for (const [role, target] of roles) {
  const address = key(`${keyRoot}/${role}.json`).publicKey;
  const before = await rpc.getBalance(address),
    deficit = Math.max(0, target - before);
  rows.push({
    role,
    address: address.toBase58(),
    before,
    transferred: deficit,
  });
  if (deficit) {
    total += deficit;
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: address,
        lamports: deficit,
      }),
    );
  }
}
if (instructions.length) {
  await requireBalance(total + 1_000_000);
  await send("fund-role-fees", instructions);
}
writeFileSync(
  "reports/devnet/role-funding.json",
  JSON.stringify(rows, null, 2),
);
console.log(JSON.stringify(rows));
