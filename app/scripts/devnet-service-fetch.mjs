// Local rehearsal pacing for the public devnet RPC; service retries remain unchanged.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
assert.equal(process.env.CLUSTER, "devnet");
const original = globalThis.fetch;
let tail = Promise.resolve();
let blockTail = Promise.resolve();
let lastBlockStarted = 0;
globalThis.fetch = async (input, options) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  assert.equal(
    url,
    "https://api.devnet.solana.com",
    "Local service rehearsal only permits public devnet RPC",
  );
  const started = Date.now();
  const method = JSON.parse(options.body).method;
  const turn = tail.then(() => delay(250));
  tail = turn.catch(() => {});
  await turn;
  if (method === "getBlock") {
    const blockTurn = blockTail.then(async () => {
      await delay(Math.max(0, lastBlockStarted + 3000 - Date.now()));
      lastBlockStarted = Date.now();
    });
    blockTail = blockTurn.catch(() => {});
    await blockTurn;
  }
  options?.signal?.throwIfAborted();
  try {
    const response = await original(input, options);
    if (!response.ok) {
      const body = await response.clone().json();
      console.error(
        JSON.stringify({
          diagnostic: "devnet_rpc_http_error",
          method,
          slot:
            method === "getBlock"
              ? JSON.parse(options.body).params[0]
              : undefined,
          status: response.status,
          ms: Date.now() - started,
          count: body.result?.signatures?.length,
          errorCode: body.error?.code,
          invalid: body.result?.signatures
            ?.filter((value) => !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value))
            .map((value) => value.length),
        }),
      );
    }
    return response;
  } catch (error) {
    console.error(
      JSON.stringify({
        diagnostic: "devnet_fetch_error",
        method,
        ms: Date.now() - started,
        name: error?.name,
      }),
    );
    throw error;
  }
};

// Names/codes/stack locations only: never log RPC bodies or environment values.
const { JsonRpcClient } = await import("../packages/service-kit/dist/index.js");
const request = JsonRpcClient.prototype.request;
JsonRpcClient.prototype.request = async function (method, ...args) {
  try {
    return await request.call(this, method, ...args);
  } catch (error) {
    console.error(
      JSON.stringify({
        diagnostic: "devnet_rpc_error",
        method,
        name: error?.name,
        code: typeof error?.code === "number" ? error.code : null,
      }),
    );
    throw error;
  }
};
const { IndexerEngine } =
  await import("../services/worker/dist/indexer/engine.js");
const poll = IndexerEngine.prototype.poll;
IndexerEngine.prototype.poll = function (...args) {
  return poll.apply(this, args).catch((error) => {
    console.error(
      JSON.stringify({
        diagnostic: "devnet_indexer_error",
        name: error?.name,
        code: error?.code,
        locations: error?.stack?.split("\n").slice(1, 5),
      }),
    );
    throw error;
  });
};
