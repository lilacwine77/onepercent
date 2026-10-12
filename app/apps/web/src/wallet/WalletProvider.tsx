import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { getWallets } from "@wallet-standard/app";
import { WEB } from "@onepercent/config/web";
import { short, t } from "@onepercent/copy/initial";
import { useConfig } from "../data/config";
import { invalidateWalletResources } from "../data/resource";
import { beacon } from "../analytics/client";
import { supportsWallet, type SupportedWallet } from "./capabilities";
import { WalletSession } from "./session";
import { environment } from "./environment";
import { walletLinks } from "./deeplinks";
import { storedReferral } from "../data/referral";
const WalletContext = createContext<{
  session: WalletSession;
  wallets: SupportedWallet[];
  detected: boolean;
  open(): void;
} | null>(null);
export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("WalletProvider missing");
  return {
    ...value,
    ...useSyncExternalStore(value.session.subscribe, value.session.snapshot),
  };
}
export function WalletProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const cluster =
    config.data?.cluster === "mainnet"
      ? "mainnet"
      : config.data
        ? "devnet"
        : import.meta.env.VITE_CLUSTER === "mainnet"
          ? "mainnet"
          : "devnet";
  const session = useMemo(
    () => new WalletSession(cluster, invalidateWalletResources),
    [],
  );
  const [wallets, setWallets] = useState<SupportedWallet[]>([]);
  const [detected, setDetected] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    session.setCluster(cluster);
  }, [session, cluster]);
  useEffect(() => {
    const registry = getWallets();
    const refresh = () => setWallets(registry.get().filter(supportsWallet));
    refresh();
    const offRegister = registry.on("register", refresh);
    const offUnregister = registry.on("unregister", refresh);
    const timer = setTimeout(() => {
      setDetected(true);
      let name: string | null = null;
      try {
        name = localStorage.getItem("onepercent.wallet");
      } catch {
        /* Optional preference. */
      }
      const wallet = registry
        .get()
        .filter(supportsWallet)
        .find((item) => item.name === name);
      // A wallet the user already connected (or is connecting) by hand keeps
      // its session: a silent reconnect would bump the generation and reset
      // every wallet-keyed view, such as an open Rip preview.
      const current = session.snapshot();
      if (wallet && !current.wallet && !current.connecting)
        void session.connect(wallet, true);
    }, WEB.walletDetectMs);
    const visible = () => {
      if (!document.hidden) session.recheck();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      offRegister();
      offUnregister();
      document.removeEventListener("visibilitychange", visible);
      session.dispose();
    };
  }, [session]);
  return (
    <WalletContext
      value={{ session, wallets, detected, open: () => setOpen(true) }}
    >
      {children}
      {open && <WalletPicker onClose={() => setOpen(false)} />}
    </WalletContext>
  );
}
/** One header control: Connect, or the connected wallet (its dialog switches or disconnects). */
export function WalletButton() {
  const wallet = useWallet();
  return (
    <div
      className={
        wallet.account ? "wallet-control is-connected" : "wallet-control"
      }
    >
      <button onClick={wallet.open}>
        {wallet.account
          ? t("wallet.connected", { short: short(wallet.account.address) })
          : t("wallet.connect")}
      </button>
      <span role="status">
        {wallet.message === "switched" && wallet.account
          ? t("wallet.switched", { short: short(wallet.account.address) })
          : wallet.message === "disconnected"
            ? t("wallet.disconnected")
            : null}
      </span>
    </div>
  );
}
function WalletPicker({ onClose }: { onClose(): void }) {
  const wallet = useWallet();
  const env = environment();
  const links = walletLinks(
    window.location.href,
    window.location.origin,
    storedReferral(),
  );
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    document.querySelector<HTMLDialogElement>("#wallet-picker")?.showModal();
    return () => previous?.focus();
  }, []);
  async function connect(item: SupportedWallet) {
    await wallet.session.connect(item);
    if (wallet.session.snapshot().account) {
      const name = item.name.toLowerCase();
      beacon({
        event: "wallet_connect",
        wallet:
          name === "phantom" || name === "solflare" || name === "backpack"
            ? name
            : "other",
        ...env,
      });
      onClose();
    }
  }
  return (
    <dialog
      id="wallet-picker"
      aria-labelledby="wallet-heading"
      onCancel={onClose}
    >
      <h2 id="wallet-heading">{t("wallet.pick")}</h2>
      <ul>
        {wallet.wallets.map((item) => (
          <li key={item.name}>
            <button
              disabled={wallet.connecting}
              onClick={() => void connect(item)}
            >
              {item.name}
            </button>
          </li>
        ))}
      </ul>
      {wallet.connecting && <p role="status">{t("wallet.connecting")}</p>}
      {wallet.detected && !wallet.wallets.length && <p>{t("wallet.none")}</p>}
      {wallet.detected &&
        !wallet.wallets.length &&
        (env.mobile || env.inApp) && (
          <>
            <p>{t(env.inApp ? "wallet.telegramHint" : "wallet.inAppHint")}</p>
            <a href={links.phantom}>{t("wallet.openPhantom")}</a>
            <a href={links.solflare}>{t("wallet.openSolflare")}</a>
          </>
        )}
      {wallet.message === "noAccount" && (
        <p role="alert">{t("wallet.noAccount")}</p>
      )}
      {wallet.message === "rejected" && (
        <p role="alert">{t("errors.walletNo")}</p>
      )}
      {wallet.account && (
        <button
          className="wallet-disconnect"
          onClick={() => {
            wallet.session.disconnect();
            onClose();
          }}
        >
          {t("wallet.disconnect")}
        </button>
      )}
      <p>{t("wallet.noSecrets")}</p>
      <button onClick={onClose}>{t("common.close")}</button>
    </dialog>
  );
}
