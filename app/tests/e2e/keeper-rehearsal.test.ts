import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey, type Connection } from "@solana/web3.js";

const state = vi.hoisted(() => ({
  historyAvailable: true,
  ownerValid: true,
  constructed: vi.fn(),
  history: vi.fn(),
  liveRead: vi.fn(),
}));
vi.mock("../../services/worker/src/keeper/fees/chain.js", () => ({
  FeeChainReader: class {
    private verified = false;
    constructor() {
      state.constructed();
    }
    async read() {
      state.liveRead();
      if (!this.verified) {
        state.history();
        if (!state.historyAvailable)
          throw new Error("fee_migration_history_unavailable");
        this.verified = true;
      }
      if (!state.ownerValid) throw new Error("fee_in_creator_changed");
      return { input: { claim: { kind: "pool" } } };
    }
    collection() {
      return [];
    }
    clearEphemeral() {
      /* Proof lifetime is separate from disposable signers. */
    }
  },
}));
import { createKeeperRehearsal } from "../../scripts/e2e-meteora-season.js";

function connection() {
  const value = {
    rpcEndpoint: "http://127.0.0.1:8899",
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: PublicKey.default.toBase58(),
    })),
    simulateTransaction: vi.fn(async () => ({ value: { err: null } })),
  };
  return { value, connection: value as unknown as Connection };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.historyAvailable = true;
  state.ownerValid = true;
});
describe("M4 keeper lifecycle across the account-only validator replay", () => {
  it("retains the verified migration instead of constructing a cold reader for AFTER_END", async () => {
    const initial = connection();
    const keeper = createKeeperRehearsal(initial.connection, PublicKey.default);
    await keeper(initial.connection);
    state.historyAvailable = false;
    const replay = connection();
    await keeper(replay.connection);
    expect(state.constructed).toHaveBeenCalledOnce();
    expect(state.history).toHaveBeenCalledOnce();
    expect(state.liveRead).toHaveBeenCalledTimes(2);
    expect(replay.value.simulateTransaction).toHaveBeenCalledOnce();
    await expect(
      createKeeperRehearsal(
        replay.connection,
        PublicKey.default,
      )(replay.connection),
    ).rejects.toThrow("fee_migration_history_unavailable");
  });
  it("still rejects changed live ownership after replay", async () => {
    const initial = connection();
    const keeper = createKeeperRehearsal(initial.connection, PublicKey.default);
    await keeper(initial.connection);
    state.historyAvailable = false;
    state.ownerValid = false;
    const replay = connection();
    await expect(keeper(replay.connection)).rejects.toThrow(
      "fee_in_creator_changed",
    );
    expect(replay.value.simulateTransaction).not.toHaveBeenCalled();
  });
});
