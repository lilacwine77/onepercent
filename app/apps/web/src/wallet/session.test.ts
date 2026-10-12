import "../test/setup";
import type { WalletAccount } from "@wallet-standard/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletSession } from "./session";
import {
  capabilities,
  supportsWallet,
  type SupportedWallet,
} from "./capabilities";
import { walletLinks } from "./deeplinks";
import { environment } from "./environment";

const account = (address: string, chain = "solana:devnet"): WalletAccount => ({
  address,
  publicKey: new Uint8Array(32),
  chains: [chain as "solana:devnet"],
  features: ["solana:signTransaction"],
});
function fixtureWallet(initial = [account("first")]) {
  let accounts: readonly WalletAccount[] = initial;
  const events = new Set<
    (event: { accounts?: readonly WalletAccount[] }) => void
  >();
  const connect = vi.fn(async () => ({
    accounts,
  }));
  const wallet = {
    version: "1.0.0",
    name: "Test wallet",
    icon: "data:image/png;base64,",
    chains: ["solana:devnet"],
    get accounts() {
      return accounts;
    },
    features: {
      "standard:connect": { version: "1.0.0", connect },
      "standard:events": {
        version: "1.0.0",
        on: (
          _event: string,
          listener: (event: { accounts?: readonly WalletAccount[] }) => void,
        ) => {
          events.add(listener);
          return () => events.delete(listener);
        },
      },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        signAndSendTransaction: vi.fn(async () => []),
      },
      "solana:signTransaction": {
        version: "1.0.0",
        signTransaction: vi.fn(async () => []),
      },
    },
  } as unknown as SupportedWallet;
  return {
    wallet,
    connect,
    change(next: WalletAccount[]) {
      accounts = next;
      for (const listener of events) listener({ accounts });
    },
    setAccounts(next: WalletAccount[]) {
      accounts = next;
    },
  };
}

describe("Wallet Standard session", () => {
  const sessions: WalletSession[] = [];
  function session(cluster: "devnet" | "mainnet" = "devnet", reset = vi.fn()) {
    const value = new WalletSession(cluster, reset);
    sessions.push(value);
    return value;
  }
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    for (const value of sessions.splice(0)) value.dispose();
    vi.restoreAllMocks();
  });

  it("silent reconnect never requests an interactive connection", async () => {
    const fixture = fixtureWallet();
    const value = session();
    await value.connect(fixture.wallet, true);
    expect(fixture.connect).toHaveBeenCalledExactlyOnceWith({ silent: true });
    expect(value.snapshot()).toMatchObject({
      account: { address: "first" },
      connecting: false,
      message: null,
    });
    expect(localStorage.getItem("onepercent.wallet")).toBe("Test wallet");
  });
  it("an empty silent response stays disconnected without an error", async () => {
    const fixture = fixtureWallet([]);
    const value = session();
    await value.connect(fixture.wallet, true);
    expect(value.snapshot()).toMatchObject({
      account: null,
      message: null,
      connecting: false,
    });
    expect(localStorage.getItem("onepercent.wallet")).toBeNull();
  });
  it("selects only a cluster-compatible account and reports no account on explicit connect", async () => {
    const fixture = fixtureWallet([
      account("wrong", "solana:mainnet"),
      account("right"),
    ]);
    const value = session();
    await value.connect(fixture.wallet);
    expect(value.snapshot().account?.address).toBe("right");
    const mainOnly = fixtureWallet([account("wrong", "solana:mainnet")]);
    await value.connect(mainOnly.wallet);
    expect(value.snapshot()).toMatchObject({
      account: null,
      message: "noAccount",
    });
  });
  it("resets plans on account changes, ignores duplicate events and rechecks hidden-tab changes", async () => {
    const fixture = fixtureWallet();
    const reset = vi.fn();
    const value = session("devnet", reset);
    await value.connect(fixture.wallet);
    reset.mockClear();
    fixture.change([account("second")]);
    expect(value.snapshot()).toMatchObject({
      account: { address: "second" },
      message: "switched",
    });
    expect(reset).toHaveBeenCalledTimes(1);
    fixture.change([account("second")]);
    expect(reset).toHaveBeenCalledTimes(1);
    fixture.setAccounts([account("third")]);
    value.recheck();
    expect(value.snapshot().account?.address).toBe("third");
    fixture.change([]);
    expect(value.snapshot()).toMatchObject({
      account: null,
      message: "disconnected",
    });
  });
  it("disconnect forgets the wallet and ignores a late connection result", async () => {
    const fixture = fixtureWallet();
    let finish!: (value: { accounts: readonly WalletAccount[] }) => void;
    fixture.connect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const value = session();
    const pending = value.connect(fixture.wallet);
    value.disconnect();
    finish({ accounts: [account("late")] });
    await pending;
    expect(value.snapshot()).toMatchObject({
      account: null,
      wallet: null,
      connecting: false,
    });
    expect(localStorage.getItem("onepercent.wallet")).toBeNull();
  });
  it("cluster changes cancel the pending connection without leaving a busy picker", async () => {
    const fixture = fixtureWallet();
    let finish!: (value: { accounts: readonly WalletAccount[] }) => void;
    fixture.connect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const value = session();
    const pending = value.connect(fixture.wallet);
    value.setCluster("mainnet");
    finish({ accounts: [account("late")] });
    await pending;
    expect(value.snapshot()).toMatchObject({
      account: null,
      connecting: false,
    });
  });
  it("blocked storage does not prevent connection or disconnect", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    const value = session();
    await value.connect(fixtureWallet().wallet);
    expect(value.snapshot().account).not.toBeNull();
    expect(() => value.disconnect()).not.toThrow();
  });
});

describe("wallet discovery, approval counts and mobile links", () => {
  it("requires Solana, connect, events and a transaction feature", () => {
    const { wallet } = fixtureWallet();
    expect(supportsWallet(wallet)).toBe(true);
    expect(supportsWallet({ ...wallet, chains: ["eip155:1"] })).toBe(false);
    const features: Record<string, unknown> = { ...wallet.features };
    delete features["standard:events"];
    expect(supportsWallet({ ...wallet, features })).toBe(false);
  });
  it("uses conservative per-transaction approvals without S5 batch evidence", () => {
    const { wallet } = fixtureWallet();
    for (const transactions of [1, 2, 8, 9, 16])
      expect(capabilities(wallet, transactions, 8)).toEqual({
        path: "signAndSend",
        batchSize: 1,
        approvals: transactions,
      });
    const signOnly = {
      ...wallet,
      features: {
        ...wallet.features,
        "solana:signAndSendTransaction": undefined,
      },
    } as SupportedWallet;
    expect(capabilities(signOnly, 9, 8)).toEqual({
      path: "sign",
      batchSize: 8,
      approvals: 2,
    });
  });
  it("pins both universal links and preserves the referral and hash", () => {
    const target = "https://onepercent.fun/x/abc?ref=friend_01#card";
    expect(walletLinks(target, "https://onepercent.fun")).toEqual({
      phantom:
        "https://phantom.com/ul/browse/https%3A%2F%2Fonepercent.fun%2Fx%2Fabc%3Fref%3Dfriend_01%23card?ref=https%3A%2F%2Fonepercent.fun",
      solflare:
        "https://solflare.com/ul/v1/browse/https%3A%2F%2Fonepercent.fun%2Fx%2Fabc%3Fref%3Dfriend_01%23card?ref=https%3A%2F%2Fonepercent.fun",
    });
  });
  it("recognizes mobile browsers and either Telegram signal", () => {
    expect(environment("Mozilla iPhone", false)).toEqual({
      mobile: true,
      inApp: false,
    });
    expect(environment("Mozilla Telegram", false)).toEqual({
      mobile: false,
      inApp: true,
    });
    expect(environment("Mozilla", true)).toEqual({
      mobile: false,
      inApp: true,
    });
    expect(environment("Mozilla Macintosh", false)).toEqual({
      mobile: false,
      inApp: false,
    });
  });
});

it("reselects an already available account when the configured cluster arrives", async () => {
  const fixture = fixtureWallet([
    account("devnet"),
    account("mainnet", "solana:mainnet"),
  ]);
  const reset = vi.fn();
  const value = new WalletSession("devnet", reset);
  await value.connect(fixture.wallet);
  reset.mockClear();
  value.setCluster("mainnet");
  expect(value.snapshot()).toMatchObject({
    account: { address: "mainnet" },
    connecting: false,
    message: "switched",
  });
  expect(reset).toHaveBeenCalledTimes(1);
  value.dispose();
});
it("invalidates plans on cluster changes even when one account supports both", async () => {
  const both = {
    ...account("both"),
    chains: ["solana:devnet", "solana:mainnet"],
  } as WalletAccount;
  const fixture = fixtureWallet([both]);
  const reset = vi.fn();
  const value = new WalletSession("devnet", reset);
  await value.connect(fixture.wallet);
  const generation = value.snapshot().generation;
  reset.mockClear();
  value.setCluster("mainnet");
  expect(value.snapshot()).toMatchObject({
    account: { address: "both" },
    message: null,
    generation: generation + 1,
  });
  expect(reset).toHaveBeenCalledTimes(1);
  value.dispose();
});
it("detects an iPad using its desktop user agent and touch capability", () => {
  expect(
    environment("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", false, 5)
      .mobile,
  ).toBe(true);
  expect(
    environment("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", false, 0)
      .mobile,
  ).toBe(false);
});
it("preserves the first stored referral across wallet links and later incoming codes", () => {
  const origin = "https://onepercent.fun";
  const restored = `${origin}/cards?ref=first_alias#cards`;
  expect(
    walletLinks(`${origin}/cards#cards`, origin, "first_alias").phantom,
  ).toContain(encodeURIComponent(restored));
  const current = `${origin}/x?ref=current_alias`;
  expect(walletLinks(current, origin, "first_alias").solflare).toContain(
    encodeURIComponent(`${origin}/x?ref=first_alias`),
  );
  expect(walletLinks(current, origin, "invalid ref").solflare).toContain(
    encodeURIComponent(current),
  );
});

it("pins the appended Backpack builder with referral, hash and origin encoding", async () => {
  const { backpackLink } = await import("./deeplinks");
  const origin = "https://onepercent.fun";
  expect(backpackLink("/rip?edition=after_hours&n=5#pack", origin)).toBe(
    "https://backpack.app/ul/v1/browse/https%3A%2F%2Fonepercent.fun%2Frip%3Fedition%3Dafter_hours%26n%3D5%23pack?ref=https%3A%2F%2Fonepercent.fun",
  );
  expect(backpackLink("/cards?ref=later_ref#cards", origin, "first_ref")).toBe(
    "https://backpack.app/ul/v1/browse/https%3A%2F%2Fonepercent.fun%2Fcards%3Fref%3Dfirst_ref%23cards?ref=https%3A%2F%2Fonepercent.fun",
  );
  expect(backpackLink("/cards?ref=later_ref", origin, "invalid ref")).toBe(
    "https://backpack.app/ul/v1/browse/https%3A%2F%2Fonepercent.fun%2Fcards%3Fref%3Dlater_ref?ref=https%3A%2F%2Fonepercent.fun",
  );
  expect(backpackLink("/feed", `${origin}/nested`)).toBe(
    "https://backpack.app/ul/v1/browse/https%3A%2F%2Fonepercent.fun%2Ffeed?ref=https%3A%2F%2Fonepercent.fun",
  );
});
