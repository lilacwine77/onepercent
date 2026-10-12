import { WEB } from "@onepercent/config/web";
import type { Connection } from "@solana/web3.js";
import type { Blockhash, ConfirmationResult } from "./progress";
export async function confirm(
  rpc: Connection,
  signature: string,
  validity: Blockhash,
): Promise<ConfirmationResult> {
  const readStatus = async () => {
    const result = await rpc.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    if (result.value.length !== 1)
      throw new Error("Incomplete signature status response");
    return result.value[0];
  };
  const outcome = (
    status: Awaited<ReturnType<typeof readStatus>>,
  ): ConfirmationResult | null => {
    if (status?.confirmationStatus === "finalized")
      return status.err ? { status: "failed", error: status.err } : "confirmed";
    // A confirmed error may disappear on a fork. It cannot authorize a rebuild.
    if (status?.confirmationStatus === "confirmed" && !status.err)
      return "confirmed" as const;
    return null;
  };
  for (;;) {
    const first = outcome(await readStatus());
    if (first) return first;
    const height = await rpc.getBlockHeight("finalized");
    if (!Number.isSafeInteger(height) || height < 0)
      throw new Error("Invalid block height");
    if (height > validity.lastValidBlockHeight) {
      // The previous read may have raced a landing. Recheck history after the
      // finalized expiry barrier before allowing reconciliation and a rebuild.
      const status = await readStatus();
      const final = outcome(status);
      if (final) return final;
      if (status == null) return "expired";
    }
    await new Promise((resolve) => setTimeout(resolve, WEB.confirmPollMs));
  }
}
