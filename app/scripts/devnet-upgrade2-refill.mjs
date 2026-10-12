// Return the previous rehearsal's redeemed test coins to the fixture inventory.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as sdk from "../packages/sdk/dist/index.js";
import { rpc, pub, key, payer, send, journal } from "./devnet-session.mjs";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "./devnet-token.mjs";

const label = "upgrade2/restore-test-inventory";
if (journal[label]) {
  await send(label, []);
} else {
  const prior = JSON.parse(
    readFileSync("fixtures/devnet/upgrade-1.json", "utf8"),
  ).smoke.rip;
  const owner = key(prior.walletPath);
  assert.equal(String(owner.publicKey), prior.wallet);
  const fixture = JSON.parse(
    readFileSync("reports/devnet/pump-fixtures.json", "utf8"),
  )[1];
  const mint = pub(fixture.mint),
    market = pub(fixture.wallet);
  assert.equal(String(mint), "5SatqsL5EZPmsonD7Xt9Y3t3cC3wCVwE3PQpohBYfmUf");
  const token = sdk.EXTERNAL_IDS.token2022;
  const source = sdk.userAta(owner.publicKey, mint, token);
  const destination = sdk.userAta(market, mint, token);
  const account = await rpc.getAccountInfo(source);
  const amount = 2_000_000_000n;
  assert(
    account?.owner.equals(token) && account.data.readBigUInt64LE(64) >= amount,
  );
  assert.equal(
    await rpc.getAccountInfo(destination),
    null,
    "Expected inventory account closed by the intervening Feed",
  );
  await send(
    label,
    [
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        destination,
        market,
        mint,
        token,
      ),
      createTransferCheckedInstruction(
        source,
        mint,
        destination,
        owner.publicKey,
        amount,
        6,
        [],
        token,
      ),
    ],
    [payer, owner],
  );
}
