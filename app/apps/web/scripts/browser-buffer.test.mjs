import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import {
  browserBufferReferences,
  browserByteDependencies,
} from "./browser-buffer.mjs";

test("rejects implicit Buffer in eager, lazy and worker code", () => {
  for (const source of [
    "const id = Buffer.from([1]);",
    "export async function reveal() { return Buffer.from(await load()); }",
    "self.onmessage = () => Buffer.alloc(8);",
    "export const bytes = { Buffer };",
    "Buffer = implementation;",
    "const bytes = globalThis.Buffer.from([]);",
    'window["Buffer"] = implementation;',
    "const f = () => Buffer.from([]); function other(Buffer) { return Buffer; }",
  ])
    assert.ok(browserBufferReferences(source).length > 0, source);
});

test("limits byte compatibility to affected Solana dependency modules", () => {
  const plugin = browserByteDependencies();
  const source = '"use strict"; exports.encode = () => Buffer.from([1]);';
  const patched = plugin.transform(
    source,
    "/app/node_modules/borsh/lib/index.js",
  );
  assert.ok(patched.code.includes('require("buffer/")'));
  assert.deepEqual(browserBufferReferences(patched.code), []);
  assert.equal(plugin.transform(source, "/app/src/main.tsx"), null);
  const bn = plugin.transform(
    "var Buffer; Buffer = window.Buffer || require('buffer').Buffer;",
    "/app/node_modules/bn.js/lib/bn.js",
  );
  assert.deepEqual(browserBufferReferences(bn.code), []);
  assert.ok(!bn.code.includes("window.Buffer"));
});

test("the installed borsh writer works without a browser global", () => {
  const sdkRequire = createRequire(
    new URL("../../../packages/sdk/package.json", import.meta.url),
  );
  const web3Require = createRequire(sdkRequire.resolve("@solana/web3.js"));
  const path = web3Require.resolve("borsh");
  const source = readFileSync(path, "utf8");
  const compile = (code) => {
    const context = { TextDecoder, TextEncoder, Uint8Array };
    assert.equal(runInNewContext("typeof Buffer", context), "undefined");
    const exports = {};
    runInNewContext(
      `(function(require, exports, module) { ${code}\n })`,
      context,
    )(createRequire(path), exports, { exports });
    return exports;
  };
  const original = compile(source);
  assert.throws(() => new original.BinaryWriter(), /Buffer is not defined/);
  const patched = compile(
    browserByteDependencies().transform(source, path).code,
  );
  const writer = new patched.BinaryWriter();
  writer.writeU32(0xffffffff);
  writer.writeU64("18446744073709551615");
  assert.deepEqual([...writer.toArray()], Array(12).fill(255));
});

test("accepts explicit dependency-local bindings without a global polyfill", () => {
  for (const source of [
    'import { Buffer } from "buffer"; export const x = Buffer.from([]);',
    "function convert(Buffer) { return Buffer.from([]); }",
    "const Buffer = localBytes; const x = { Buffer };",
    'const { Buffer: localBytes } = require("buffer"); localBytes.from([]);',
    'import { Buffer as localBytes } from "buffer"; export { localBytes as Buffer };',
    'const data = dependency.Buffer.from([]); const message = "Buffer";',
    "const BufferGeometry = geometry; const BufferAttribute = attribute;",
    "const view = new DataView(new Uint8Array(8).buffer);",
  ])
    assert.deepEqual(browserBufferReferences(source), [], source);
});
