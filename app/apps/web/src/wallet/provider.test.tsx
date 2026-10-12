import "../test/setup";
import { act, render, screen } from "@testing-library/react";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WEB } from "@onepercent/config/web";
import { WalletProvider, useWallet } from "./WalletProvider";
const config = vi.hoisted(() => ({
  data: undefined as { cluster: "mainnet" | "devnet" } | undefined,
}));
vi.mock("../data/config", () => ({ useConfig: () => config }));
vi.mock("../analytics/client", () => ({ beacon: vi.fn() }));
const cleanup: (() => void)[] = [];
function Probe() {
  const { account, generation, session, wallets } = useWallet();
  return (
    <>
      <output data-testid="account">{account?.address ?? "none"}</output>
      <output data-testid="generation">{generation}</output>
      <button onClick={() => void session.connect(wallets[0]!)}>connect</button>
    </>
  );
}
function fixture() {
  const accounts = ["mainnet", "devnet"].map(
    (cluster) =>
      ({
        address: cluster,
        publicKey: new Uint8Array(32),
        chains: [`solana:${cluster}`],
        features: ["solana:signTransaction"],
      }) as WalletAccount,
  );
  const connect = vi.fn(async () => ({ accounts }));
  const wallet = {
    version: "1.0.0",
    name: "Cluster fixture",
    icon: "data:image/png;base64,",
    chains: ["solana:mainnet", "solana:devnet"],
    accounts,
    features: {
      "standard:connect": { version: "1.0.0", connect },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": { version: "1.0.0", signTransaction: vi.fn() },
    },
  } as Wallet;
  cleanup.push(getWallets().register(wallet));
  localStorage.setItem("onepercent.wallet", wallet.name);
  return connect;
}
beforeEach(() => {
  config.data = undefined;
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubEnv("VITE_CLUSTER", "mainnet");
});
afterEach(() => {
  cleanup.splice(0).forEach((stop) => stop());
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
it("uses the deployment cluster while machine config is pending", async () => {
  const connect = fixture();
  render(
    <WalletProvider>
      <Probe />
    </WalletProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(WEB.walletDetectMs);
  });
  expect(connect).toHaveBeenCalledExactlyOnceWith({ silent: true });
  expect(screen.getByTestId("account")).toHaveTextContent("mainnet");
});
it("reselects from available accounts once config supplies its cluster", async () => {
  fixture();
  const mounted = render(
    <WalletProvider>
      <Probe />
    </WalletProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(WEB.walletDetectMs);
  });
  config.data = { cluster: "devnet" };
  mounted.rerender(
    <WalletProvider>
      <Probe />
    </WalletProvider>,
  );
  expect(screen.getByTestId("account")).toHaveTextContent("devnet");
});
it("keeps a session the user connected before wallet detection ends", async () => {
  const connect = fixture();
  render(
    <WalletProvider>
      <Probe />
    </WalletProvider>,
  );
  await act(async () => {
    screen.getByRole("button", { name: "connect" }).click();
    await vi.advanceTimersByTimeAsync(0);
  });
  const generation = screen.getByTestId("generation").textContent;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(WEB.walletDetectMs);
  });
  expect(connect).toHaveBeenCalledExactlyOnceWith(undefined);
  expect(screen.getByTestId("generation")).toHaveTextContent(generation!);
  expect(screen.getByTestId("account")).toHaveTextContent("mainnet");
});
