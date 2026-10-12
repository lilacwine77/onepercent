import { TOKEN_1PCT } from "@onepercent/config";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { launchAddresses, type LaunchIdentity } from "./launch.js";

/** D32: the Proxima Deployer signs the exact transfer from its canonical ATA. */
export function proximaDepositInstructions(input: LaunchIdentity) {
  const a = launchAddresses(input);
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      input.wallet,
      a.vault,
      a.vaultAuth,
      input.mint,
      TOKEN_PROGRAM_ID,
    ),
    createTransferCheckedInstruction(
      a.launchAta,
      input.mint,
      a.vault,
      input.wallet,
      TOKEN_1PCT.devBuyAmount,
      TOKEN_1PCT.decimals,
      [],
      TOKEN_PROGRAM_ID,
    ),
  ];
}
