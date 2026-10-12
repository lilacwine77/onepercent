import { useEffect, useRef, useState } from "react";
import type { WalletAccount } from "@wallet-standard/base";
import { getLinkSession, LinkApiError, verifyLink } from "./api";
import { COPY } from "./copy";
import { walletBrowserLinks } from "./links";
import {
  bytesEqual,
  connectWallet,
  observeLinkWallets,
  signatureBase64,
  type LinkWallet,
} from "./wallets";
import "./link.css";

type Phase =
  | "loading"
  | "ready"
  | "waiting"
  | "success"
  | "rejected"
  | "mismatch"
  | "expired"
  | "offline";
type Connected = {
  wallet: LinkWallet;
  account: WalletAccount;
  message: string;
};

function apiErrorPhase(error: unknown): Phase {
  if (error instanceof LinkApiError) {
    if (error.status === 404 || error.status === 410) return "expired";
    if (error.status === 401) return "mismatch";
  }
  return "offline";
}

export function LinkPage({ nonce }: { nonce: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [wallets, setWallets] = useState<LinkWallet[]>([]);
  const [connected, setConnected] = useState<Connected | null>(null);
  const [bot, setBot] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const busy = useRef(false);

  useEffect(() => observeLinkWallets(setWallets), []);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    busy.current = true;
    setPhase("loading");
    setConnected(null);
    setBot(null);
    void getLinkSession(nonce, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setPhase("ready");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setPhase(apiErrorPhase(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) busy.current = false;
      });
    return () => controller.abort();
  }, [nonce, attempt]);

  async function connect(wallet: LinkWallet) {
    const controller = request.current;
    if (busy.current || !controller || controller.signal.aborted) return;
    busy.current = true;
    setPhase("waiting");
    setConnected(null);
    let account: WalletAccount;
    try {
      account = await connectWallet(wallet);
    } catch {
      if (!controller.signal.aborted) {
        setPhase("rejected");
        busy.current = false;
      }
      return;
    }
    if (controller.signal.aborted) return;
    try {
      const session = await getLinkSession(
        nonce,
        controller.signal,
        account.address,
      );
      if (controller.signal.aborted) return;
      if (!session.message) throw new LinkApiError(502);
      setConnected({ wallet, account, message: session.message });
      setPhase("ready");
    } catch (error) {
      if (!controller.signal.aborted) setPhase(apiErrorPhase(error));
    } finally {
      if (!controller.signal.aborted) busy.current = false;
    }
  }

  async function sign() {
    const controller = request.current;
    if (!connected || busy.current || !controller || controller.signal.aborted)
      return;
    busy.current = true;
    setPhase("waiting");
    const message = new TextEncoder().encode(connected.message);
    let signature: string;
    try {
      const [output] = await connected.wallet.features[
        "solana:signMessage"
      ].signMessage({
        account: connected.account,
        message: message.slice(),
      });
      if (controller.signal.aborted) return;
      if (
        !output ||
        !bytesEqual(output.signedMessage, message) ||
        output.signature.length !== 64
      ) {
        setPhase("mismatch");
        busy.current = false;
        return;
      }
      signature = signatureBase64(output.signature);
    } catch {
      if (!controller.signal.aborted) {
        setPhase("rejected");
        busy.current = false;
      }
      return;
    }
    try {
      const result = await verifyLink(
        { nonce, address: connected.account.address, signature },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setBot(result.botUsername);
      setConnected(null);
      setPhase("success");
    } catch (error) {
      if (!controller.signal.aborted) setPhase(apiErrorPhase(error));
    } finally {
      if (!controller.signal.aborted) busy.current = false;
    }
  }

  const canConnect = phase === "ready" || phase === "rejected";
  const status = {
    loading: COPY.LOADING,
    waiting: COPY.SIGNING,
    success: COPY.SUCCESS,
    rejected: COPY.REJECTED,
    mismatch: COPY.MISMATCH,
    expired: COPY.EXPIRED,
    offline: COPY.OFFLINE,
    ready: !connected && wallets.length === 0 ? COPY.NO_WALLET : "",
  }[phase];
  const links = walletBrowserLinks(window.location.href);

  return (
    <main className="link-page">
      <section className="link-content" aria-labelledby="link-title">
        <h1 id="link-title" className="link-title">
          {COPY.TITLE}
        </h1>
        <p className="link-sub">{COPY.SUB}</p>
        <p className="link-status" role="status" aria-live="polite">
          {status}
        </p>
        <div className="link-actions">
          {canConnect &&
            !connected &&
            wallets.map((wallet, index) => (
              <button
                className="link-button"
                key={`${wallet.name}-${index}`}
                onClick={() => void connect(wallet)}
              >
                {COPY.connect(wallet.name)}
              </button>
            ))}
          {canConnect && connected && (
            <button className="link-button" onClick={() => void sign()}>
              {COPY.SIGN}
            </button>
          )}
          {canConnect && !connected && wallets.length === 0 && (
            <>
              <a className="link-button" href={links.phantom} rel="noreferrer">
                {COPY.OPEN_PHANTOM}
              </a>
              <a className="link-button" href={links.solflare} rel="noreferrer">
                {COPY.OPEN_SOLFLARE}
              </a>
              <a className="link-button" href={links.backpack} rel="noreferrer">
                {COPY.OPEN_BACKPACK}
              </a>
            </>
          )}
          {phase === "offline" && (
            <button
              className="link-button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {COPY.RETRY}
            </button>
          )}
          {phase === "success" && bot && (
            <a
              className="link-button"
              href={`https://t.me/${bot}`}
              rel="noreferrer"
            >
              {COPY.BACK}
            </a>
          )}
        </div>
      </section>
    </main>
  );
}
