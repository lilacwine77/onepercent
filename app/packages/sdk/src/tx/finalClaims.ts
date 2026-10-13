import type { PublicKey } from "@solana/web3.js";
import { CU_LIMITS } from "@onepercent/config";
import {
  claimFinalSolIx,
  claimFinalTokensIx,
  startFinalPullIx,
  type ClaimFinalSolInput,
} from "../ix/finalPull.js";
import { myCardsTransaction } from "./binder.js";
import type { BuiltTransaction, TransactionOptions } from "./index.js";

export function buildStartFinalPullTransaction(
  programId: PublicKey,
  options: TransactionOptions,
): BuiltTransaction {
  return myCardsTransaction(
    options,
    [startFinalPullIx(programId)],
    CU_LIMITS.startFinalPull,
  );
}

export function buildClaimFinalSolTransaction(
  programId: PublicKey,
  options: TransactionOptions & Partial<ClaimFinalSolInput>,
): BuiltTransaction {
  return myCardsTransaction(
    options,
    [
      claimFinalSolIx(programId, {
        ...options,
        owner: options.owner ?? options.wallet,
      }),
    ],
    CU_LIMITS.claimFinalSol.x1,
  );
}

export function buildClaimFinalTokensTransaction(
  programId: PublicKey,
  options: TransactionOptions,
): BuiltTransaction {
  return myCardsTransaction(
    options,
    [claimFinalTokensIx(programId, { owner: options.wallet })],
    CU_LIMITS.claimFinalTokens,
  );
}

/** Both claims need only program accounts and the owner's signature, even for zero shares. */
export function buildFinalClaimsTransaction(
  programId: PublicKey,
  options: TransactionOptions & { sol?: boolean; tokens?: boolean },
): BuiltTransaction {
  const sol = options.sol !== false;
  const tokens = options.tokens !== false;
  if (!sol && !tokens)
    throw new RangeError("Select at least one Final Pull claim");
  return myCardsTransaction(
    options,
    [
      ...(sol ? [claimFinalSolIx(programId, { owner: options.wallet })] : []),
      ...(tokens
        ? [claimFinalTokensIx(programId, { owner: options.wallet })]
        : []),
    ],
    (sol ? CU_LIMITS.claimFinalSol.x1 : 0) +
      (tokens ? CU_LIMITS.claimFinalTokens : 0),
  );
}
