import { describe, expect, it } from "vitest";
import { takeBackConsent } from "./take-back-consent";

describe("take-back consent budget", () => {
  it("counts ATA rent across prompts rather than comparing each prompt to the total", () => {
    const consent = takeBackConsent({
      maxAtaRentLamports: 10n,
      maxTransactions: 2,
    });
    consent.reserve(10n, 1);
    expect(() => consent.reserve(10n, 1)).toThrow("errors.cardMoved");
    expect(() => consent.reserve(0n, 1)).not.toThrow();
  });
  it("preserves reservations when a plan is rebuilt after a partial submission", () => {
    const consent = takeBackConsent({
      maxAtaRentLamports: 10n,
      maxTransactions: 2,
    });
    consent.reserve(5n, 1);
    expect(() => consent.check(6n, 1)).toThrow("errors.cardMoved");
    expect(() => consent.check(5n, 2)).toThrow("errors.cardMoved");
    expect(() => consent.check(5n, 1)).not.toThrow();
  });
  it("does not spend the budget on a preflight check or a refused reservation", () => {
    const consent = takeBackConsent({
      maxAtaRentLamports: 10n,
      maxTransactions: 1,
    });
    consent.check(10n, 1);
    consent.check(10n, 1);
    expect(() => consent.reserve(11n, 1)).toThrow();
    expect(() => consent.reserve(10n, 1)).not.toThrow();
    expect(() => consent.reserve(0n, 1)).toThrow("errors.cardMoved");
  });
});
