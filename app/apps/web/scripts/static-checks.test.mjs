import assert from "node:assert/strict";
import test from "node:test";
import { inspectSource } from "./static-checks.mjs";

test("numeric checks parse code, including bigint, negative and alternate bases", () => {
  assert.equal(
    inspectSource(
      "data/item.ts",
      "const good = [0, 1, 2, -1, 0n, 1n, 2n, -1n]; // 500\nconst text = '500';",
    ).length,
    0,
  );
  assert.equal(
    inspectSource("tx/item.ts", "const bad = [3, -2, 12n, -2n, 0xff, 1_500];")
      .length,
    6,
  );
  assert.equal(
    inspectSource("data/http-status.ts", "export const OK = 200;").length,
    0,
  );
});

test("experience imports and reveal calls cannot bypass checks with dynamic access", () => {
  assert.equal(
    inspectSource(
      "bridge/Slot.tsx",
      "import { Hero } from '../experience/index'; import('../experience/index.ts');",
    ).length,
    0,
  );
  assert.equal(
    inspectSource(
      "bridge/Slot.tsx",
      "import('../experience/Hero'); export * from '../experience/contracts';",
    ).length,
    2,
  );
  assert.equal(
    inspectSource(
      "adapters/result.ts",
      "stage.setResult({}); stage['setResult']({}); setResult({});",
    ).length,
    3,
  );
  assert.equal(
    inspectSource("tx/watch-pull.ts", "stage.setResult({});").length,
    0,
  );
});

test("public environment allow-list catches dot access, bracket access and destructuring", () => {
  assert.equal(
    inspectSource(
      "main.tsx",
      "const a = import.meta.env.VITE_CLUSTER; const b = import.meta.env['VITE_API_URL']; const c = import.meta.env.VITE_LAUNCH_AT;",
    ).length,
    0,
  );
  assert.equal(
    inspectSource(
      "main.tsx",
      "const a = import.meta.env.VITE_PROVIDER; const b = import.meta.env['VITE_PASSWORD']; const { VITE_TOKEN } = import.meta.env;",
    ).length,
    3,
  );
});

test("browser imports exclude the SDK operational barrel", () => {
  for (const statement of [
    'import { maxQty } from "@onepercent/sdk";',
    'export { maxQty } from "@onepercent/sdk";',
    'import("@onepercent/sdk");',
    'import { stockBuyGuard } from "@onepercent/sdk/server";',
    'export { execBegin } from "@onepercent/sdk/server";',
    'import("@onepercent/sdk/server");',
    'import("@onepercent/sdk/server/stockBuy");',
  ]) {
    const errors = inspectSource("data/sdk.ts", statement);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /targeted SDK subpath/);
  }
  assert.deepEqual(
    inspectSource(
      "data/sdk.ts",
      'import { maxQty } from "@onepercent/sdk/browser"; import("@onepercent/sdk/rescue");',
    ),
    [],
  );
});
