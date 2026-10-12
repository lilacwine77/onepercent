import ts from "typescript";

/** Reject an implicit Node global, including in lazy chunks and workers.
 * Explicit dependency-local bindings and property names are valid: web3.js
 * includes its own byte implementation, without installing a browser global.
 */
export function browserBufferReferences(source) {
  if (!source.includes("Buffer")) return [];
  const name = "/browser-chunk.js";
  const options = { allowJs: true, noLib: true, noResolve: true };
  const file = ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (path) => (path === name ? file : undefined);
  const program = ts.createProgram([name], options, host);
  const checker = program.getTypeChecker();
  const explicitlyBound = (symbol) =>
    symbol?.declarations?.some(
      (declaration) =>
        ts.isVariableDeclaration(declaration) ||
        ts.isParameter(declaration) ||
        ts.isBindingElement(declaration) ||
        ts.isImportSpecifier(declaration) ||
        ts.isImportClause(declaration) ||
        ts.isNamespaceImport(declaration) ||
        ts.isFunctionDeclaration(declaration) ||
        ts.isFunctionExpression(declaration) ||
        ts.isClassDeclaration(declaration) ||
        ts.isClassExpression(declaration),
    );
  const failures = [];
  const report = (node) => {
    const { line, character } = file.getLineAndCharacterOfPosition(
      node.getStart(file),
    );
    failures.push(
      `${line + 1}:${character + 1}: implicit browser Buffer near ${source.slice(Math.max(0, node.getStart(file) - 80), node.end + 80)}`,
    );
  };
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === "Buffer") {
      const parent = node.parent;
      const propertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node) ||
        (ts.isImportSpecifier(parent) && parent.propertyName === node) ||
        (ts.isExportSpecifier(parent) &&
          parent.name === node &&
          !!parent.propertyName);
      if (!propertyName) {
        const symbol = ts.isShorthandPropertyAssignment(parent)
          ? checker.getShorthandAssignmentValueSymbol(parent)
          : checker.getSymbolAtLocation(node);
        if (!explicitlyBound(symbol)) report(node);
      }
    }
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const property = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isStringLiteralLike(node.argumentExpression)
          ? node.argumentExpression.text
          : null;
      if (
        property === "Buffer" &&
        ts.isIdentifier(node.expression) &&
        ["globalThis", "window", "self", "global"].includes(
          node.expression.text,
        ) &&
        !explicitlyBound(checker.getSymbolAtLocation(node.expression))
      )
        report(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return failures;
}

export function browserBufferGuard() {
  return {
    name: "onepercent-browser-buffer-guard",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const [name, output] of Object.entries(bundle)) {
        const source =
          output.type === "chunk"
            ? output.code
            : name.endsWith(".js")
              ? String(output.source)
              : "";
        const errors = browserBufferReferences(source);
        if (errors.length) this.error(`${name}: ${errors.join("; ")}`);
      }
    },
  };
}

/** Compatibility for the pinned web3.js dependencies, never an entry shim. */
export function browserByteDependencies() {
  return {
    name: "onepercent-local-byte-dependencies",
    transform(source, id) {
      const path = id.split("?")[0].replaceAll("\\", "/");
      const dependency =
        /\/node_modules\/(?:borsh|buffer-layout|@anchor-lang\/(?:core|borsh)|@solana\/(?:buffer-layout|spl-token)|bigint-buffer)\/.*\.js$/;
      if (dependency.test(path) && browserBufferReferences(source).length) {
        // These pinned Solana dependency modules use Buffer methods in their
        // binary codecs. Import the installed package only in affected modules.
        // The trailing slash selects the package, never an external Node builtin.
        const file = ts.createSourceFile(
          path,
          source,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.JS,
        );
        const binding = ts.isExternalModule(file)
          ? 'import { Buffer } from "buffer/";\n'
          : '"use strict";\nconst { Buffer } = require("buffer/");\n';
        return {
          code: binding + source,
          map: null,
        };
      }
      if (
        /\/node_modules\/bn\.js\/lib\/bn\.js$/.test(path) &&
        source.includes("window.Buffer")
      ) {
        // bn.js already imports buffer as its fallback. Always use that same
        // local implementation instead of consulting an optional window shim.
        return {
          code: source.replaceAll("window.Buffer", 'require("buffer/").Buffer'),
          map: null,
        };
      }
      return null;
    },
  };
}
