import { describe, expect, it } from "vitest";
import { readWebConfig } from "./web-config.js";
describe("public web configuration", () => {
  it.each([undefined, "", " ", "off", "false"])(
    "defaults or explicitly disables XRAY for %s",
    (value) => {
      expect(readWebConfig({ FLAG_XRAY: value }).flags).toEqual({
        XRAY: false,
      });
    },
  );
  it.each(["on", "true"])(
    "enables XRAY for %s without disclosing the source or credentials",
    (value) => {
      expect(
        readWebConfig({
          FLAG_XRAY: value,
          HELIUS_API_KEY: "secret",
          XRAY_SOURCE: "live",
        }),
      ).toEqual({
        lookupTable: null,
        adminMultisig: null,
        flags: { XRAY: true },
      });
    },
  );
  it("rejects an invalid flag with a generic error", () => {
    expect(() => readWebConfig({ FLAG_XRAY: "secret" })).toThrow(
      /^Invalid web configuration$/,
    );
  });
  it("adds per-flow preview modes only when WEB_FLOW_MODES is set", () => {
    expect(readWebConfig({ FLAG_XRAY: "on" })).not.toHaveProperty("modes");
    expect(
      readWebConfig({ FLAG_XRAY: "on", WEB_FLOW_MODES: " " }),
    ).not.toHaveProperty("modes");
    expect(
      readWebConfig({
        FLAG_XRAY: "on",
        WEB_FLOW_MODES: "xray=live, feed=demo,rip=demo cards=demo",
      }).modes,
    ).toEqual({ xray: "live", feed: "demo", rip: "demo", cards: "demo" });
  });
  it.each(["feed", "feed=beta", "boards=demo", "feed=demo=live"])(
    "rejects an invalid WEB_FLOW_MODES entry (%s) with a generic error",
    (value) => {
      expect(() =>
        readWebConfig({ FLAG_XRAY: "on", WEB_FLOW_MODES: value }),
      ).toThrow(/^Invalid web configuration$/);
    },
  );
});
