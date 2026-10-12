import assert from "node:assert/strict";
import { test } from "node:test";
import { broadcastSavedTransaction } from "./devnet-broadcast.mjs";

const bytes = Buffer.from("persisted signed transaction");
const entry = Object.freeze({ raw: bytes.toString("base64") });

test("first broadcast and persisted retries each await a fresh admission check", async () => {
  const calls = [];
  const connection = {
    async sendRawTransaction(raw, options) {
      calls.push("broadcast");
      assert.deepEqual(raw, bytes);
      assert.deepEqual(options, { skipPreflight: false, maxRetries: 0 });
    },
  };
  const beforeBroadcast = async () => {
    calls.push("check-start");
    await Promise.resolve();
    calls.push("check-complete");
  };
  await broadcastSavedTransaction(connection, entry, beforeBroadcast);
  await broadcastSavedTransaction(connection, entry, beforeBroadcast);
  assert.deepEqual(calls, [
    "check-start",
    "check-complete",
    "broadcast",
    "check-start",
    "check-complete",
    "broadcast",
  ]);
});

test("a changed precondition refuses a retry and its error is never swallowed", async () => {
  let broadcasts = 0;
  let paused = true;
  const connection = {
    async sendRawTransaction() {
      broadcasts++;
      throw Error("Transport outcome unknown");
    },
  };
  const beforeBroadcast = () => {
    assert(paused, "Rip pause no longer finalized");
  };
  await broadcastSavedTransaction(connection, entry, beforeBroadcast);
  paused = false;
  await assert.rejects(
    broadcastSavedTransaction(connection, entry, beforeBroadcast),
    /Rip pause no longer finalized/,
  );
  assert.equal(broadcasts, 1);
});

test("unrelated sends retain the same transport reconciliation without a hook", async () => {
  let broadcasts = 0;
  await broadcastSavedTransaction(
    {
      async sendRawTransaction(raw) {
        broadcasts++;
        assert.deepEqual(raw, bytes);
        throw Error("Transport outcome unknown");
      },
    },
    entry,
  );
  assert.equal(broadcasts, 1);
});
