import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

/** Read retries stay inside the transport. Signed writes are retried only by the
 * journal sender, which repeats its admission check before every broadcast. */
export function createDevnetFetch({ fetchImpl = fetch, poll = delay } = {}) {
  let requestTail = Promise.resolve();
  return async (url, options) => {
    assert.equal(String(url), "https://api.devnet.solana.com");
    const payload = JSON.parse(options.body);
    const isBroadcast = (Array.isArray(payload) ? payload : [payload]).some(
      ({ method }) => method === "sendTransaction",
    );
    for (let attempt = 0; attempt < 12; attempt++) {
      const turn = requestTail.then(() => poll(260));
      requestTail = turn.catch(() => {});
      await turn;
      try {
        const response = await fetchImpl(url, {
          ...options,
          signal: AbortSignal.timeout(20000),
        });
        if (isBroadcast || (response.status !== 429 && response.status < 500))
          return response;
        await response.arrayBuffer();
      } catch (error) {
        if (isBroadcast) throw error;
        // Only read requests may retry without the sender's admission check.
      }
      await poll(Math.min(30000, 2000 * (attempt + 1)));
    }
    throw Error("Devnet RPC retry budget exhausted");
  };
}
