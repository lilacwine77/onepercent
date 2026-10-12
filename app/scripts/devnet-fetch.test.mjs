import assert from "node:assert/strict";
import { test } from "node:test";
import { createDevnetFetch } from "./devnet-fetch.mjs";
import { broadcastSavedTransaction } from "./devnet-broadcast.mjs";

const endpoint = "https://api.devnet.solana.com";
const request = (method) => ({
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
});
const noDelay = async () => {};

test("sendTransaction HTTP failures never retry below the admission check", async () => {
  for (const outcome of [429, 500, new Error("Connection timed out")]) {
    let calls = 0;
    const transport = createDevnetFetch({
      poll: noDelay,
      fetchImpl: async () => {
        calls++;
        if (outcome instanceof Error) throw outcome;
        return { status: outcome };
      },
    });
    if (outcome instanceof Error)
      await assert.rejects(
        transport(endpoint, request("sendTransaction")),
        /Connection timed out/,
      );
    else
      assert.equal(
        (await transport(endpoint, request("sendTransaction"))).status,
        outcome,
      );
    assert.equal(calls, 1);
  }
});

test("a persisted send repeats admission after a transport error", async () => {
  let calls = 0;
  let paused = true;
  const transport = createDevnetFetch({
    poll: noDelay,
    fetchImpl: async () => {
      calls++;
      paused = false;
      throw Error("Transport outcome unknown");
    },
  });
  const connection = {
    sendRawTransaction: () => transport(endpoint, request("sendTransaction")),
  };
  const entry = { raw: Buffer.from("signed bytes").toString("base64") };
  const beforeBroadcast = () => assert(paused, "Rip is no longer paused");
  await broadcastSavedTransaction(connection, entry, beforeBroadcast);
  await assert.rejects(
    broadcastSavedTransaction(connection, entry, beforeBroadcast),
    /Rip is no longer paused/,
  );
  assert.equal(calls, 1);
});

test("a batch containing a write also never retries internally", async () => {
  let calls = 0;
  const transport = createDevnetFetch({
    poll: noDelay,
    fetchImpl: async () => {
      calls++;
      return { status: 429 };
    },
  });
  await transport(endpoint, {
    body: JSON.stringify([
      { method: "getSlot" },
      { method: "sendTransaction" },
    ]),
  });
  assert.equal(calls, 1);
});

test("read requests keep bounded retries and throttling", async () => {
  const sleeps = [];
  let calls = 0;
  let consumed = 0;
  const transport = createDevnetFetch({
    poll: async (ms) => sleeps.push(ms),
    fetchImpl: async () => {
      calls++;
      if (calls === 1) throw Error("Read timed out");
      return {
        status: calls === 2 ? 429 : calls === 3 ? 500 : 200,
        arrayBuffer: async () => consumed++,
      };
    },
  });
  assert.equal((await transport(endpoint, request("getSlot"))).status, 200);
  assert.equal(calls, 4);
  assert.equal(consumed, 2);
  assert.deepEqual(sleeps, [260, 2000, 260, 4000, 260, 6000, 260]);

  calls = 0;
  const exhausted = createDevnetFetch({
    poll: noDelay,
    fetchImpl: async () => {
      calls++;
      throw Error("Read timed out");
    },
  });
  await assert.rejects(
    exhausted(endpoint, request("getSlot")),
    /Devnet RPC retry budget exhausted/,
  );
  assert.equal(calls, 12);
});

test("transport rejects other endpoints before making requests", async () => {
  let calls = 0;
  const transport = createDevnetFetch({
    poll: noDelay,
    fetchImpl: async () => calls++,
  });
  await assert.rejects(
    transport("https://example.invalid", request("getSlot")),
  );
  assert.equal(calls, 0);
});
