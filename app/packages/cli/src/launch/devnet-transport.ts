import { SERVICES, devnetTransportProfile } from "@onepercent/config";
import type { LaunchPolicy } from "./landing.js";

export { DEVNET_RPC_PROFILE, devnetTransportProfile } from "@onepercent/config";

export function devnetLaunchPolicy(cluster: string): LaunchPolicy {
  const profile = devnetTransportProfile(cluster);
  return {
    landing: {
      cuMarginBps: SERVICES.landing.cuMarginBps,
      tipLamports: profile.tipLamports,
      maxComputeUnitPriceMicroLamports:
        profile.maxComputeUnitPriceMicroLamports,
    },
    keeper: SERVICES.keeper,
  };
}

/** Sample once for each newly signed transaction; persisted retries keep its price. */
export async function devnetPriorityInstructions(
  connection: Pick<
    import("@solana/web3.js").Connection,
    "getRecentPrioritizationFees"
  >,
  cluster: string,
  payer: import("@solana/web3.js").PublicKey,
  instructions: import("@solana/web3.js").TransactionInstruction[],
) {
  const profile = devnetTransportProfile(cluster);
  const { PublicKey, ComputeBudgetProgram } = await import("@solana/web3.js");
  const { launchPriorityPrice } = await import("./landing.js");
  const addresses = [
    ...new Set([
      payer.toBase58(),
      ...instructions.flatMap((ix) =>
        ix.keys
          .filter((key) => key.isWritable)
          .map((key) => key.pubkey.toBase58()),
      ),
    ]),
  ]
    .sort()
    .slice(0, 128);
  const samples = await connection.getRecentPrioritizationFees({
    lockedWritableAccounts: addresses.map((address) => new PublicKey(address)),
  });
  const microLamports = launchPriorityPrice(
    samples,
    profile.maxComputeUnitPriceMicroLamports,
  );
  return {
    microLamports,
    instructions: [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
      ...instructions,
    ],
  };
}
