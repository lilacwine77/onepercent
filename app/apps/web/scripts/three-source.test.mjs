import assert from "node:assert/strict";
import { test } from "node:test";
import { compactShader, threeSourceShaders } from "./three-source.mjs";

test("GLSL compaction preserves directives, token separation and shader instructions", () => {
  assert.equal(
    compactShader(`
    // lighting
    #ifdef USE_MAP
    float /* units */ intensity = 1.0; // default
    gl_FragColor = vec4( intensity );

    #endif
  `),
    "#ifdef USE_MAP\nfloat intensity = 1.0;\ngl_FragColor = vec4( intensity );\n#endif",
  );
});

test("only pinned Three GLSL templates are transformed, without evaluating code", () => {
  const plugin = threeSourceShaders();
  const source = "export default /* glsl */`\n // note\n void main() {}\n`;";
  const id =
    "/node_modules/three/src/renderers/shaders/ShaderChunk/example.glsl.js";
  assert.equal(
    plugin.transform(source, id).code,
    'export default "void main() {}";',
  );
  assert.equal(
    plugin.transform(source, "/src/experience/shader.ts"),
    undefined,
  );
  assert.throws(
    () => plugin.transform("export default `${value}`;", id),
    /Unsupported Three shader source/,
  );
});

test("every installed Three shader keeps the prebuilt GLSL tokens and directive lines", async () => {
  const { ShaderChunk: source } =
    await import("three/src/renderers/shaders/ShaderChunk.js");
  const { ShaderChunk: prebuilt } = await import("three");
  const tokens = (code) => code.match(/[A-Za-z0-9_]+|[^\s]/g);
  const directives = (code) =>
    code
      .split("\n")
      .filter((line) => line.trimStart().startsWith("#"))
      .map((line) => tokens(line));
  for (const [name, shader] of Object.entries(source)) {
    const actual = compactShader(shader);
    const expected = compactShader(prebuilt[name]);
    assert.deepEqual(tokens(actual), tokens(expected), name);
    assert.deepEqual(directives(actual), directives(expected), name);
  }
});
