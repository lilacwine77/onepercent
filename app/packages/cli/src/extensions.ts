import type { decodeExtensionInstruction } from "./extension-instructions.js";
import type { PublicKey } from "@solana/web3.js";
import { OpsError } from "./input.js";
import type { OperationPlan, OpsRpc } from "./runtime.js";

export interface ExtensionContext {
  cluster: "devnet" | "mainnet";
  programId: PublicKey;
  args: readonly string[];
  rpc: Pick<OpsRpc, "getAccountInfo" | "getSlot" | "getAddressLookupTable">;
}
export type PreparedExtension =
  | { kind: "report"; ok: boolean; report: Record<string, unknown> }
  | {
      kind: "transaction";
      build(authority: PublicKey): Promise<OperationPlan>;
      /** Compare byte-decoded instructions with this module's parsed command. */
      verifyIntent?(
        decoded: readonly ReturnType<typeof decodeExtensionInstruction>[],
        args: readonly string[],
      ): boolean;
    };
export interface OpsExtension {
  prepare(context: ExtensionContext): Promise<PreparedExtension>;
}
export type ExtensionLoader = () => Promise<OpsExtension>;

/** Only the K1-owned local path is loadable. No signer or sender is exposed. */
export const loadHitlistExtension: ExtensionLoader = async () => {
  let module: unknown;
  try {
    module = await import(new URL("./hitlist/index.js", import.meta.url).href);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ERR_MODULE_NOT_FOUND"
    )
      throw new OpsError("hitlist_extension_unavailable_K1");
    throw new OpsError("hitlist_extension_load_failed");
  }
  if (
    !module ||
    typeof module !== "object" ||
    !("prepare" in module) ||
    typeof module.prepare !== "function"
  )
    throw new OpsError("invalid_hitlist_extension");
  return module as OpsExtension;
};
