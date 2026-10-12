import { PublicKey, SystemProgram } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import type { ClusterDeployment } from "../deployment.js";
import { EXTERNAL_IDS } from "../constants.js";
import { dbcPoolPda, feeInPda, machinePda, userAta } from "../pda.js";
import { instruction } from "./encoding.js";
import { readonly, writable, writableSigner } from "./m2.js";

export type LaunchFeeKind = "curve" | "pool" | "surplus";

interface ClaimLaunchFeesCommon {
  payer: PublicKey;
  mint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
}
export type ClaimLaunchFeesInput = ClaimLaunchFeesCommon &
  (
    | { kind: "curve" | "surplus" }
    | {
        kind: "pool";
        pool: PublicKey;
        position: PublicKey;
        positionNftAccount: PublicKey;
      }
  );

/**
 * Fixed 19-slot ABI. DBC kinds use program-ID sentinels for the
 * position slots; Surplus also omits the base destination. All destinations and programs are derived, never caller set.
 * Curve requests zero base and the full quote accrual. Surplus is quote only.
 */
export function claimLaunchFeesIx(
  deployment: ClusterDeployment,
  input: ClaimLaunchFeesInput,
) {
  const programId = deployment.programId;
  const dbcConfig = new PublicKey(deployment.meteora.dbcConfig);
  const feeIn = feeInPda(programId)[0];
  const venue =
    input.kind === "pool"
      ? EXTERNAL_IDS.meteoraDammV2
      : EXTERNAL_IDS.meteoraDbc;
  const authority = (seed: string) =>
    PublicKey.findProgramAddressSync(
      [new TextEncoder().encode(seed)],
      venue,
    )[0];
  return instruction(
    programId,
    "claim_launch_fees",
    {
      kind:
        input.kind === "curve"
          ? { Curve: {} }
          : input.kind === "pool"
            ? { Pool: {} }
            : { Surplus: {} },
    },
    [
      writableSigner(input.payer),
      readonly(machinePda(programId)[0]),
      writable(feeIn),
      writable(userAta(feeIn, NATIVE_MINT, EXTERNAL_IDS.splToken)),
      writable(
        input.kind === "pool"
          ? input.pool
          : dbcPoolPda(input.mint, dbcConfig)[0],
      ),
      readonly(dbcConfig),
      readonly(input.mint),
      writable(input.baseVault),
      writable(input.quoteVault),
      readonly(NATIVE_MINT),
      readonly(authority("pool_authority")),
      readonly(authority("__event_authority")),
      readonly(venue),
      readonly(EXTERNAL_IDS.splToken),
      readonly(EXTERNAL_IDS.associatedToken),
      readonly(SystemProgram.programId),
      input.kind === "pool" ? writable(input.position) : readonly(programId),
      readonly(input.kind === "pool" ? input.positionNftAccount : programId),
      input.kind !== "surplus"
        ? writable(userAta(feeIn, input.mint, EXTERNAL_IDS.splToken))
        : readonly(programId),
    ],
  );
}
