import { expect, it } from "vitest";
import {
  DEVNET_GENESIS_HASH,
  MAINNET_GENESIS_HASH,
  SOLANA_GENESIS_HASHES,
} from "../src/index.js";

it("pins full RPC genesis hashes, distinct from Actions chain IDs", () => {
  expect(MAINNET_GENESIS_HASH).toBe(
    "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  );
  expect(DEVNET_GENESIS_HASH).toBe(
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  );
  expect(SOLANA_GENESIS_HASHES).toEqual({
    mainnet: MAINNET_GENESIS_HASH,
    devnet: DEVNET_GENESIS_HASH,
  });
  expect(Object.isFrozen(SOLANA_GENESIS_HASHES)).toBe(true);
});
