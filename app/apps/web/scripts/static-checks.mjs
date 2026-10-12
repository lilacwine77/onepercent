import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowedNumbers = new Set(["0", "1", "2"]);
const publicEnvironment = new Set([
  "VITE_API_URL",
  "VITE_TURNSTILE_SITE_KEY",
  "VITE_CLUSTER",
  // Build-time switch of the preview build (scripts/build-preview.mjs); never set in production.
  "VITE_PREVIEW",
]);

export function inspectSource(name, source) {
  const file = ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
    name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const errors = [];
  const numericArea =
    /^(tx|adapters|data|wallet)\//.test(name) && name !== "data/http-status.ts";
  function report(node, message) {
    const { line, character } = file.getLineAndCharacterOfPosition(
      node.getStart(file),
    );
    errors.push(`${name}:${line + 1}:${character + 1} ${message}`);
  }
  function visit(node) {
    if (
      numericArea &&
      (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node))
    ) {
      const raw = node.text.replace(/_/g, "").replace(/n$/, "");
      const value = ts.isBigIntLiteral(node)
        ? String(BigInt(raw))
        : String(Number(raw));
      const negative =
        ts.isPrefixUnaryExpression(node.parent) &&
        node.parent.operator === ts.SyntaxKind.MinusToken;
      if (
        !allowedNumbers.has(value) ||
        (negative && value !== "1" && value !== "0")
      ) {
        report(
          node,
          "Move numeric constants to @onepercent/config (HTTP status codes belong in data/http-status.ts).",
        );
      }
    }
    if (ts.isStringLiteralLike(node)) {
      const parent = node.parent;
      const moduleReference =
        ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
          parent.moduleSpecifier === node) ||
        (ts.isCallExpression(parent) &&
          parent.expression.kind === ts.SyntaxKind.ImportKeyword);
      if (
        moduleReference &&
        (node.text === "@onepercent/sdk" ||
          /^@onepercent\/sdk\/server(?:\/|$)/.test(node.text))
      ) {
        report(
          node,
          "Use @onepercent/sdk/browser or a targeted SDK subpath for browser code; operational SDK imports are forbidden.",
        );
      }
      if (
        moduleReference &&
        /(?:^|\/)experience\//.test(node.text) &&
        !/\/experience\/index(?:\.[jt]sx?)?$/.test(node.text)
      ) {
        report(
          node,
          "Import experience components only through experience/index.ts.",
        );
      }
      if (node.text.startsWith("VITE_") && !publicEnvironment.has(node.text)) {
        report(
          node,
          "Only the three public VITE environment variables are permitted.",
        );
      }
    }
    if (
      ts.isIdentifier(node) &&
      node.text.startsWith("VITE_") &&
      !publicEnvironment.has(node.text)
    ) {
      report(
        node,
        "Only the three public VITE environment variables are permitted.",
      );
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const called = ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : ts.isElementAccessExpression(expression) &&
            ts.isStringLiteralLike(expression.argumentExpression)
          ? expression.argumentExpression.text
          : ts.isIdentifier(expression)
            ? expression.text
            : null;
      if (
        called === "setResult" &&
        name !== "tx/watch-pull.ts" &&
        name !== "bridge/RipMount.tsx"
      ) {
        report(
          node,
          "Only the cross-checked reveal path may call setResult; the bridge may forward it.",
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return errors;
}

async function sources(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "experience") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sources(path)));
    else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
    )
      result.push(path);
  }
  return result;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(web, "src");
  const errors = [];
  for (const path of await sources(root))
    errors.push(
      ...inspectSource(relative(root, path), await readFile(path, "utf8")),
    );
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else console.log("Web static rules passed.");
}
