import { expect, it } from "vitest";
import { machineFlows, resolveModes } from "./modes";

it("a live Feed never gets shared demo configuration while Rip and My cards stay demo", () => {
  expect(machineFlows(resolveModes(undefined))).toBe(true);
  expect(machineFlows(resolveModes({ feed: "live" }))).toBe(false);
  expect(machineFlows(resolveModes({ rip: "live" }))).toBe(false);
  expect(machineFlows(resolveModes({ cards: "live" }))).toBe(false);
  expect(machineFlows(resolveModes({ xray: "live" }))).toBe(true);
});
