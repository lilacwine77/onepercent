import type { Wallet } from "@wallet-standard/base";
import type {
  StandardConnectFeature,
  StandardEventsFeature,
} from "@wallet-standard/features";
import type {
  SolanaSignAndSendTransactionFeature,
  SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
export type SupportedWallet = Wallet & {
  features: StandardConnectFeature &
    StandardEventsFeature &
    Partial<SolanaSignAndSendTransactionFeature & SolanaSignTransactionFeature>;
};
export function supportsWallet(wallet: Wallet): wallet is SupportedWallet {
  return (
    wallet.chains.some((chain) => chain.startsWith("solana:")) &&
    "standard:connect" in wallet.features &&
    "standard:events" in wallet.features &&
    ("solana:signAndSendTransaction" in wallet.features ||
      "solana:signTransaction" in wallet.features)
  );
}
// No S5 wallet has recorded batch prompt evidence in this branch.
export function capabilities(
  wallet: SupportedWallet,
  transactions: number,
  txPerSignAll: number,
) {
  if (wallet.features["solana:signAndSendTransaction"])
    return {
      path: "signAndSend" as const,
      batchSize: 1,
      approvals: transactions,
    };
  return {
    path: "sign" as const,
    batchSize: txPerSignAll,
    approvals: Math.ceil(transactions / txPerSignAll),
  };
}
