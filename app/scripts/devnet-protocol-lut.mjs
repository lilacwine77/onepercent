import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { AddressLookupTableProgram, SystemProgram } from "@solana/web3.js";
import { setTimeout as delay } from "node:timers/promises";
import * as sdk from "../packages/sdk/dist/index.js";
import {
  rpc,
  payer,
  pid,
  pub,
  key,
  keyRoot,
  send,
  requireBalance,
} from "./devnet-session.mjs";
const authority = key(`${keyRoot}/lut-authority.json`);
const proof = JSON.parse(
  readFileSync("reports/devnet/feed-snapshot.json", "utf8"),
);
const mint = key(`${keyRoot}/mint.json`).publicKey;
const keys = [
  sdk.configPda(pid)[0],
  sdk.machinePda(pid)[0],
  sdk.deckPda(pid)[0],
  sdk.feeInPda(pid)[0],
  sdk.vaultAuthPda(pid)[0],
  mint,
];
for (const m of proof.mints)
  keys.push(
    pub(m),
    sdk.ledgerPda(pid, pub(m))[0],
    sdk.vaultAta(pid, pub(m), sdk.EXTERNAL_IDS.token2022),
    sdk.bondingCurvePda(pub(m))[0],
  );
for (const w of proof.wallets) {
  keys.push(sdk.binderPda(pid, pub(w.address))[0]);
  for (const m of proof.mints)
    keys.push(sdk.userAta(pub(w.address), pub(m), sdk.EXTERNAL_IDS.token2022));
}
keys.push(
  pub("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh"),
  ...Object.values(sdk.EXTERNAL_IDS),
);
const expected = [...new Map(keys.map((k) => [k.toBase58(), k])).values()];
assert(expected.length <= 256);
const reportPath = "reports/devnet/protocol-lut.json";
let report = existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath, "utf8"))
  : null;
const rent = await rpc.getMinimumBalanceForRentExemption(
  56 + expected.length * 32,
);
const deficit = Math.max(
  0,
  rent + 5_000_000 - (await rpc.getBalance(authority.publicKey)),
);
if (deficit) {
  await requireBalance(deficit + 1_000_000);
  await send("fund-protocol-lut", [
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: authority.publicKey,
      lamports: deficit,
    }),
  ]);
}
if (!report) {
  const slot = await rpc.getSlot();
  const [create, address] = AddressLookupTableProgram.createLookupTable({
    authority: authority.publicKey,
    payer: authority.publicKey,
    recentSlot: slot,
  });
  report = {
    address: address.toBase58(),
    recentSlot: slot,
    expected: expected.map(String),
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  await send("protocol-lut-create", [create], [authority], { confirmed: true });
} else if (!(await rpc.getAccountInfo(pub(report.address)))) {
  const [create] = AddressLookupTableProgram.createLookupTable({
    authority: authority.publicKey,
    payer: authority.publicKey,
    recentSlot: report.recentSlot,
  });
  await send("protocol-lut-create", [create], [authority], { confirmed: true });
}
assert.deepEqual(report.expected, expected.map(String));
let table = (
  await rpc.getAddressLookupTable(pub(report.address), {
    commitment: "confirmed",
  })
).value;
assert(table);
for (let i = table.state.addresses.length; i < expected.length; i += 20)
  await send(
    `protocol-lut-extend/${i}`,
    [
      AddressLookupTableProgram.extendLookupTable({
        lookupTable: table.key,
        authority: authority.publicKey,
        payer: authority.publicKey,
        addresses: expected.slice(i, i + 20),
      }),
    ],
    [authority],
    { confirmed: true },
  );
table = (
  await rpc.getAddressLookupTable(table.key, { commitment: "confirmed" })
).value;
assert.deepEqual(table.state.addresses.map(String), expected.map(String));
while ((await rpc.getSlot()) <= table.state.lastExtendedSlot) await delay(1000);
if (table.state.authority)
  await send(
    "protocol-lut-freeze",
    [
      AddressLookupTableProgram.freezeLookupTable({
        lookupTable: table.key,
        authority: authority.publicKey,
      }),
    ],
    [authority],
  );
console.log(
  JSON.stringify({
    address: table.key.toBase58(),
    entries: expected.length,
    rent,
  }),
);
