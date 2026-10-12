import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { GOVERNANCE, PARAMS, validateParams } from "../src/index.js";

describe("governance ops limits", () => {
  it("publishes and validates the approved D18, D31 and M1 A8 limits", () => {
    expect(GOVERNANCE).toEqual({
      maxTeamWallets: 8,
      guardianCount: 2,
      multisigThreshold: 1,
      multisigMembers: 1,
      timelockSeconds: 0,
      opsWalletMaxLamports: 5_000_000_000n,
      initRentBufferMaxLamports: 50_000_000n,
    });
    expect(PARAMS.GOVERNANCE).toBe(GOVERNANCE);
    expect(validateParams().GOVERNANCE).toEqual(GOVERNANCE);
  });

  it.each(["opsWalletMaxLamports", "initRentBufferMaxLamports"] as const)(
    "rejects changed or malformed %s through validateParams",
    (key) => {
      const limit = GOVERNANCE[key];
      for (const value of [
        limit - 1n,
        limit + 1n,
        0n,
        -1n,
        Number(limit),
        limit.toString(),
        null,
        undefined,
      ]) {
        expect(() =>
          validateParams({
            ...PARAMS,
            GOVERNANCE: { ...GOVERNANCE, [key]: value },
          }),
        ).toThrow(ZodError);
      }
    },
  );

  it("requires the governance section and rejects unknown fields", () => {
    expect(() => validateParams({ ...PARAMS, GOVERNANCE: undefined })).toThrow(
      ZodError,
    );
    expect(() =>
      validateParams({
        ...PARAMS,
        GOVERNANCE: { ...GOVERNANCE, extraLimit: 1n },
      }),
    ).toThrow(ZodError);
  });
});
