import * as namespace from "@anchor-lang/core";

// Node loads Anchor's CommonJS entry; browser bundlers select its ESM entry.
// CommonJS getter exports (notably BN) are absent from Node's synthetic named exports.
const anchor =
  (Reflect.get(namespace, "default") as typeof namespace | undefined) ??
  namespace;
export const {
  AnchorProvider,
  Program,
  BN,
  BorshInstructionCoder,
  BorshAccountsCoder,
  utils,
} = anchor;
