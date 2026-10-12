import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", "dist", ".vitest"].includes(entry.name)) return [];
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
it("keeps technical numeric literals and config imports in their designated modules", () => {
  for (const file of files(resolve(root, "src")).filter((file) =>
    file.endsWith(".ts"),
  )) {
    const name = relative(root, file);
    const ast = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function inspect(node: ts.Node) {
      if (
        !["src/params.ts", "src/http/status.ts"].includes(name) &&
        (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node))
      ) {
        expect(
          ["0", "1", "2", "0n", "1n", "2n"],
          `${name}: ${node.getText(ast)}`,
        ).toContain(node.getText(ast));
      }
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text === "@onepercent/config"
        )
          expect(name).toBe("src/params.ts");
      }
      ts.forEachChild(node, inspect);
    }
    inspect(ast);
  }
});
it("respects naming constraints throughout the package", () => {
  const brief = readFileSync(
    resolve(root, "../../../docs/codex/X2-MARKET-BRIEF.md"),
    "utf8",
  );
  const words = brief
    .split("Do not use these words in code, strings, fixtures or docs: ")[1]!
    .split(".")[0]!
    .split(", ");
  const pattern = new RegExp(`\\b(?:${words.join("|")})\\b`, "i");
  for (const file of files(root))
    expect(readFileSync(file, "utf8"), relative(root, file)).not.toMatch(
      pattern,
    );
});
it("keeps fixture requests and responses free of credential patterns", () => {
  const dir = resolve(root, "tests/fixtures");
  for (const file of files(dir)) {
    const data = readFileSync(file, "utf8");
    expect(data, relative(root, file)).not.toMatch(
      /api-key=|Bearer |sk-[A-Za-z0-9_-]{16,}/i,
    );
    const fixture = JSON.parse(data) as { request?: { url?: string } };
    if (fixture.request?.url) {
      const url = new URL(fixture.request.url);
      expect(url.username).toBe("");
      expect(url.password).toBe("");
    }
  }
});
it("disables accidental global network access", async () => {
  await expect(fetch("https://example.test")).rejects.toThrow(
    "network disabled in tests",
  );
});

it("keeps value paths independent of display prices and token depth estimates", () => {
  const targets = [
    ...files(resolve(root, "src/value")),
    ...files(resolve(root, "src/sellback")),
    resolve(root, "src/listing/evaluate.ts"),
  ];
  for (const file of targets) {
    const text = readFileSync(file, "utf8");
    expect(text, relative(root, file)).not.toMatch(
      /jupiter\/price(?:\.js|\.ts)?/,
    );
    expect(text, relative(root, file)).not.toContain("usdPrice");
    expect(
      text.replaceAll("liquidity_usd", ""),
      relative(root, file),
    ).not.toContain("liquidity");
  }
});
it("keeps market clients read-only", () => {
  for (const file of files(resolve(root, "src"))) {
    expect(readFileSync(file, "utf8"), relative(root, file)).not.toMatch(
      /\/execute|\/submit|sendTransaction/,
    );
  }
});
