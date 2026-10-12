import { describe, expect, it } from "vitest";
import { SERVICES, devnetTransportProfile } from "@onepercent/config";
import { executorTransport } from "./transport.js";

describe("executor cluster transport", () => {
  it("selects the approved devnet cap and no Sender tip", () => {
    expect(executorTransport("devnet", SERVICES.landing)).toEqual(
      devnetTransportProfile("devnet"),
    );
  });
  it.each(["mainnet", "mainnet-beta", "localnet"])(
    "keeps the supplied landing values or their pending state for %s",
    (cluster) => {
      // Release input supplies both values; this test also covers their pending state.
      expect(executorTransport(cluster, SERVICES.landing)).toEqual({
        tipLamports:
          SERVICES.landing.tipLamports === null
            ? null
            : BigInt(SERVICES.landing.tipLamports),
        maxComputeUnitPriceMicroLamports:
          SERVICES.landing.maxComputeUnitPriceMicroLamports === null
            ? null
            : BigInt(SERVICES.landing.maxComputeUnitPriceMicroLamports),
      });
      expect(() => devnetTransportProfile(cluster)).toThrow(
        "devnet_transport_requires_devnet",
      );
    },
  );
});
