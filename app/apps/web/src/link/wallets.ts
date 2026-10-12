import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type { StandardConnectFeature } from "@wallet-standard/features";
import type { SolanaSignMessageFeature } from "@solana/wallet-standard-features";

export type LinkWallet = Wallet & {
  readonly features: StandardConnectFeature & SolanaSignMessageFeature;
};

function isLinkWallet(wallet: Wallet): wallet is LinkWallet {
  const connect = wallet.features["standard:connect"];
  const sign = wallet.features["solana:signMessage"];
  return (
    wallet.chains.some((chain) => chain.startsWith("solana:")) &&
    typeof connect === "object" &&
    connect !== null &&
    "connect" in connect &&
    typeof connect.connect === "function" &&
    typeof sign === "object" &&
    sign !== null &&
    "signMessage" in sign &&
    typeof sign.signMessage === "function"
  );
}

export function observeLinkWallets(listener: (wallets: LinkWallet[]) => void) {
  const registry = getWallets();
  const update = () => listener(registry.get().filter(isLinkWallet));
  const unregister = registry.on("register", update);
  const unremove = registry.on("unregister", update);
  update();
  return () => {
    unregister();
    unremove();
  };
}

export async function connectWallet(
  wallet: LinkWallet,
): Promise<WalletAccount> {
  const { accounts } = await wallet.features["standard:connect"].connect();
  const account = accounts.find((candidate) =>
    candidate.features.includes("solana:signMessage"),
  );
  if (!account) throw new Error("Unsupported wallet account");
  return account;
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function signatureBase64(signature: Uint8Array): string {
  return btoa(String.fromCharCode(...signature));
}
