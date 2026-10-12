import { TX_LIMITS } from "@onepercent/config";
import { describe, expect, it } from "vitest";
import { IDL } from "../src/index.js";

describe("My cards Rust constant parity", () => {
  it.each(["MAX_SELL_BACK_CARDS", "MAX_FEED_BACK_CARDS"])(
    "%s matches TX_LIMITS.redeemPerTx in the generated IDL",
    (name) => {
      const constant = IDL.constants?.find((entry) => entry.name === name);
      expect(constant, name).toBeDefined();
      expect(Number(constant!.value)).toBe(TX_LIMITS.redeemPerTx);
    },
  );
});
