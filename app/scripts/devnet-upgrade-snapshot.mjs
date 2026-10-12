// Public, finalized evidence for a byte-preserving devnet upgrade.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import * as sdk from "../packages/sdk/dist/index.js";
import { rpc, pid, payer, pub } from "./devnet-session.mjs";
const stage = process.argv[2];
assert(["before", "after"].includes(stage));
const hash = (data) => createHash("sha256").update(data).digest("hex");
const idl = JSON.parse(
  readFileSync("packages/sdk/src/idl/onepercent.json", "utf8"),
);
const accounts = await rpc.getProgramAccounts(pid, {
  commitment: "finalized",
  withContext: true,
});
const decoded = accounts.value
  .map(({ pubkey, account }) => {
    const kind = idl.accounts.find((a) =>
      Buffer.from(a.discriminator).equals(account.data.subarray(0, 8)),
    )?.name;
    const decoder = sdk[`decode${kind}`];
    assert.equal(typeof decoder, "function", `Missing decoder for ${kind}`);
    const state = decoder(account.data);
    return {
      address: pubkey.toBase58(),
      kind,
      bytes: account.data.length,
      lamports: account.lamports,
      sha256: hash(account.data),
      state,
    };
  })
  .sort((a, b) => a.address.localeCompare(b.address));
const pd = await rpc.getAccountInfo(
  pub("9vcrRW2eRKUuJ5Mjywmp1TMTm5HFWBLJUih9tvVUkiLB"),
);
assert(pd && pd.data.readUInt32LE(0) === 3);
const elfLength = readFileSync("target/deploy/onepercent.so").length;
assert(pd.data.subarray(45 + elfLength).every((byte) => byte === 0));
const report = {
  stage,
  observedAt: new Date().toISOString(),
  slot: accounts.context.slot,
  program: pid.toBase58(),
  deploymentSlot: String(pd.data.readBigUInt64LE(4)),
  elfLength,
  sha256: hash(pd.data.subarray(45, 45 + elfLength)),
  payerBalance: await rpc.getBalance(payer.publicKey),
  accounts: decoded,
};
if (stage === "after") {
  const before = JSON.parse(
    readFileSync("reports/devnet/upgrade1-before.json", "utf8"),
  );
  const fingerprint = ({ address, kind, bytes, lamports, sha256 }) => ({
    address,
    kind,
    bytes,
    lamports,
    sha256,
  });
  assert.deepEqual(
    decoded.map(fingerprint),
    before.accounts.map(fingerprint),
    "Application accounts changed during upgrade",
  );
  assert.equal(
    report.sha256,
    hash(readFileSync("target/deploy/onepercent.so")),
  );
  report.unchangedApplicationAccounts = decoded.length;
}
writeFileSync(
  `reports/devnet/upgrade1-${stage}.json`,
  JSON.stringify(report, (_, v) => (typeof v === "bigint" ? String(v) : v), 2),
);
console.log(
  JSON.stringify({
    stage,
    slot: report.slot,
    sha256: report.sha256,
    payerBalance: report.payerBalance,
    accounts: decoded.map(({ address, kind, bytes }) => ({
      address,
      kind,
      bytes,
    })),
    preserved: report.unchangedApplicationAccounts,
  }),
);
