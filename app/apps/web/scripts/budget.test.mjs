import assert from "node:assert/strict";
import { test } from "node:test";
import { measureBudgets } from "./budget.mjs";

function fixture(overrides = {}) {
  return {
    settings: {
      entryJsGzipBytes: 122000,
      routeJsGzipBytes: 250000,
      entryDynamicSources: ["xray"],
      entryForbiddenModules: ["three"],
      experienceChunk: "experience-3d",
      chunkJsGzipBytes: { tv: 155000 },
      initialCssSources: ["home"],
      initialCssGzipBytes: 30000,
      lazyCssChunkGzipBytes: 16000,
    },
    manifest: {
      entry: {
        isEntry: true,
        file: "entry.js",
        imports: ["shared"],
        css: ["shell.css"],
      },
      shared: { file: "shared.js", css: ["shared.css"] },
      xray: { isDynamicEntry: true, file: "xray.js", imports: ["shared"] },
      home: {
        isDynamicEntry: true,
        file: "home.js",
        imports: ["shared"],
        css: ["home.css"],
      },
      cards: {
        isDynamicEntry: true,
        file: "cards.js",
        css: ["cards.css", "shared.css"],
      },
      rip: { isDynamicEntry: true, file: "rip.js", css: ["rip.css"] },
      tv: {
        isDynamicEntry: true,
        name: "experience-3d",
        file: "tv.js",
        imports: ["three"],
      },
      three: { file: "three.js" },
    },
    modules: { "entry.js": [], "shared.js": [], "xray.js": [] },
    size: async (file) =>
      ({
        "shell.css": 14000,
        "shared.css": 1000,
        "home.css": 15000,
        "cards.css": 16000,
        "rip.css": 16000,
        ...overrides,
      })[file] ?? 100,
  };
}

test("initial CSS includes Home and shared imports once; lazy CSS has separate per-file limits", async () => {
  const result = await measureBudgets(fixture());
  assert.deepEqual(result.failures, []);
  assert.equal(
    result.measurements.find((row) => row.label === "css-initial").gzipBytes,
    30000,
  );
  assert.deepEqual(
    result.measurements
      .filter((row) => row.label.endsWith(".css"))
      .map((row) => row.label),
    ["cards.css", "rip.css"],
  );
});

test("one extra byte fails either CSS limit, including every lazy chunk", async () => {
  for (const [file, bytes] of [
    ["home.css", 15001],
    ["cards.css", 16001],
    ["rip.css", 16001],
  ]) {
    const result = await measureBudgets(fixture({ [file]: bytes }));
    assert.equal(result.failures.length, 1);
    assert.match(
      result.failures[0],
      file === "home.css" ? /Initial CSS/ : new RegExp(file),
    );
  }
});

test("missing initial CSS source cannot silently reduce the measurement", async () => {
  const inputs = fixture();
  delete inputs.manifest.home;
  await assert.rejects(measureBudgets(inputs), /Manifest import missing: home/);
});

test("entry and TV limits count their complete static JavaScript closures", async () => {
  const inputs = fixture({ "entry.js": 121801, "three.js": 154901 });
  const result = await measureBudgets(inputs);
  assert.deepEqual(result.failures, [
    "entry: 122001 > 122000",
    "tv: 155001 > 155000",
  ]);
  inputs.modules["shared.js"] = ["/node_modules/three/src/Three.js"];
  assert.match(
    (await measureBudgets(inputs)).failures.join("\n"),
    /Entry includes three/,
  );
});

test("deferred copy cannot return through an indirect initial import", async () => {
  const inputs = fixture();
  inputs.settings.entryForbiddenSources = ["copy/dist/catalog-routes.js"];
  inputs.modules["xray.js"] = ["/packages/copy/dist/catalog-routes.js"];
  assert.match(
    (await measureBudgets(inputs)).failures.join("\n"),
    /Entry includes deferred source/,
  );
});
