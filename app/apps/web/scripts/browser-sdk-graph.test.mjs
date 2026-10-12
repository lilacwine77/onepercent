import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { browserParams, browserParamsSource } from "./browser-params.mjs";

const web = fileURLToPath(new URL("..", import.meta.url));
const entry = "\0onepercent-browser-sdk-test";
const indirect = "\0onepercent-browser-sdk-indirect-test";
const serviceParameters = [
  "HIT_LIST",
  "KEEPER_POLICY",
  "POST_REVEAL_BUY_DELAY",
];

async function buildBrowserSdk({ conditions = [], indirectSource = "" } = {}) {
  const reached = new Set();
  await build({
    root: web,
    configFile: false,
    envFile: false,
    logLevel: "silent",
    resolve: { conditions },
    plugins: [
      browserParams(),
      {
        name: "onepercent-browser-sdk-test",
        resolveId(source) {
          if (source === entry || source === indirect) return source;
        },
        load(id) {
          reached.add(id.replaceAll("\\", "/"));
          if (id === entry)
            return `export * from "@onepercent/sdk/browser";${indirectSource ? `export * from ${JSON.stringify(indirect)};` : ""}`;
          if (id === indirect) return indirectSource;
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      rolldownOptions: {
        input: entry,
        // Keep this a first-party graph check; dependency bundling has its own
        // production build. Config stays internal so missing exports are fatal.
        external: (source) =>
          !source.startsWith(".") &&
          !source.startsWith("/") &&
          !source.startsWith("\0") &&
          source !== "@onepercent/config" &&
          !source.startsWith("@onepercent/sdk"),
        output: { format: "es" },
      },
    },
  });
  return reached;
}

test("browser SDK graph excludes server modules before tree shaking in both resolutions", async () => {
  for (const conditions of [[], ["development"]]) {
    const reached = await buildBrowserSdk({ conditions });
    const expectedEntry = conditions.includes("development")
      ? "/sdk/src/browser.ts"
      : "/sdk/dist/browser.js";
    assert.ok(
      [...reached].some((id) => id.endsWith(expectedEntry)),
      `the package browser subpath must resolve to ${expectedEntry}`,
    );
    const server = [...reached].filter((id) =>
      /\/sdk\/(?:src|dist)\/(?:server\/|math\/(?:stockBuy|exec)\.[jt]s$)/.test(
        id,
      ),
    );
    assert.deepEqual(
      server,
      [],
      "no server SDK module may enter the browser graph",
    );
  }
});

test("indirect SDK exports of service parameters fail the browser build", async () => {
  const projection = browserParamsSource();
  for (const name of serviceParameters) {
    assert.ok(!projection.includes(`export const ${name}=`), name);
    await assert.rejects(
      buildBrowserSdk({
        indirectSource: `export { ${name} } from "@onepercent/config";`,
      }),
      (error) => {
        assert.match(String(error), /MISSING_EXPORT/);
        assert.ok(String(error).includes(name));
        return true;
      },
    );
  }
});
