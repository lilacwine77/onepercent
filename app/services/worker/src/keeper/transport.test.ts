import { expect, it } from "vitest";
import { keeperPriorityCap } from "./transport.js";

it("selects devnet's cap without filling a pending mainnet value", () => {
  expect(keeperPriorityCap("devnet", null)).toBe(1_000_000n);
  for (const cluster of ["mainnet-beta", "mainnet", "localnet"]) {
    expect(keeperPriorityCap(cluster, null)).toBeNull();
    expect(keeperPriorityCap(cluster, 123)).toBe(123n);
  }
});
