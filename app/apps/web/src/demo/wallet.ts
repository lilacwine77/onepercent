/**
 * PREVIEW builds only (wallet flow in demo mode): a Wallet Standard wallet that
 * watches a real address and never signs. Any address can be used (Demo panel).
 */
import { DEFAULT_DEMO_WALLET } from "./data";

const ADDRESS_KEY = "onepercent.demo.wallet";
export const isAddress = (value: string) =>
  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) && decode(value) !== null;
export function demoAddress() {
  try {
    const stored = localStorage.getItem(ADDRESS_KEY);
    if (stored && isAddress(stored)) return stored;
  } catch {
    /* The default wallet. */
  }
  return DEFAULT_DEMO_WALLET;
}
export function setDemoAddress(address: string) {
  try {
    localStorage.setItem(ADDRESS_KEY, address);
  } catch {
    /* This page only. */
  }
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Base58 to the 32-byte public key; null when it is not 32 bytes. */
function decode(address: string): Uint8Array | null {
  let value = 0n;
  for (const char of address)
    value = value * 58n + BigInt(ALPHABET.indexOf(char));
  const bytes = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(value & 255n);
    value >>= 8n;
  }
  const zeros = address.match(/^1*/)?.[0].length ?? 0;
  const leading = bytes.findIndex((b) => b !== 0);
  if (value !== 0n || (leading === -1 ? 32 : leading) !== zeros) return null;
  return bytes;
}
export const DEMO_WALLET_NAME = "Demo Wallet";
const ICON =
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="16" fill="#26062e"/><text x="16" y="21.5" fill="#d5a2f1" font-family="Georgia" font-weight="bold" font-size="14" text-anchor="middle">1%</text></svg>',
  );
export function registerDemoWallet(address: string) {
  const listeners = new Set<
    (event: { accounts: readonly unknown[] }) => void
  >();
  const account = {
    address,
    publicKey: decode(address)!,
    chains: ["solana:devnet", "solana:mainnet"],
    features: ["solana:signAndSendTransaction", "solana:signTransaction"],
  };
  let accounts: (typeof account)[] = [];
  const refuse = async () => {
    throw new Error("The demo never signs transactions.");
  };
  const wallet = {
    version: "1.0.0",
    name: DEMO_WALLET_NAME,
    icon: ICON,
    chains: ["solana:devnet", "solana:mainnet"],
    get accounts() {
      return accounts;
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        connect: async () => {
          accounts = [account];
          return { accounts };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        disconnect: async () => {
          accounts = [];
          listeners.forEach((listener) => listener({ accounts }));
        },
      },
      "standard:events": {
        version: "1.0.0",
        on: (
          _: string,
          listener: (event: { accounts: readonly unknown[] }) => void,
        ) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signAndSendTransaction: refuse,
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
        signTransaction: refuse,
      },
    },
  };
  const register = (api: { register(wallet: unknown): void }) =>
    api.register(wallet);
  window.dispatchEvent(
    new CustomEvent("wallet-standard:register-wallet", { detail: register }),
  );
  window.addEventListener("wallet-standard:app-ready", (event) =>
    register((event as CustomEvent).detail),
  );
}
