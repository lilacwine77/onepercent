import { afterEach, expect, it, vi } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { fixture } from "./testing.js";

const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  close: vi.fn(async () => {}),
  load: vi.fn(),
  record: vi.fn(async () => "plan"),
}));
vi.mock("@onepercent/db", () => ({ createDatabase: mocks.database }));
vi.mock("@onepercent/cli/hitlist", () => ({
  listingClients: () => ({ swap: {} }),
}));
vi.mock("./chain.js", () => ({ StockChain: class {} }));
vi.mock("./runtime.js", () => ({
  loadStockState: mocks.load,
  collectQuotes: async () => [],
}));
vi.mock("./planner.js", () => ({ planStock: () => [] }));
vi.mock("./store.js", () => ({
  StockStore: class {
    record = mocks.record;
  },
  json: (value: unknown) =>
    JSON.stringify(value, (_, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
}));
import { runStockDryRun } from "./dry-run.js";

afterEach(() => vi.restoreAllMocks());

it.each([
  ["5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", true],
  ["5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", false],
  ["EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", false],
] as const)(
  "K1 dry-run validates the full RPC genesis %s",
  async (genesis, valid) => {
    vi.clearAllMocks();
    vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(genesis);
    const send = vi.spyOn(Connection.prototype, "sendRawTransaction");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fixture();
    const state = { ...f.state, buckets: new Map() };
    mocks.database.mockReturnValue({ pool: {}, close: mocks.close });
    mocks.load.mockResolvedValue({ state, now: f.now, slot: 1 });
    const run = runStockDryRun(["--cluster", "mainnet"], {
      RPC_URL: "http://127.0.0.1:8899",
      PROGRAM_ID: PublicKey.default.toBase58(),
      DATABASE_URL: "postgresql://localhost/test",
    });
    if (valid) {
      await run;
      expect(mocks.load).toHaveBeenCalledOnce();
      expect(mocks.record).toHaveBeenCalledWith(state, 1, f.now, [], false);
      expect(mocks.close).toHaveBeenCalledOnce();
      expect(output).toHaveBeenCalledOnce();
    } else {
      await expect(run).rejects.toThrow("cluster_mismatch");
      expect(mocks.database).not.toHaveBeenCalled();
      expect(mocks.load).not.toHaveBeenCalled();
    }
    expect(send).not.toHaveBeenCalled();
  },
);
