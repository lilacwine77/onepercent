import "./test-setup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  incomingReferral,
  rememberReferral,
  REFERRAL_SESSION_KEY,
  xrayPageUrl,
} from "./referral";

const address = "ATXnDZiLoMMsMGvmWdKRFxhCSLPX8UvzC7UKLt5wBbyM";
beforeEach(() => window.sessionStorage.clear());

describe("X-ray referrals", () => {
  it("accepts wallet addresses and aliases and ignores invalid incoming values", () => {
    expect(incomingReferral(`?ref=${address}`)).toBe(address);
    expect(incomingReferral("?ref=onepercent_1")).toBe("onepercent_1");
    for (const search of [
      "",
      "?ref=ab",
      "?ref=Invalid-Alias",
      "?ref=%3Cscript%3E",
    ])
      expect(incomingReferral(search)).toBeUndefined();
  });
  it("keeps the first valid incoming code for a later Rip", () => {
    rememberReferral(undefined);
    expect(window.sessionStorage.getItem(REFERRAL_SESSION_KEY)).toBeNull();
    rememberReferral("first_ref");
    rememberReferral("second_ref");
    expect(window.sessionStorage.getItem(REFERRAL_SESSION_KEY)).toBe(
      "first_ref",
    );
  });
  it("tolerates browsers that block session storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    expect(() => rememberReferral("valid_ref")).not.toThrow();
    vi.restoreAllMocks();
  });
  it("adds the scanned address by default and keeps only a valid explicit code", () => {
    expect(xrayPageUrl(address)).toBe(
      `${window.location.origin}/x/${address}?ref=${address}`,
    );
    expect(xrayPageUrl(address, "valid_ref")).toBe(
      `${window.location.origin}/x/${address}?ref=valid_ref`,
    );
    expect(xrayPageUrl(address, "!")).toBe(
      `${window.location.origin}/x/${address}?ref=${address}`,
    );
    rememberReferral("stored_ref");
    expect(xrayPageUrl(address)).toBe(
      `${window.location.origin}/x/${address}?ref=${address}`,
    );
  });
});
