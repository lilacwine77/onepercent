import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { browserConfig } from "./browser-config.mjs";

test("parameter projection stays with the shared browser params plugin", () => {
  const plugin = browserConfig();
  assert.equal(plugin.resolveId("@onepercent/config"), null);
  assert.equal(plugin.load("unrelated"), null);
});

test("X1 chain readers bind the SDK buffer locally, never a global shim", () => {
  const plugin = browserConfig();
  const source = "const bytes = Buffer.from([1]);";
  for (const name of ["origin", "raw", "mint-safety", "curve-cap"]) {
    const result = plugin.transform(
      source,
      `/app/packages/eligibility/dist/${name}.js`,
    );
    assert.match(result.code, /^import \{ Buffer \} from /);
    assert.equal(result.code.includes("globalThis"), false);
  }
  assert.equal(plugin.transform(source, "/app/apps/web/src/example.ts"), null);
  assert.equal(
    plugin.transform(
      'import { Buffer } from "buffer";' + source,
      "/app/packages/eligibility/dist/raw.js",
    ),
    null,
  );
});

test("the browser Anchor bridge preserves SDK exports and keeps Node interoperability", () => {
  const source = readFileSync(
    new URL("../../../packages/sdk/src/anchor.ts", import.meta.url),
    "utf8",
  );
  const exportsOf = (code) =>
    /export (?:const )?\{([^}]+)\}/
      .exec(code)[1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
      .sort();
  const plugin = browserConfig();
  const path = "/app/packages/sdk/dist/anchor.js";
  assert.deepEqual(
    exportsOf(plugin.transform(source, path).code),
    exportsOf(source),
  );
  plugin.configResolved({
    mode: "test",
    root: fileURLToPath(new URL("../", import.meta.url)),
  });
  assert.equal(plugin.transform(source, path), null);
});

test("the Borsh peer facade covers every Web3 use in the pinned dependency", () => {
  const anchor = createRequire(import.meta.resolve("@onepercent/sdk")).resolve(
    "@anchor-lang/core",
  );
  const path = createRequire(anchor).resolve("@anchor-lang/borsh");
  const source = readFileSync(path, "utf8");
  const binding = /const (\w+) = require\("@solana\/web3\.js"\)/.exec(
    source,
  )[1];
  const uses = [...source.matchAll(new RegExp(`\\b${binding}\\.(\\w+)`, "g"))];
  assert.deepEqual([...new Set(uses.map((match) => match[1]))], ["PublicKey"]);
  assert.equal(
    [...source.matchAll(new RegExp(`\\b${binding}\\b`, "g"))].length,
    uses.length + 1,
  );
  const plugin = browserConfig();
  assert.equal(
    plugin.load(plugin.resolveId("@solana/web3.js", path)),
    'export { PublicKey } from "@solana/web3.js";',
  );
  assert.equal(plugin.resolveId("@solana/web3.js", "/app/example.ts"), null);
});
