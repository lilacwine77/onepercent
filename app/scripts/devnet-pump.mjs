import assert from "node:assert/strict";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Keypair, SystemProgram } from "@solana/web3.js";
import {
  rpc,
  payer,
  pid,
  key,
  keyRoot,
  send,
  requireBalance,
} from "./devnet-session.mjs";
import { preparePumpFixture } from "./e2e-pump-fixture.ts";
import * as sdk from "../packages/sdk/dist/index.js";
const outside = `${homedir()}/.config/solana/onepercent-devnet`;
mkdirSync(outside, { recursive: true, mode: 0o700 });
function persisted(name) {
  const path = `${outside}/${name}.json`;
  if (!existsSync(path))
    writeFileSync(path, JSON.stringify([...Keypair.generate().secretKey]), {
      mode: 0o600,
      flag: "wx",
    });
  return { path, signer: key(path) };
}
const user = persisted("feed-wallet-0");
assert(await sdk.fetchConfig(pid, rpc), "Initialize before pump fixtures");
const targetBalance = 200_000_000;
if (!existsSync("reports/devnet/pump-fixtures.json")) {
  const deficit = Math.max(
    0,
    targetBalance - (await rpc.getBalance(user.signer.publicKey)),
  );
  if (deficit) {
    await requireBalance(deficit + 1_000_000);
    await send("fund-pump-wallet", [
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: user.signer.publicKey,
        lamports: deficit,
      }),
    ]);
  }
}
const mintPaths = [
  `${keyRoot}/pump-fixture-mint.json`,
  persisted("pump-fixture-mint-2").path,
  persisted("pump-fixture-mint-3").path,
];
const reports = [];
for (let i = 0; i < mintPaths.length; i++) {
  const directory = `reports/devnet/pump-${i + 1}`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const fixture = await preparePumpFixture(
    rpc,
    directory,
    user.signer.publicKey,
    pid,
    mintPaths[i],
    { amount: 25_000_000_000n, maxSolCost: 2_000_000n },
  );
  await requireBalance(30_000_000, user.signer.publicKey);
  await fixture.ensure((stage, instructions, additional = []) =>
    send(`pump-${i + 1}/${stage}`, instructions, [user.signer, ...additional]),
  );
  const report = JSON.parse(readFileSync(fixture.reportPath, "utf8"));
  reports.push({
    ...report,
    wallet: user.signer.publicKey.toBase58(),
    walletPath: user.path,
    mintPath: mintPaths[i],
  });
  writeFileSync(
    "reports/devnet/pump-fixtures.json",
    JSON.stringify(reports, null, 2),
  );
  console.log(
    JSON.stringify({
      mint: report.mint,
      wallet: user.signer.publicKey.toBase58(),
      amount: report.amount,
      feeReceivedLamports: report.feeReceivedLamports,
    }),
  );
}
