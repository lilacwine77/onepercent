import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { WebConfigResponse } from "../src/web-config.js";
it("requires the explicit XRAY capability in recorded public web config", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../fixtures/web-config.json", import.meta.url),
      "utf8",
    ),
  );
  expect(WebConfigResponse.parse(fixture).flags).toEqual({ XRAY: true });
  expect(
    WebConfigResponse.safeParse({ lookupTable: null, adminMultisig: null })
      .success,
  ).toBe(false);
  expect(
    WebConfigResponse.safeParse({ ...fixture, flags: { XRAY: "true" } })
      .success,
  ).toBe(false);
  expect(
    WebConfigResponse.safeParse({
      ...fixture,
      flags: { XRAY: true, RIP: true },
    }).success,
  ).toBe(false);
});
it("accepts per-flow preview modes additively and rejects unknown flows", () => {
  const base = {
    lookupTable: null,
    adminMultisig: null,
    flags: { XRAY: true },
  };
  expect(WebConfigResponse.parse(base).modes).toBeUndefined();
  expect(
    WebConfigResponse.parse({ ...base, modes: { xray: "live", feed: "demo" } })
      .modes,
  ).toEqual({ xray: "live", feed: "demo" });
  expect(
    WebConfigResponse.safeParse({ ...base, modes: { feed: "beta" } }).success,
  ).toBe(false);
  expect(
    WebConfigResponse.safeParse({ ...base, modes: { boards: "demo" } }).success,
  ).toBe(false);
});
