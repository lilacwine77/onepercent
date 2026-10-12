import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBrowserConfigModules,
  buildMetadata,
} from "./build-metadata.mjs";

test("browser chunks allow config constants and API response validation", () => {
  assert.doesNotThrow(() =>
    assertBrowserConfigModules({
      "assets/index.js": [
        "/app/packages/config/dist/web.js",
        "/app/packages/config/dist/constants.js",
        "/app/packages/config/dist/feed-back.js",
        "/app/node_modules/zod/v4/classic/schemas.js",
      ],
    }),
  );
});

test("server config is rejected in entry and lazy chunks, across resolution paths", () => {
  for (const chunk of ["assets/index.js", "assets/lazy.js"])
    for (const root of ["packages/config", "node_modules/@onepercent/config"])
      for (const file of ["index", "services", "new-server-schema"])
        for (const [directory, extension] of [
          ["src", "ts"],
          ["dist", "js"],
        ]) {
          const id = `/app/${root}/${directory}/${file}.${extension}`;
          for (const path of [id, id.replaceAll("/", "\\"), `${id}?query`])
            assert.throws(
              () => assertBrowserConfigModules({ [chunk]: [path] }),
              /includes server config/,
            );
        }
});

test("the production metadata hook fails before emitting a contaminated bundle", () => {
  const plugin = buildMetadata();
  const emitted = [];
  const context = { emitFile: (file) => emitted.push(file) };
  const output = (renderedLength) => ({
    lazy: {
      type: "chunk",
      fileName: "assets/lazy.js",
      modules: {
        "/app/packages/config/dist/index.js": { renderedLength },
      },
    },
  });
  assert.throws(
    () => plugin.generateBundle.call(context, {}, output(1)),
    /includes server config/,
  );
  assert.equal(emitted.length, 0);
  plugin.generateBundle.call(context, {}, output(0));
  assert.deepEqual(JSON.parse(emitted[0].source), { "assets/lazy.js": [] });
});
