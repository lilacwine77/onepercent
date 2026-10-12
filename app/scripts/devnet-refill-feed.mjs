// Replenish previously held test bags only; the original snapshot remains binding.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as sdk from "../packages/sdk/dist/index.js";
import { rpc, pid, pub, key, send, requireBalance } from "./devnet-session.mjs";
import { createTransferCheckedInstruction } from "./devnet-token.mjs";
const proof = JSON.parse(
  readFileSync("reports/devnet/feed-snapshot.json", "utf8"),
);
const creator = key(
  JSON.parse(readFileSync("reports/devnet/pump-fixtures.json", "utf8"))[0]
    .walletPath,
);
const deck = sdk.decodeDeck(
  (await rpc.getAccountInfo(sdk.deckPda(pid)[0])).data,
);
assert(deck.entries.length >= 50, "Unexpected replenishment scope");
const tokenProgram = sdk.EXTERNAL_IDS.token2022;
const machine = await sdk.fetchMachine(pid, rpc);
const instructions = [];
for (const wallet of proof.wallets) {
  for (const address of proof.mints) {
    const mint = pub(address),
      owner = pub(wallet.address);
    if (
      deck.entries.some((e) => e.depositor.equals(owner) && e.mint.equals(mint))
    )
      continue;
    const dest = sdk.userAta(owner, mint, tokenProgram);
    const account = await rpc.getAccountInfo(dest);
    assert(account, "Original snapshot token account must remain open");
    const deficit =
      BigInt(proof.heldAmountPerBag) - account.data.readBigUInt64LE(64);
    if (deficit <= 0n) continue;
    instructions.push(
      createTransferCheckedInstruction(
        sdk.userAta(creator.publicKey, mint, tokenProgram),
        mint,
        dest,
        creator.publicKey,
        deficit,
        6,
        [],
        tokenProgram,
      ),
    );
  }
}
if (instructions.length) {
  await requireBalance(1_000_000, creator.publicKey);
  await send(`refill-feed/${machine.next_seq}`, instructions, [creator]);
}
console.log(
  JSON.stringify({
    refilled: instructions.length,
    deckBefore: deck.entries.length,
  }),
);
