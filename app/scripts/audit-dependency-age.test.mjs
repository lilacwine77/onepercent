import assert from "node:assert/strict";
import test from "node:test";
import {
  cargoDirect,
  cargoPackages,
  documentationDates,
  npmDirect,
  npmPackages,
  publicationCheck,
} from "./audit-dependency-age.mjs";

test("pnpm audit includes scoped and optional locked packages without peer suffixes", () => {
  const rows = npmPackages(
    "lockfileVersion: '9.0'\npackages:\n  '@scope/package@1.2.3':\n    optional: true\n  tool@2.0.0-beta.1:\n    resolution: {}\nsnapshots:\n  '@scope/package@1.2.3(peer@1.0.0)': {}\n",
  );
  assert.deepEqual(rows, [
    { registry: "npm", name: "@scope/package", version: "1.2.3" },
    { registry: "npm", name: "tool", version: "2.0.0-beta.1" },
  ]);
  assert.throws(
    () => npmPackages("packages:\n  https://example.invalid/pkg:\n"),
    /Unsupported npm lock/,
  );
});

test("Cargo lock audit includes every registry version and rejects unhandled sources", () => {
  const rows = cargoPackages(
    '[[package]]\nname = "local"\nversion = "0.1.0"\n[[package]]\nname = "serde"\nversion = "1.0.229"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n',
  );
  assert.deepEqual(rows, [
    { registry: "cargo", name: "serde", version: "1.0.229" },
  ]);
  assert.throws(
    () =>
      cargoPackages(
        '[[package]]\nname = "external"\nversion = "1.0.0"\nsource = "git+https://example.invalid/lib"',
      ),
    /Unsupported Cargo lock/,
  );
});

test("direct manifests include the package manager and require exact pins", () => {
  assert.deepEqual(
    npmDirect({
      packageManager: "pnpm@10.34.5",
      dependencies: { local: "workspace:*", external: "1.2.3" },
    }).map((row) => row.name),
    ["external", "pnpm"],
  );
  assert.throws(
    () => npmDirect({ dependencies: { external: "^1.2.3" } }),
    /must be exact/,
  );
  assert.deepEqual(
    cargoDirect(
      '[dependencies]\nrename = { version = "=1.2.3", package = "real-name" }\n[dev-dependencies]\ntest-lib = "=2.0.0"\n',
    ).map((row) => row.name),
    ["real-name", "test-lib"],
  );
  assert.throws(
    () => cargoDirect('[dependencies]\nexternal = "1.2.3"\n'),
    /unpinned Cargo/,
  );
  assert.throws(
    () => cargoDirect('[dependencies.external]\nversion = "=1.2.3"\n'),
    /Expanded Cargo/,
  );
});

test("version documentation binds the package, exact version, date and primary link", () => {
  const dates = documentationDates(
    "| Package | Version | Published | Source |\n| `named` | 1.2.3 | 2025-01-01 | [registry](https://registry.npmjs.org/named) |\n| missing-source | 1.2.3 | 2025-01-01 | unchecked |\nThe mock pins `borsh 0.10.4` (2024-09-23).",
  );
  assert.equal(dates.get("named@1.2.3"), "2025-01-01");
  assert.equal(dates.get("named@1.2.4"), undefined);
  assert.equal(dates.get("missing-source@1.2.3"), undefined);
  assert.equal(dates.get("borsh@0.10.4"), "2024-09-23");
  const varied = documentationDates(
    "| @wallet-standard/app | 1.1.1 | web | 2026-06-03 | [registry](https://registry.npmjs.org/@wallet-standard/app) |\nBrowser-safe dependencies: buffer 6.0.3\n([published 2020-11-23](https://registry.npmjs.org/buffer)) and @noble/hashes 1.8.0\n([published 2025-04-21](https://registry.npmjs.org/@noble/hashes)).",
  );
  assert.equal(varied.get("@wallet-standard/app@1.1.1"), "2026-06-03");
  assert.equal(varied.get("buffer@6.0.3"), "2020-11-23");
  assert.equal(varied.get("@noble/hashes@1.8.0"), "2025-04-21");
});

test("publication gate rejects young releases, missing metadata and documentation drift", () => {
  const row = {
    registry: "cargo",
    name: "example",
    version: "1.0.0",
    documented: true,
  };
  const now = new Date("2026-10-09T12:00:00Z");
  assert.doesNotThrow(() =>
    publicationCheck(row, "2026-09-25T12:00:00Z", "2026-09-25", now),
  );
  assert.throws(
    () => publicationCheck(row, "2026-09-25T12:00:01Z", "2026-09-25", now),
    /younger than 14 days/,
  );
  assert.throws(
    () => publicationCheck(row, undefined, "2026-09-25", now),
    /Missing registry/,
  );
  assert.throws(
    () => publicationCheck(row, "2026-09-24T12:00:00Z", undefined, now),
    /Missing publish-date/,
  );
  assert.throws(
    () => publicationCheck(row, "2026-09-24T12:00:00Z", "2026-09-23", now),
    /differs from registry/,
  );
});
