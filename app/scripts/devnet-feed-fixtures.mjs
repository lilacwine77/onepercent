import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { Keypair, SystemProgram } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "./devnet-token.mjs";
import * as sdk from "../packages/sdk/dist/index.js";
import {
  rpc,
  payer,
  key,
  pub,
  send,
  requireBalance,
} from "./devnet-session.mjs";
const directory = `${homedir()}/.config/solana/onepercent-devnet`;
mkdirSync(directory, { recursive: true, mode: 0o700 });
const fixtures = JSON.parse(
  readFileSync("reports/devnet/pump-fixtures.json", "utf8"),
);
assert.equal(fixtures.length, 3);
const creator = key(fixtures[0].walletPath);
const wallets = [];
for (let i = 0; i < 18; i++) {
  const path = `${directory}/feed-wallet-${i}.json`;
  if (!existsSync(path))
    writeFileSync(path, JSON.stringify([...Keypair.generate().secretKey]), {
      mode: 0o600,
      flag: "wx",
    });
  const signer = key(path);
  wallets.push({ path, address: signer.publicKey.toBase58() });
}
writeFileSync(
  "reports/devnet/feed-wallets.json",
  JSON.stringify(wallets, null, 2),
);
const tokenProgram = sdk.EXTERNAL_IDS.token2022;
for (let i = 1; i < wallets.length; i++) {
  const owner = pub(wallets[i].address);
  const deficit = Math.max(0, 30_000_000 - (await rpc.getBalance(owner)));
  const instructions = [];
  if (deficit)
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: owner,
        lamports: deficit,
      }),
    );
  for (const fixture of fixtures) {
    const mint = pub(fixture.mint),
      destination = sdk.userAta(owner, mint, tokenProgram);
    if (!(await rpc.getAccountInfo(destination)))
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          payer.publicKey,
          destination,
          owner,
          mint,
          tokenProgram,
        ),
        createTransferCheckedInstruction(
          sdk.userAta(creator.publicKey, mint, tokenProgram),
          mint,
          destination,
          creator.publicKey,
          1_000_000_000n,
          6,
          [],
          tokenProgram,
        ),
      );
  }
  if (instructions.length) {
    await requireBalance(deficit + 10_000_000);
    await send(`feed-fixtures/${i}`, instructions, [payer, creator], {
      confirmed: true,
    });
  }
}
// A finalized snapshot proves every fixture wallet already holds its three bags.
const accounts = await rpc.getMultipleAccountsInfoAndContext(
  wallets.flatMap((w) =>
    fixtures.map((f) => sdk.userAta(pub(w.address), pub(f.mint), tokenProgram)),
  ),
);
assert(
  accounts.value.every(
    (a) => a && a.data.readBigUInt64LE(64) >= 1_000_000_000n,
  ),
);
const snapshot = {
  slot: accounts.context.slot,
  time: await rpc.getBlockTime(accounts.context.slot),
  wallets,
  mints: fixtures.map((f) => f.mint),
  heldAmountPerBag: "1000000000",
};
assert(snapshot.time !== null);
writeFileSync(
  "reports/devnet/feed-snapshot.json",
  JSON.stringify(snapshot, null, 2),
);
console.log(
  JSON.stringify({
    wallets: wallets.length,
    bags: accounts.value.length,
    snapshotSlot: snapshot.slot,
  }),
);
