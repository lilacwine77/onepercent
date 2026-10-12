import { useEffect, useState, useSyncExternalStore } from "react";
import { XrayResultSchema } from "@onepercent/eligibility/xray-result";
import { amount } from "@onepercent/copy";
import { useWallet } from "../../wallet/WalletProvider";
import { demo } from "../store";

export const useDemo = () =>
  useSyncExternalStore(demo.subscribe, demo.get, demo.get);
export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** "42069000" → "42,069,000"; "12.5" keeps up to 4 decimals under 1,000. */
export function formatUi(value: string) {
  const [whole = "0", fraction = ""] = value.split(".");
  try {
    const head = BigInt(whole);
    const tail = head >= 1000n ? "" : fraction.slice(0, 4).replace(/0+$/, "");
    return tail ? `${amount(head)}.${tail}` : amount(head);
  } catch {
    return value;
  }
}

/** The wallet the demo flows run for: the connected one (the demo wallet or a real one). */
export function useDemoWallet() {
  const wallet = useWallet();
  const address = wallet.account?.address ?? null;
  useEffect(() => {
    if (address) demo.use(address);
  }, [address]);
  return { address, open: wallet.open };
}

export type SeedStatus = "ready" | "loading" | "needsXray" | "sample";
/**
 * The demo wallet's bags come from its real X-ray: read it once (the live API, or
 * the X-ray page's own scan), ask for an X-ray when the API wants a challenge,
 * and fall back to the sample bags when there is no X-ray to read.
 */
export function useSeed(address: string | null): SeedStatus {
  const state = useDemo();
  const [status, setStatus] = useState<SeedStatus>("ready");
  const pending =
    address !== null && state.address === address && state.source === null;
  useEffect(() => {
    if (!pending || !address) return;
    let cancelled = false;
    setStatus("loading");
    fetch(`/api/xray/${encodeURIComponent(address)}`)
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (cancelled) return;
        const parsed = response.ok ? XrayResultSchema.safeParse(body) : null;
        if (parsed?.success) {
          demo.seed(parsed.data);
          setStatus("ready");
        } else if (response.status === 403 || response.status === 429)
          setStatus("needsXray");
        else {
          demo.sample();
          setStatus("sample");
        }
      })
      .catch(() => {
        if (cancelled) return;
        demo.sample();
        setStatus("sample");
      });
    return () => {
      cancelled = true;
    };
  }, [pending, address]);
  if (!address) return "ready";
  if (state.address !== address) return "loading";
  if (state.source === "xray") return "ready";
  if (state.source === "sample") return "sample";
  return status === "needsXray" ? "needsXray" : "loading";
}
