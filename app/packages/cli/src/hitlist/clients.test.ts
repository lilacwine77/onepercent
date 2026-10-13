import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rpc = {};
  const push = {};
  const hermes = {};
  const history = {};
  return {
    rpc,
    push,
    hermes,
    history,
    createChainRpc: vi.fn(() => rpc),
    createPythPushClient: vi.fn(() => push),
    createPythHermesClient: vi.fn(() => hermes),
    createListingHistoryClient: vi.fn(() => history),
    createListingEvidenceGatherer: vi.fn(() => ({})),
    createExitCapClient: vi.fn(() => ({})),
    createMintSafetyClient: vi.fn(() => ({})),
    createHoldersClient: vi.fn(() => ({})),
  };
});
vi.mock("@onepercent/market", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createHttpClient: () => ({}),
  createJupiterLimiter: () => ({}),
  createJupiterSwapClient: () => ({}),
  createValueClient: () => ({}),
  createJupiterTokensClient: () => ({}),
  createChainRpc: mocks.createChainRpc,
  createPythPushClient: mocks.createPythPushClient,
  createPythHermesClient: mocks.createPythHermesClient,
  createListingHistoryClient: mocks.createListingHistoryClient,
  createListingEvidenceGatherer: mocks.createListingEvidenceGatherer,
  createExitCapClient: mocks.createExitCapClient,
  createMintSafetyClient: mocks.createMintSafetyClient,
  createHoldersClient: mocks.createHoldersClient,
}));
import { listingClients } from "./index.js";

beforeEach(() => vi.clearAllMocks());

it.each([undefined, "", "   "])(
  "uses the same evidence RPC for push feeds without a Hermes key (%s)",
  (pythKey) => {
    listingClients("https://rpc.example", {
      PYTH_HERMES_API_KEY: pythKey,
      JUPITER_API_KEY: "jupiter-test-key",
      SOLANA_RPC_URL: "https://ignored.example",
    });

    expect(mocks.createChainRpc).toHaveBeenCalledExactlyOnceWith({
      fetch,
      env: expect.objectContaining({
        solanaRpcUrl: "https://rpc.example",
        jupiterApiKey: "jupiter-test-key",
      }),
    });
    expect(mocks.createPythPushClient).toHaveBeenCalledExactlyOnceWith({
      rpc: mocks.rpc,
    });
    expect(mocks.createPythHermesClient).not.toHaveBeenCalled();
    for (const client of [
      mocks.createExitCapClient,
      mocks.createMintSafetyClient,
      mocks.createHoldersClient,
    ]) {
      expect(client).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ rpc: mocks.rpc }),
      );
    }
    expect(mocks.createListingEvidenceGatherer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        pyth: mocks.push,
        pythSource: "Pyth push feed on-chain (shard 0)",
        history: mocks.history,
      }),
    );
    expect(mocks.createListingHistoryClient).toHaveBeenCalledExactlyOnceWith({
      fetch,
      env: expect.objectContaining({ solanaRpcUrl: "https://rpc.example" }),
    });
  },
);

it("keeps Hermes latest prices with a key and public daily history", () => {
  listingClients("https://rpc.example", {
    PYTH_HERMES_API_KEY: "hermes-test-key",
    JUPITER_API_KEY: "jupiter-test-key",
  });

  expect(mocks.createPythPushClient).not.toHaveBeenCalled();
  expect(mocks.createPythHermesClient).toHaveBeenCalledExactlyOnceWith({
    fetch,
    env: expect.objectContaining({ pythHermesApiKey: "hermes-test-key" }),
  });
  expect(mocks.createListingHistoryClient).toHaveBeenCalledOnce();
  expect(mocks.createListingEvidenceGatherer).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      pyth: mocks.hermes,
      pythSource: "Pyth Hermes",
      history: mocks.history,
    }),
  );
});
