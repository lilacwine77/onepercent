import { GOVERNANCE } from "@onepercent/config";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import {
  multisigGovernance,
  multisigVault,
  upgradeAuthority,
} from "../chain/verification";

/** No UI claim is emitted on missing, malformed or mismatched on-chain evidence. */
export function trustModel(input: {
  programData: AccountInfo<Uint8Array> | null;
  adminMultisig: string | null;
  multisig: AccountInfo<Uint8Array> | null;
}): "sealed" | "timelocked" | null {
  if (!input.programData) return null;
  try {
    const authority = upgradeAuthority(input.programData);
    if (!authority) return "sealed";
    if (!input.adminMultisig || !input.multisig) return null;
    if (!authority.equals(multisigVault(new PublicKey(input.adminMultisig))))
      return null;
    const governance = multisigGovernance(input.multisig);
    return governance.threshold === GOVERNANCE.multisigThreshold &&
      governance.timeLock === GOVERNANCE.timelockSeconds &&
      governance.configAuthority.equals(PublicKey.default)
      ? "timelocked"
      : null;
  } catch {
    return null;
  }
}
