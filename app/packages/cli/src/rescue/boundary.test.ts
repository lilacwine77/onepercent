import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

async function sourceFiles(directory: URL) {
  const names = await readdir(directory);
  return Promise.all(
    names
      .filter(
        (name) =>
          name.endsWith(".ts") &&
          !name.endsWith(".test.ts") &&
          name !== "drill.ts",
      )
      .map(async (name) => {
        const path = new URL(name, directory);
        const text = await readFile(path, "utf8");
        return ts.createSourceFile(
          fileURLToPath(path),
          text,
          ts.ScriptTarget.Latest,
          true,
        );
      }),
  );
}

function visit(node: ts.Node, check: (node: ts.Node) => void) {
  check(node);
  node.forEachChild((child) => visit(child, check));
}

function insideFunction(node: ts.Node, name: string): boolean {
  let parent: ts.Node | undefined = node;
  while (parent) {
    if (
      (ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) &&
      parent.name?.getText() === name
    )
      return true;
    parent = parent.parent;
  }
  return false;
}

describe("rescue production dependency boundaries", () => {
  it("imports no application API, indexer, keeper or database code", async () => {
    const files = [
      ...(await sourceFiles(new URL("./", import.meta.url))),
      ...(await sourceFiles(
        new URL("../../../sdk/src/rescue/", import.meta.url),
      )),
    ];
    for (const file of files) {
      const imports: string[] = [];
      visit(file, (node) => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        )
          imports.push(node.moduleSpecifier.text);
        if (
          ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            node.expression.getText() === "require")
        )
          throw new Error(`Dynamic module loading in ${file.fileName}`);
      });
      for (const specifier of imports) {
        expect(specifier, file.fileName).not.toMatch(
          /(?:^|[/@-])(?:api|db|database|indexer|keeper|service-kit|services|drill)(?:[/.-]|$)/,
        );
        expect(specifier, file.fileName).not.toMatch(
          /^(?:pg|postgres|redis|ioredis|axios|undici|node:(?:http|https|net|tls))$/,
        );
      }
      expect(file.text, file.fileName).not.toMatch(
        /(?:process|import\.meta)\.env\b/,
      );
      expect(file.text, file.fileName).not.toMatch(/https?:\/\//);
    }
  });

  it("permits HTTP only in the user-supplied RPC connection and stdin only for approval", async () => {
    const files = [
      ...(await sourceFiles(new URL("./", import.meta.url))),
      ...(await sourceFiles(
        new URL("../../../sdk/src/rescue/", import.meta.url),
      )),
    ];
    let fetches = 0;
    let signerReaders = 0;
    for (const file of files)
      visit(file, (node) => {
        if (
          ts.isCallExpression(node) &&
          /^(?:globalThis\.)?fetch$/.test(node.expression.getText())
        ) {
          fetches++;
          expect(insideFunction(node, "connectRescue"), file.fileName).toBe(
            true,
          );
          expect(node.arguments[0]?.getText()).toBe("input");
        }
        if (ts.isNewExpression(node))
          expect(node.expression.getText(), file.fileName).not.toMatch(
            /^(?:WebSocket|XMLHttpRequest|EventSource)$/,
          );
        if (
          ts.isNewExpression(node) &&
          node.expression.getText() === "Connection"
        ) {
          expect(insideFunction(node, "connectRescue"), file.fileName).toBe(
            true,
          );
          expect(node.arguments?.[0]?.getText()).toBe("url");
        }
        if (
          ts.isPropertyAccessExpression(node) &&
          node.getText() === "process.stdin"
        )
          expect(insideFunction(node, "confirm"), file.fileName).toBe(true);
        if (
          ts.isCallExpression(node) &&
          node.expression.getText() === "deps.readText"
        ) {
          signerReaders++;
          expect(insideFunction(node, "readSigner"), file.fileName).toBe(true);
          expect(node.arguments[0]?.getText()).toBe("input.signerFile");
        }
        if (
          ts.isCallExpression(node) &&
          node.expression.getText() === "Keypair.fromSecretKey"
        )
          expect(insideFunction(node, "readSigner"), file.fileName).toBe(true);
      });
    expect(fetches).toBe(1);
    expect(signerReaders).toBe(1);
  });
});
