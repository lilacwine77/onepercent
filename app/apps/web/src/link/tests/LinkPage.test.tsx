import { onCleanup } from "./setup";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type {
  SolanaSignMessageInput,
  SolanaSignMessageMethod,
} from "@solana/wallet-standard-features";
import { describe, expect, it, vi } from "vitest";
import { LinkPage } from "../LinkPage";
import { COPY } from "../copy";
import { walletBrowserLinks } from "../links";
import type { LinkWallet } from "../wallets";

const nonce = "0123456789abcdef0123456789abcdef";
const address = "11111111111111111111111111111111";
const botUsername = "OnePercentBot";
const message = `onepercent.fun wants you to sign in with your Solana account:\n${address}\n\nLink this wallet to the 1% Machine Telegram bot. Read-only. No transaction, no fees.\n\nURI: https://onepercent.fun/link/${nonce}\nVersion: 1\nChain ID: mainnet\nNonce: ${nonce}\nIssued At: 2026-10-08T12:00:00.000Z\nExpiration Time: 2026-10-08T12:10:00.000Z`;
const signature = new Uint8Array(64).fill(19);
const account: WalletAccount = {
  address,
  publicKey: new Uint8Array(32),
  chains: ["solana:mainnet"],
  features: ["solana:signMessage"],
};

function fakeWallet() {
  const connect = vi.fn().mockResolvedValue({ accounts: [account] });
  const signMessage = vi
    .fn<
      (
        ...inputs: SolanaSignMessageInput[]
      ) => ReturnType<SolanaSignMessageMethod>
    >()
    .mockImplementation(async (input) => {
      if (!input) throw new Error("Missing sign input");
      return [{ signedMessage: input.message.slice(), signature }];
    });
  const wallet: LinkWallet = {
    version: "1.0.0",
    name: "Test Wallet",
    icon: "data:image/png;base64,AA==",
    chains: ["solana:mainnet"],
    accounts: [],
    features: {
      "standard:connect": { version: "1.0.0", connect },
      "solana:signMessage": { version: "1.1.0", signMessage },
    },
  };
  return { wallet, connect, signMessage };
}

function register(wallet: Wallet) {
  onCleanup(getWallets().register(wallet));
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubApi(
  options: {
    sessionStatus?: number;
    verifyStatus?: number;
    sessionBody?: unknown;
    verifyBody?: unknown;
  } = {},
) {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === `/api/link/session/${nonce}`) {
        return reply(
          options.sessionBody ?? {
            status: "open",
            expiresAt: "2026-10-08T12:10:00.000Z",
            botUsername,
            ...(url.searchParams.has("address") ? { message } : {}),
          },
          options.sessionStatus ?? 200,
        );
      }
      if (url.pathname === "/api/link/verify" && init?.method === "POST") {
        return reply(
          options.verifyBody ?? { ok: true, wallet: address, botUsername },
          options.verifyStatus ?? 200,
        );
      }
      throw new Error("Unexpected API request");
    });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

async function connectAndSign() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Connect Test Wallet" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: COPY.SIGN }));
}

function posts(fetch: ReturnType<typeof stubApi>) {
  return fetch.mock.calls.filter(([, init]) => init?.method === "POST");
}

describe("LinkPage", () => {
  it("connects, signs the exact session message and posts only the proof", async () => {
    const { wallet, connect, signMessage } = fakeWallet();
    register(wallet);
    vi.stubEnv("VITE_API_URL", "https://api.example");
    const fetch = stubApi();
    render(<LinkPage nonce={nonce} />);
    expect(screen.getByRole("status")).toHaveTextContent(COPY.LOADING);
    await connectAndSign();
    expect(await screen.findByText(COPY.SUCCESS)).toBeInTheDocument();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(signMessage).toHaveBeenCalledExactlyOnceWith({
      account,
      message: new TextEncoder().encode(message),
    });
    expect(posts(fetch)).toHaveLength(1);
    expect(JSON.parse(posts(fetch)[0]?.[1]?.body as string)).toEqual({
      nonce,
      address,
      signature: btoa(String.fromCharCode(...signature)),
    });
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      `${window.location.origin}/api/link/session/${nonce}`,
      `${window.location.origin}/api/link/session/${nonce}?address=${address}`,
      `${window.location.origin}/api/link/verify`,
    ]);
    for (const [, init] of fetch.mock.calls) {
      expect(init).toMatchObject({
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        redirect: "error",
      });
    }
    expect(screen.getByRole("link", { name: COPY.BACK })).toHaveAttribute(
      "href",
      `https://t.me/${botUsername}`,
    );
    expect(screen.getByRole("link", { name: COPY.BACK })).toHaveAttribute(
      "rel",
      "noreferrer",
    );
  });

  it("shows three wallet-browser links for the complete current URL with no wallet", async () => {
    stubApi();
    render(<LinkPage nonce={nonce} />);
    expect(await screen.findByText(COPY.NO_WALLET)).toBeInTheDocument();
    const links = walletBrowserLinks(window.location.href);
    expect(
      screen.getByRole("link", { name: COPY.OPEN_PHANTOM }),
    ).toHaveAttribute("href", links.phantom);
    expect(
      screen.getByRole("link", { name: COPY.OPEN_SOLFLARE }),
    ).toHaveAttribute("href", links.solflare);
    expect(
      screen.getByRole("link", { name: COPY.OPEN_BACKPACK }),
    ).toHaveAttribute("href", links.backpack);
    expect(screen.getAllByRole("link")).toHaveLength(3);
    for (const link of screen.getAllByRole("link"))
      expect(link).toHaveAttribute("rel", "noreferrer");
    expect(document.querySelector("img")).toBeNull();
  });

  it("discovers a wallet that registers after loading and removes unregistered wallets", async () => {
    stubApi();
    render(<LinkPage nonce={nonce} />);
    await screen.findByText(COPY.NO_WALLET);
    const { wallet } = fakeWallet();
    let unregister = () => {};
    act(() => {
      unregister = getWallets().register(wallet);
    });
    onCleanup(unregister);
    expect(
      screen.getByRole("button", { name: "Connect Test Wallet" }),
    ).toBeInTheDocument();
    act(() => unregister());
    expect(screen.getByText(COPY.NO_WALLET)).toBeInTheDocument();
  });

  it("filters wallets without a Solana chain or both required features", async () => {
    const { wallet } = fakeWallet();
    register({ ...wallet, name: "Other chain", chains: ["eip155:1"] });
    register({
      ...wallet,
      name: "No signer",
      features: { "standard:connect": wallet.features["standard:connect"] },
    });
    register({
      ...wallet,
      name: "No connect",
      features: { "solana:signMessage": wallet.features["solana:signMessage"] },
    });
    stubApi();
    render(<LinkPage nonce={nonce} />);
    expect(await screen.findByText(COPY.NO_WALLET)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("takes the first account that supports message signing", async () => {
    const { wallet, connect, signMessage } = fakeWallet();
    connect.mockResolvedValue({
      accounts: [{ ...account, address: "unsupported", features: [] }, account],
    });
    register(wallet);
    stubApi();
    render(<LinkPage nonce={nonce} />);
    await connectAndSign();
    await screen.findByText(COPY.SUCCESS);
    expect(signMessage.mock.calls[0]?.[0]?.account).toBe(account);
  });

  it.each(["connect", "sign"])(
    "handles %s rejection without a POST",
    async (stage) => {
      const { wallet, connect, signMessage } = fakeWallet();
      if (stage === "connect")
        connect.mockRejectedValue(new Error("User rejected"));
      else signMessage.mockRejectedValue(new Error("User rejected"));
      register(wallet);
      const fetch = stubApi();
      render(<LinkPage nonce={nonce} />);
      fireEvent.click(
        await screen.findByRole("button", { name: "Connect Test Wallet" }),
      );
      if (stage === "sign")
        fireEvent.click(await screen.findByRole("button", { name: COPY.SIGN }));
      expect(await screen.findByText(COPY.REJECTED)).toBeInTheDocument();
      expect(posts(fetch)).toHaveLength(0);
    },
  );

  it("handles an account without signing support without requesting its message", async () => {
    const { wallet, connect } = fakeWallet();
    connect.mockResolvedValue({ accounts: [{ ...account, features: [] }] });
    register(wallet);
    const fetch = stubApi();
    render(<LinkPage nonce={nonce} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect Test Wallet" }),
    );
    await screen.findByText(COPY.REJECTED);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([404, 410])(
    "shows EXPIRED for initial session HTTP %s",
    async (sessionStatus) => {
      const fetch = stubApi({ sessionStatus });
      render(<LinkPage nonce={nonce} />);
      expect(await screen.findByText(COPY.EXPIRED)).toBeInTheDocument();
      expect(posts(fetch)).toHaveLength(0);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  it.each([
    [410, COPY.EXPIRED],
    [401, COPY.MISMATCH],
  ] as const)("handles verify HTTP %s", async (verifyStatus, expected) => {
    register(fakeWallet().wallet);
    const fetch = stubApi({ verifyStatus });
    render(<LinkPage nonce={nonce} />);
    await connectAndSign();
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(posts(fetch)).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: COPY.SIGN }),
    ).not.toBeInTheDocument();
  });

  it.each(["different bytes", "mutated input", "short signature"])(
    "rejects %s without posting",
    async (kind) => {
      const { wallet, signMessage } = fakeWallet();
      signMessage.mockImplementation(async (input) => {
        if (!input) throw new Error("Missing input");
        if (kind === "mutated input") input.message[0] = 0;
        return [
          {
            signedMessage:
              kind === "different bytes"
                ? new TextEncoder().encode("other message")
                : input.message,
            signature:
              kind === "short signature" ? new Uint8Array(63) : signature,
          },
        ];
      });
      register(wallet);
      const fetch = stubApi();
      render(<LinkPage nonce={nonce} />);
      await connectAndSign();
      expect(await screen.findByText(COPY.MISMATCH)).toBeInTheDocument();
      expect(posts(fetch)).toHaveLength(0);
    },
  );

  it("shows OFFLINE for network failure and retries only the session on request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unavailable")));
    render(<LinkPage nonce={nonce} />);
    await screen.findByText(COPY.OFFLINE);
    const fetch = stubApi();
    fireEvent.click(screen.getByRole("button", { name: COPY.RETRY }));
    expect(await screen.findByText(COPY.NO_WALLET)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(posts(fetch)).toHaveLength(0);
  });

  it("does not blindly retry a verify with an unknown network outcome", async () => {
    register(fakeWallet().wallet);
    const fetch = stubApi();
    fetch.mockResolvedValueOnce(
      reply({
        status: "open",
        expiresAt: "2026-10-08T12:10:00.000Z",
        botUsername,
      }),
    );
    fetch.mockResolvedValueOnce(
      reply({
        status: "open",
        expiresAt: "2026-10-08T12:10:00.000Z",
        botUsername,
        message,
      }),
    );
    fetch.mockRejectedValueOnce(new Error("Lost response"));
    render(<LinkPage nonce={nonce} />);
    await connectAndSign();
    await screen.findByText(COPY.OFFLINE);
    expect(posts(fetch)).toHaveLength(1);
    fetch.mockResolvedValueOnce(reply({}, 410));
    fireEvent.click(screen.getByRole("button", { name: COPY.RETRY }));
    await screen.findByText(COPY.EXPIRED);
    expect(posts(fetch)).toHaveLength(1);
  });

  it("rejects malformed server data without exposing a supplied link", async () => {
    stubApi({
      sessionBody: {
        status: "open",
        expiresAt: "2026-10-08T12:10:00.000Z",
        botUsername: "../../untrusted",
      },
    });
    render(<LinkPage nonce={nonce} />);
    await screen.findByText(COPY.OFFLINE);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not read or write browser storage during a successful link", async () => {
    const storageMethods = [
      "getItem",
      "setItem",
      "removeItem",
      "clear",
      "key",
    ] as const;
    const storage = storageMethods.map((method) => {
      const spy = vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error("Browser storage is forbidden on the link page");
      });
      onCleanup(() => spy.mockRestore());
      return spy;
    });
    const { wallet } = fakeWallet();
    register(wallet);
    const fetch = stubApi();
    render(<LinkPage nonce={nonce} />);
    await connectAndSign();
    await screen.findByText(COPY.SUCCESS);
    for (const spy of storage) expect(spy).not.toHaveBeenCalled();
    expect(document.querySelector("img, iframe")).toBeNull();
    expect(
      fetch.mock.calls.every(
        ([url]) => new URL(String(url)).origin === "http://localhost:3000",
      ),
    ).toBe(true);
  });

  it("shows EXPIRED if the session expires while connecting", async () => {
    register(fakeWallet().wallet);
    const fetch = stubApi();
    fetch.mockResolvedValueOnce(
      reply({
        status: "open",
        expiresAt: "2026-10-08T12:10:00.000Z",
        botUsername,
      }),
    );
    fetch.mockResolvedValueOnce(reply({}, 410));
    render(<LinkPage nonce={nonce} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Connect Test Wallet" }),
    );
    await screen.findByText(COPY.EXPIRED);
    expect(posts(fetch)).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: COPY.SIGN }),
    ).not.toBeInTheDocument();
  });

  it("does not show success for a different wallet returned by verify", async () => {
    register(fakeWallet().wallet);
    const fetch = stubApi({
      verifyBody: { ok: true, wallet: "unexpected-wallet", botUsername },
    });
    render(<LinkPage nonce={nonce} />);
    await connectAndSign();
    await screen.findByText(COPY.OFFLINE);
    expect(posts(fetch)).toHaveLength(1);
    expect(
      screen.queryByRole("link", { name: COPY.BACK }),
    ).not.toBeInTheDocument();
  });

  it("discards a pending signature when a different nonce replaces the page", async () => {
    const { wallet, signMessage } = fakeWallet();
    let resolveSign:
      | ((outputs: Awaited<ReturnType<SolanaSignMessageMethod>>) => void)
      | undefined;
    signMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSign = resolve;
        }),
    );
    register(wallet);
    const fetch = stubApi();
    const page = render(<LinkPage nonce={nonce} />);
    await connectAndSign();
    const nextNonce = "fedcba9876543210fedcba9876543210";
    fetch.mockResolvedValueOnce(
      reply({
        status: "open",
        expiresAt: "2026-10-08T12:10:00.000Z",
        botUsername,
      }),
    );
    page.rerender(<LinkPage nonce={nextNonce} />);
    await screen.findByRole("button", { name: "Connect Test Wallet" });
    await act(async () => {
      resolveSign?.([
        { signedMessage: new TextEncoder().encode(message), signature },
      ]);
    });
    expect(posts(fetch)).toHaveLength(0);
    expect(screen.queryByText(COPY.SUCCESS)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: COPY.SIGN }),
    ).not.toBeInTheDocument();
    expect(fetch.mock.calls.at(-1)?.[0].toString()).toContain(nextNonce);
  });

  it("does not verify a signature after the page unmounts", async () => {
    const { wallet, signMessage } = fakeWallet();
    let resolveSign:
      | ((outputs: Awaited<ReturnType<SolanaSignMessageMethod>>) => void)
      | undefined;
    signMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSign = resolve;
        }),
    );
    register(wallet);
    const fetch = stubApi();
    const page = render(<LinkPage nonce={nonce} />);
    await connectAndSign();
    expect(screen.getByRole("status")).toHaveTextContent(COPY.SIGNING);
    page.unmount();
    await act(async () => {
      resolveSign?.([
        { signedMessage: new TextEncoder().encode(message), signature },
      ]);
    });
    expect(posts(fetch)).toHaveLength(0);
  });

  it("does not duplicate connection requests while waiting for the wallet", async () => {
    const { wallet, connect } = fakeWallet();
    let resolveConnect:
      ((value: { accounts: WalletAccount[] }) => void) | undefined;
    connect.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConnect = resolve;
        }),
    );
    register(wallet);
    stubApi();
    render(<LinkPage nonce={nonce} />);
    const button = await screen.findByRole("button", {
      name: "Connect Test Wallet",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => {
      resolveConnect?.({ accounts: [account] });
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: COPY.SIGN }),
      ).toBeInTheDocument(),
    );
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
