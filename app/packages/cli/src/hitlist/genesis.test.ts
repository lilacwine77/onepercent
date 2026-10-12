import { afterEach, expect, it, vi } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { HIT_LIST } from "@onepercent/config";

const mocks = vi.hoisted(() => ({
  query: vi.fn(async () => ({ rows: [] })),
  close: vi.fn(async () => {}),
  gather: vi.fn(async () => ({})),
  report: vi.fn(),
}));
vi.mock("@onepercent/db", () => ({
  createDatabase: () => ({ pool: { query: mocks.query }, close: mocks.close }),
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));
vi.mock("@onepercent/market", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadMarketEnv: () => ({}),
  createHttpClient: () => ({}),
  createJupiterLimiter: () => ({}),
  createJupiterSwapClient: () => ({}),
  createChainRpc: () => ({}),
  createExitCapClient: () => ({}),
  createValueClient: () => ({}),
  createJupiterTokensClient: () => ({}),
  createPythHermesClient: () => ({}),
  createMintSafetyClient: () => ({}),
  createHoldersClient: () => ({}),
  createListingEvidenceGatherer: () => ({ gatherMajorEvidence: mocks.gather }),
  evaluateMajor: mocks.report,
}));
import { prepare } from "./index.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it.each([
  ["mainnet", "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", true],
  ["devnet", "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", true],
  ["mainnet", "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", false],
  ["devnet", "EtWTRABZaYq6iMfeYKouRu166VU2xqa1", false],
  ["mainnet", "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", false],
  ["devnet", "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", false],
] as const)(
  "hitlist %s validates full RPC genesis %s",
  async (cluster, genesis, valid) => {
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test");
    vi.stubEnv("SOLANA_RPC_URL", "http://127.0.0.1:8899");
    vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(genesis);
    const mint = HIT_LIST.launchMajors[0]!.mint;
    const report = {
      mint,
      class: "MAJOR",
      pass: true,
      checkedAt: 1000,
      info: { capLamports: "1000000000" },
    };
    mocks.report.mockReturnValue(report);
    const slot = vi.fn(async () => 123);
    const run = prepare({
      cluster,
      programId: PublicKey.default,
      args: ["check", mint, "--class", "major"],
      rpc: {
        getSlot: slot,
        getAccountInfo: vi.fn(),
        getAddressLookupTable: vi.fn(),
      },
    });
    if (valid) {
      await expect(run).resolves.toMatchObject({ kind: "report", ok: true });
      expect(mocks.gather).toHaveBeenCalledExactlyOnceWith(
        mint,
        HIT_LIST.launchMajors[0]!.pythFeedId,
      );
      expect(mocks.query).toHaveBeenCalledOnce();
      expect(slot).toHaveBeenCalledOnce();
    } else {
      await expect(run).rejects.toThrow("hitlist_cluster_mismatch");
      expect(mocks.gather).not.toHaveBeenCalled();
      expect(mocks.query).not.toHaveBeenCalled();
      expect(slot).not.toHaveBeenCalled();
    }
    expect(mocks.close).toHaveBeenCalledOnce();
  },
);
