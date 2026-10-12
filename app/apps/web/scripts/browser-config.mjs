import { createRequire } from "node:module";
import { resolve } from "node:path";

const borshWeb3 = "\0onepercent:borsh-web3";
const bufferPath = createRequire(
  import.meta.resolve("@onepercent/sdk"),
).resolve("buffer/");
/** @returns {import("vite").Plugin} */
export function browserConfig() {
  let bufferImport = bufferPath;
  let browserRuntime = true;
  return {
    name: "onepercent-browser-config",
    enforce: "pre",
    configResolved(config) {
      browserRuntime = config.mode !== "test";
      // Resolve through the runner's root alias so literal percent signs in
      // the workspace path never become malformed Vite import URLs.
      bufferImport = createRequire(
        resolve(config.root, "node_modules/@onepercent/sdk/package.json"),
      ).resolve("buffer/");
    },
    resolveId(source, importer) {
      // Borsh's CommonJS import uses only PublicKey. An explicit peer facade
      // prevents that require from retaining the entire Web3 namespace.
      if (
        browserRuntime &&
        source === "@solana/web3.js" &&
        /\/node_modules\/@anchor-lang\/borsh\/dist\/index\.js$/.test(
          importer?.replaceAll("\\", "/") ?? "",
        )
      )
        return borshWeb3;
      return null;
    },
    load(source) {
      if (source === borshWeb3)
        return 'export { PublicKey } from "@solana/web3.js";';
      return null;
    },
    transform(code, source) {
      if (
        browserRuntime &&
        /\/(?:packages\/sdk|node_modules\/@onepercent\/sdk)\/(?:src|dist)\/anchor\.(?:ts|js)$/.test(
          source.replaceAll("\\", "/"),
        )
      )
        return {
          // Anchor's browser entry has real named exports. Its Node fallback
          // retains the entire namespace, including unused signing utilities.
          code: 'export { AnchorProvider, Program, BN, BorshInstructionCoder, BorshAccountsCoder, utils } from "@anchor-lang/core";',
          map: null,
        };
      // These imported X1 readers expect Node's Buffer. Bind the SDK's existing
      // pinned browser implementation locally, without changing X1 or globals.
      if (
        /\/(?:packages\/eligibility|node_modules\/@onepercent\/eligibility)\/(?:src|dist)\/(?:origin|raw|mint-safety|curve-cap)\.(?:ts|js)$/.test(
          source.replaceAll("\\", "/"),
        ) &&
        /\bBuffer\./.test(code) &&
        !/import[^;]*\bBuffer\b/.test(code)
      )
        return {
          code: `import { Buffer } from ${JSON.stringify(bufferImport)};\n${code}`,
          map: null,
        };
      return null;
    },
  };
}
