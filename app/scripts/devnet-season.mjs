import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import * as sdk from "../packages/sdk/dist/index.js";
import { rpc, payer, pid, send } from "./devnet-session.mjs";
let config = await sdk.fetchConfig(pid, rpc);
assert(config);
if (!config.season_set) {
  const proof = JSON.parse(
    readFileSync("reports/devnet/feed-snapshot.json", "utf8"),
  );
  const now = await rpc.getBlockTime(await rpc.getSlot());
  assert(now !== null);
  await send("set-season", [
    sdk.adminConfigInstruction(pid, {
      admin: payer.publicKey,
      action: {
        setSeason: {
          snapshot_slot: BigInt(proof.slot),
          snapshot_ts: BigInt(proof.time),
          stock_up_ts: BigInt(now + 3),
        },
      },
    }),
  ]);
}
config = await sdk.fetchConfig(pid, rpc);
while (
  (await rpc.getBlockTime(await rpc.getSlot())) < Number(config.stock_up_ts)
)
  await delay(1000);
if ((await sdk.fetchMachine(pid, rpc)).phase === 0)
  await send("stock-up", [sdk.advancePhaseInstruction(pid)]);
writeFileSync(
  "reports/devnet/season.json",
  JSON.stringify(
    { config, machine: await sdk.fetchMachine(pid, rpc) },
    (_, v) => (typeof v === "bigint" ? String(v) : v),
    2,
  ),
);
console.log(
  JSON.stringify({
    snapshotSlot: String(config.snapshot_slot),
    snapshotTs: String(config.snapshot_ts),
    stockUpTs: String(config.stock_up_ts),
    phase: (await sdk.fetchMachine(pid, rpc)).phase,
  }),
);
