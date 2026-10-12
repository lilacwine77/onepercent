import { readFileSync } from "node:fs";
import { TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import {
  createJupiterSwapClient,
  toTransactionInstruction,
  type SwapBuildInput,
} from "../src/jupiter/swap.js";
import { MARKET } from "../src/params.js";
import { fixtureFetch } from "../src/testing.js";

const file = (name: string) =>
  new URL(`./fixtures/jupiter/${name}.json`, import.meta.url);
const read = (name: string) =>
  JSON.parse(readFileSync(file(name), "utf8")) as {
    request: { url: string };
    response: {
      body: {
        inAmount: string;
        outAmount: string;
        otherAmountThreshold: string;
      };
    };
  };
const env = {
  pythHermesUrl: MARKET.pyth.defaultHermesUrl,
  jupiterApiKey: "fixture-only",
};
const clock = {
  nowMs: () => 1_000,
  sleep: () => new Promise<void>(() => {}),
  random: () => 0,
};
function input(name: string) {
  const query = new URL(read(name).request.url).searchParams;
  return {
    inputMint: query.get("inputMint")!,
    outputMint: query.get("outputMint")!,
    amount: BigInt(query.get("amount")!),
  };
}
function buildInput(): SwapBuildInput {
  const query = new URL(read("swap-build-wif").request.url).searchParams;
  return {
    ...input("swap-build-wif"),
    taker: query.get("taker")!,
    slippageBps: Number(query.get("slippageBps")!),
  };
}

describe("Jupiter Swap v2", () => {
  it("quotes only with allowed parameters and exact integer units", async () => {
    const fetch = vi.fn(fixtureFetch(file("swap-sell-wif")));
    const client = createJupiterSwapClient({ fetch, env, clock });
    const quote = await client.quoteSell(
      input("swap-sell-wif").inputMint,
      input("swap-sell-wif").amount,
    );
    const raw = read("swap-sell-wif").response.body;
    expect(quote).toMatchObject({
      inAmount: BigInt(raw.inAmount),
      outAmount: BigInt(raw.outAmount),
      minOut: BigInt(raw.otherAmountThreshold),
      fetchedAtMs: 1_000,
    });
    expect(typeof quote.priceImpact).toBe("string");
    expect(
      [...new URL(String(fetch.mock.calls[0]![0])).searchParams.keys()].sort(),
    ).toEqual(["amount", "inputMint", "outputMint", "swapMode"]);
  });

  it("provides the wSOL buy helper and NO_ROUTE without retry", async () => {
    const buy = createJupiterSwapClient({
      fetch: fixtureFetch(file("swap-buy-wif")),
      env,
      clock,
    });
    const buyInput = input("swap-buy-wif");
    expect(
      (await buy.quoteBuy(buyInput.outputMint, buyInput.amount)).outAmount,
    ).toBe(BigInt(read("swap-buy-wif").response.body.outAmount));
    const fetch = vi.fn(fixtureFetch(file("swap-no-route")));
    const client = createJupiterSwapClient({ fetch, env, clock });
    await expect(client.quote(input("swap-no-route"))).rejects.toMatchObject({
      code: "NO_ROUTE",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("builds bounded instructions with zero platform fee and converts them", async () => {
    const fetch = vi.fn(fixtureFetch(file("swap-build-wif")));
    const client = createJupiterSwapClient({ fetch, env, clock });
    const build = await client.build(buildInput());
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.searchParams.get("platformFeeBps")).toBe("0");
    expect(url.searchParams.has("feeAccount")).toBe(false);
    expect(url.searchParams.get("maxAccounts")).toBe(
      String(MARKET.jupiter.buildMaxAccounts),
    );
    expect(toTransactionInstruction(build.swapInstruction)).toBeInstanceOf(
      TransactionInstruction,
    );
    expect(toTransactionInstruction(build.swapInstruction).data).toEqual(
      Buffer.from(build.swapInstruction.data, "base64"),
    );
    expect(build.minOut).toBeGreaterThanOrEqual(
      (build.outAmount * 9_800n) / 10_000n,
    );
    expect(Object.keys(build.lookupTables).length).toBeGreaterThan(0);
  });

  it("rejects a minimum output one unit below the required floor", async () => {
    const client = createJupiterSwapClient({
      fetch: fixtureFetch(file("swap-build-too-low")),
      env,
      clock,
    });
    await expect(client.build(buildInput())).rejects.toMatchObject({
      code: "PROVIDER_SCHEMA",
    });
  });

  it("rejects response mints that differ from the quoted request", async () => {
    const client = createJupiterSwapClient({
      fetch: fixtureFetch(file("swap-mismatched-mint")),
      env,
      clock,
    });
    await expect(client.quote(input("swap-sell-wif"))).rejects.toMatchObject({
      code: "PROVIDER_SCHEMA",
    });
  });

  it("rejects invalid inputs before calling a provider", async () => {
    const fetch = vi.fn(fixtureFetch(file("swap-build-wif")));
    const client = createJupiterSwapClient({ fetch, env, clock });
    await expect(
      client.quote({ ...input("swap-sell-wif"), amount: 0n }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      client.quote({ ...input("swap-sell-wif"), inputMint: "invalid" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    for (const patch of [
      { slippageBps: NaN },
      { slippageBps: 10_001 },
      { maxAccounts: 0 },
      { maxAccounts: 65 },
    ]) {
      await expect(
        client.build({ ...buildInput(), ...patch }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

it("passes the optional native wrapping flag through to build", async () => {
  const raw = read("swap-build-wif").response.body;
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify(raw), { status: 200 }),
  );
  const client = createJupiterSwapClient({ fetch: fetcher, env, clock });
  await client.build({ ...buildInput(), wrapAndUnwrapSol: false });
  expect(
    new URL(String(fetcher.mock.calls[0]?.[0])).searchParams.get(
      "wrapAndUnwrapSol",
    ),
  ).toBe("false");
});
