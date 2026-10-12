// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { selectWebDeployment } from "./deployment";
import { configPda } from "@onepercent/sdk";

describe("explicit web deployment", () => {
  it("keeps mainnet and devnet identities separate without requiring Meteora pins", () => {
    const devnet = Keypair.generate().publicKey;
    const mainnet = Keypair.generate().publicKey;
    const first = selectWebDeployment({
      cluster: "devnet",
      programId: devnet.toBase58(),
    });
    const second = selectWebDeployment({
      cluster: "mainnet-beta",
      programId: mainnet.toBase58(),
    });
    expect(first.programId.equals(devnet)).toBe(true);
    expect(second.cluster).toBe("mainnet");
    expect(second.programId.equals(mainnet)).toBe(true);
    expect(
      configPda(first.programId)[0].equals(configPda(second.programId)[0]),
    ).toBe(false);
    expect(() => selectWebDeployment(null)).toThrow();
    expect(() =>
      selectWebDeployment({ cluster: "", programId: devnet.toBase58() }),
    ).toThrow();
  });
});
