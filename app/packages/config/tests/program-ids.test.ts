import { describe, expect, it } from "vitest";
import { ONEPERCENT_PROGRAM_IDS, validateProgramIds } from "../src/index.js";

describe("published program ids (M6 §4.2, D18)", () => {
  it("publishes devnet, keeps mainnet pending and has no canary", () => {
    expect(Object.keys(ONEPERCENT_PROGRAM_IDS).sort()).toEqual([
      "devnet",
      "localnet",
      "mainnet",
    ]);
    expect(ONEPERCENT_PROGRAM_IDS.devnet).toBe(
      "DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr",
    );
    expect(Object.isFrozen(ONEPERCENT_PROGRAM_IDS)).toBe(true);
    expect(validateProgramIds()).toEqual(ONEPERCENT_PROGRAM_IDS);
  });

  it("rejects malformed, duplicated or extra entries", () => {
    const devnet = ONEPERCENT_PROGRAM_IDS.devnet;
    for (const value of [
      { mainnet: "not-base58-0OIl", devnet },
      { mainnet: devnet, devnet },
      { mainnet: null, devnet, canary: null },
      { mainnet: null },
    ])
      expect(() => validateProgramIds(value)).toThrow();
  });
});
