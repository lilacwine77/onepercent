import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";
import { ComputeBudgetProgram, TransactionMessage } from "@solana/web3.js";
import * as sdk from "../packages/sdk/dist/index.js";
import { ATTESTATIONS } from "../packages/config/dist/index.js";
import {
  rpc,
  pid,
  pub,
  key,
  keyRoot,
  send,
  journal,
  requireBalance,
} from "./devnet-session.mjs";
const proof = JSON.parse(
  readFileSync("reports/devnet/feed-snapshot.json", "utf8"),
);
const config = await sdk.fetchConfig(pid, rpc);
assert.equal(String(config.snapshot_slot), String(proof.slot));
const intake = key(`${keyRoot}/intake-signer.json`);
assert(config.intake_signer.equals(intake.publicKey));
const privateKey = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(intake.secretKey.subarray(0, 32)),
  ]),
  format: "der",
  type: "pkcs8",
});
const tokenProgram = sdk.EXTERNAL_IDS.token2022;
const tableAddress = JSON.parse(
  readFileSync("reports/devnet/protocol-lut.json", "utf8"),
).address;
const table = (await rpc.getAddressLookupTable(pub(tableAddress))).value;
assert(table && !table.state.authority);
for (let i = 0; i < proof.wallets.length; i++) {
  const wallet = key(proof.wallets[i].path);
  const deck = sdk.decodeDeck(
    (await rpc.getAccountInfo(sdk.deckPda(pid)[0])).data,
  );
  const pending = proof.mints.filter(
    (m) =>
      !deck.entries.some(
        (e) => e.depositor.equals(wallet.publicKey) && e.mint.equals(pub(m)),
      ),
  );
  if (!pending.length) continue;
  const bags = [];
  for (const m of pending) {
    const mint = pub(m),
      source = sdk.userAta(wallet.publicKey, mint, tokenProgram),
      vault = sdk.vaultAta(pid, mint, tokenProgram);
    const sourceAccount = await rpc.getAccountInfo(source);
    assert(
      sourceAccount &&
        sourceAccount.data.readBigUInt64LE(64) >=
          BigInt(proof.heldAmountPerBag),
    );
    bags.push({
      mint,
      source,
      amount: BigInt(proof.heldAmountPerBag),
      decimals: 6,
      tokenProgram,
      vaultExists: !!(await rpc.getAccountInfo(vault)),
      closeSource: false,
    });
  }
  const binder = await sdk.fetchBinder(pid, rpc, wallet.publicKey);
  const now = await rpc.getBlockTime(await rpc.getSlot("confirmed"));
  assert(now !== null);
  const expiry = sdk.attestationExpiry(
    BigInt(now),
    ATTESTATIONS.feedTtlSeconds,
  );
  const plans = await sdk.planFeedTransactions(pid, {
    wallet: wallet.publicKey,
    blockhash: (await rpc.getLatestBlockhash("confirmed")).blockhash,
    lut: table,
    priorityFeeMicroLamports: 0n,
    bags,
    intakeSigner: intake.publicKey,
    nonceBase: binder?.feed_nonce_base ?? 0,
    nonceBits: binder?.feed_nonce_bits ?? 0,
    attest: ({ wallet, nonce, bags }) => ({
      expiry,
      signature: sign(
        null,
        sdk.feedMessage({ programId: pid, wallet, nonce, bags, expiry }),
        privateKey,
      ),
    }),
  });
  for (const plan of plans) {
    const instructions = TransactionMessage.decompile(
      plan.transaction.message,
      { addressLookupTableAccounts: [table] },
    ).instructions;
    assert(
      instructions
        .slice(0, 2)
        .every((ix) => ix.programId.equals(ComputeBudgetProgram.programId)),
    );
    await requireBalance(15_000_000, wallet.publicKey);
    await send(`feed/${i}/${plan.nonce}`, instructions.slice(2), [wallet], {
      confirmed: true,
      units: 400000,
      tables: [table],
    });
  }
}
const deck = sdk.decodeDeck(
  (await rpc.getAccountInfo(sdk.deckPda(pid)[0], "confirmed")).data,
);
assert(deck.entries.length >= 54);
const result = {
  cards: deck.entries.length,
  wallets: proof.wallets.length,
  mints: proof.mints,
  signatures: Object.entries(journal)
    .filter(([k]) => k.startsWith("feed/"))
    .map(([, v]) => v.signature),
};
writeFileSync("reports/devnet/feed.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
