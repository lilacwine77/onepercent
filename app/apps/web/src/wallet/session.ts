import type { WalletAccount } from "@wallet-standard/base";
import type { StandardDisconnectFeature } from "@wallet-standard/features";
import type { SupportedWallet } from "./capabilities";
export interface SessionState {
  wallet: SupportedWallet | null;
  account: WalletAccount | null;
  connecting: boolean;
  message: "switched" | "disconnected" | "noAccount" | "rejected" | null;
  generation: number;
}
export class WalletSession {
  private state: SessionState = {
    wallet: null,
    account: null,
    connecting: false,
    message: null,
    generation: 0,
  };
  private listeners = new Set<() => void>();
  private off?: () => void;
  private attempt = 0;
  constructor(
    private cluster: "mainnet" | "devnet",
    private readonly resetPlans: () => void = () => {},
  ) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: Partial<SessionState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  setCluster(cluster: "mainnet" | "devnet") {
    if (cluster !== this.cluster) {
      this.cluster = cluster;
      this.attempt++;
      const account =
        this.state.wallet?.accounts.find((item) =>
          item.chains.includes(`solana:${cluster}`),
        ) ?? null;
      this.resetPlans();
      this.publish({
        account,
        connecting: false,
        generation: this.state.generation + 1,
        message: account
          ? account.address === this.state.account?.address
            ? null
            : "switched"
          : this.state.account
            ? "noAccount"
            : null,
      });
    }
  }
  private change(accounts: readonly WalletAccount[]) {
    const account =
      accounts.find((item) => item.chains.includes(`solana:${this.cluster}`)) ??
      null;
    if (account?.address !== this.state.account?.address) {
      this.resetPlans();
      this.publish({
        account,
        generation: this.state.generation + 1,
        message: account ? "switched" : "disconnected",
      });
    }
  }
  async connect(wallet: SupportedWallet, silent = false) {
    const attempt = ++this.attempt;
    this.publish({ connecting: true, message: null });
    try {
      const result = await wallet.features["standard:connect"].connect(
        silent ? { silent: true } : undefined,
      );
      if (attempt !== this.attempt) return;
      const account =
        result.accounts.find((item) =>
          item.chains.includes(`solana:${this.cluster}`),
        ) ?? null;
      this.off?.();
      this.resetPlans();
      this.publish({
        wallet,
        account,
        message: !account && !silent ? "noAccount" : null,
        generation: this.state.generation + 1,
      });
      this.off = wallet.features["standard:events"].on(
        "change",
        ({ accounts }) => {
          if (accounts) this.change(accounts);
        },
      );
      if (account) {
        try {
          localStorage.setItem("onepercent.wallet", wallet.name);
        } catch {
          /* Optional preference. */
        }
      }
    } catch {
      if (attempt === this.attempt)
        this.publish({ message: silent ? null : "rejected" });
    } finally {
      if (attempt === this.attempt) this.publish({ connecting: false });
    }
  }
  recheck() {
    if (this.state.wallet) this.change(this.state.wallet.accounts);
  }
  disconnect() {
    this.attempt++;
    this.off?.();
    this.off = undefined;
    try {
      localStorage.removeItem("onepercent.wallet");
    } catch {
      /* Optional preference. */
    }
    const feature = this.state.wallet?.features["standard:disconnect"] as
      StandardDisconnectFeature["standard:disconnect"] | undefined;
    void feature?.disconnect().catch(() => {});
    this.resetPlans();
    this.publish({
      wallet: null,
      account: null,
      connecting: false,
      message: "disconnected",
      generation: this.state.generation + 1,
    });
  }
  dispose() {
    this.attempt++;
    this.off?.();
    this.off = undefined;
  }
}
