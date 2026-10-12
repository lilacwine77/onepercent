/**
 * Three's source entry keeps route-only features out of the shared TV chunk.
 * Its GLSL sources still contain comments/indentation stripped by Three's own
 * prebuilt distribution. Remove those bytes here too, preserving line breaks
 * for preprocessor directives and leaving shader instructions unchanged.
 */
export function compactShader(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n\r]*/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/[\t ]+/g, " "))
    .filter(Boolean)
    .join("\n");
}
export function threeSourceShaders() {
  return {
    name: "onepercent-three-source-shaders",
    transform(code, id) {
      if (!/\/three\/src\/renderers\/shaders\/.*\.glsl\.js$/.test(id)) return;
      let templates = 0;
      const transformed = code.replace(
        /\/\* glsl \*\/`([\s\S]*?)`/g,
        (_match, source) => {
          if (source.includes("${"))
            throw new Error(`Unsupported Three shader source: ${id}`);
          templates++;
          return JSON.stringify(compactShader(source));
        },
      );
      if (!templates || transformed.includes("`"))
        throw new Error(`Unsupported Three shader source: ${id}`);
      return { code: transformed, map: null };
    },
  };
}
