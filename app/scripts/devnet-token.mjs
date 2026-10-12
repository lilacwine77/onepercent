// Reuse the SDK's locked SPL dependency without adding a second package pin.
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../packages/sdk/package.json", import.meta.url),
);
export const {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");
