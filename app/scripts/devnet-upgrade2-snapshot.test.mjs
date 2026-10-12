import assert from "node:assert/strict";
import { test } from "node:test";
import { PAUSE_BITS } from "../packages/config/dist/index.js";
import {
  compareAccounts,
  p3Fields,
  programDataEvidence,
} from "./devnet-upgrade2-snapshot.mjs";

const row = (kind, data, lamports = 123) => ({
  address: kind,
  kind,
  bytes: data.length,
  lamports,
  dataBase64: data.toString("base64"),
});
test("P3 activation preserves every byte except the timestamp and Rip pause bit", () => {
  const original = Buffer.alloc(3808),
    activated = Buffer.from(original);
  activated.writeBigInt64LE(1791670000n, 2656);
  const config = Buffer.alloc(872),
    paused = Buffer.from(config);
  paused[741] = PAUSE_BITS.rip;
  const proof = compareAccounts(
    [row("Config", config), row("Machine", original)],
    [row("Config", paused), row("Machine", activated)],
  );
  assert.equal(proof.checkedAccounts, 2);
  assert.deepEqual(proof.allowedChanges[0].changedOffsets, [741]);
  assert.equal(p3Fields(activated).last_reveal_ts.value, "1791670000");
  assert.equal(p3Fields(activated).bucket_history[15].offset, 3048);
});
test("unexpected balances, economic fields, P3 counters and pause bits fail closed", () => {
  const original = Buffer.alloc(3808),
    activated = Buffer.from(original);
  activated.writeBigInt64LE(1791670000n, 2656);
  for (const offset of [10, 72, 120, 224, 2664, 2672, 2680, 2688, 3072, 3080]) {
    const changed = Buffer.from(activated);
    changed[offset] = 1;
    assert.throws(
      () =>
        compareAccounts([row("Machine", original)], [row("Machine", changed)]),
      /Unexpected application bytes/,
    );
  }
  assert.throws(
    () =>
      compareAccounts(
        [row("Machine", original)],
        [row("Machine", activated, 124)],
      ),
    /Lamports changed/,
  );
  const config = Buffer.alloc(872),
    changed = Buffer.from(config);
  changed[741] = PAUSE_BITS.sellBack;
  assert.throws(
    () => compareAccounts([row("Config", config)], [row("Config", changed)]),
    /Unexpected application bytes/,
  );
});
test("ELF hash uses the declared byte length and rejects nonzero trailing capacity", () => {
  const data = Buffer.alloc(100);
  data.writeUInt32LE(3);
  data.writeBigUInt64LE(123n, 4);
  data[12] = 1;
  data[45] = 127;
  assert.equal(programDataEvidence(data, 10).deploymentSlot, "123");
  assert.equal(programDataEvidence(data, 10).maxLen, 55);
  data[60] = 1;
  assert.throws(() => programDataEvidence(data, 10), /Nonzero bytes/);
});
