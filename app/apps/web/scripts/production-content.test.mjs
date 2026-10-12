import assert from "node:assert/strict";
import test from "node:test";
import { hasProhibitedBuildContent } from "./production-content.mjs";

test("credential markers and preview code remain prohibited without matching generic library members", () => {
  for (const text of [
    "TURNSTILE_SECRET",
    "WEB_SECRET_KEY",
    "WEB_SECRETKEY",
    "WEB_SECRET123",
    "this._SECRETKEY",
    "api-key=credential",
    "x-api-key",
    "helius-rpc",
    "BEGIN ED25519 PRIVATE KEY",
    "demo/pages",
    "onepercent-demo-build",
  ])
    assert.equal(hasProhibitedBuildContent(text), true, text);
  assert.equal(hasProhibitedBuildContent("this._secretKey = bytes"), false);
  assert.equal(
    hasProhibitedBuildContent("this._secretKey = process.env.WEB_SECRETKEY"),
    true,
  );
});
