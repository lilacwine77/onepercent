import "../test/setup";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  incomingReferral,
  rememberReferral,
  REFERRAL_SESSION_KEY,
  storedReferral,
  ripReferral,
} from "./referral";

const address = "ATXnDZiLoMMsMGvmWdKRFxhCSLPX8UvzC7UKLt5wBbyM";
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());
it("keeps the first valid referral across route visits", () => {
  rememberReferral(incomingReferral("?ref=friend_01"));
  rememberReferral(incomingReferral(`?ref=${address}`));
  expect(storedReferral()).toBe("friend_01");
});
it("ignores invalid query codes and permits a later valid referral", () => {
  for (const value of [
    "%3Cscript%3E",
    "aa",
    "UPPERCASE_ALIAS",
    "alias-with-dash",
    "a".repeat(17),
  ])
    rememberReferral(incomingReferral(`?ref=${value}`));
  expect(storedReferral()).toBeUndefined();
  rememberReferral(incomingReferral(`?ref=${address}`));
  expect(storedReferral()).toBe(address);
});
it("only passes a valid address other than the buyer to a future Rip", () => {
  rememberReferral("friend_01");
  expect(ripReferral(address)).toBeUndefined();
  sessionStorage.setItem(REFERRAL_SESSION_KEY, address);
  expect(ripReferral(address)).toBeUndefined();
  expect(ripReferral("11111111111111111111111111111111")).toBe(address);
  sessionStorage.setItem(REFERRAL_SESSION_KEY, "1".repeat(44));
  expect(ripReferral(address)).toBeUndefined();
});
it("does not require session storage for a read-only visit", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  expect(() => rememberReferral("friend_01")).not.toThrow();
  expect(storedReferral()).toBeUndefined();
});
