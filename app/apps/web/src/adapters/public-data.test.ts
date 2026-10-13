// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Buffer } from "buffer";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import {
  GOVERNANCE,
  PACK_EDITIONS,
  PROGRAM_IDS,
  TOKEN_1PCT,
  SEASON,
} from "@onepercent/config";
import { configLayout, machineLayout } from "@onepercent/sdk/layouts";
import {
  canonicalOddsTable,
  fairnessEdition,
  oddsRows,
  oddsTableHash,
} from "./odds";
import { onePctLiveIndex, specialLiveFlags, tokenModel } from "./token";
import { trustModel } from "./trust";
import { LOADER, multisigVault } from "../chain/verification";
import { tvEvent } from "./tv-events";
import { liveModel } from "./live";
import { PHASE } from "@onepercent/sdk/constants";
import type { MachineResponse } from "@onepercent/sdk/api";
import { accounts, getVaultPda } from "@sqds/multisig";

describe("fairness from frozen parameters", () => {
  it("matches every issued non-holder table and transfers absent special widths to Silver", async () => {
    const golden = [
      [100000, 250000, 2500000, 20000000, 113925000, 863225000],
      [250000, 625000, 2500000, 20000000, 114187500, 862437500],
      [500000, 1250000, 2500000, 20000000, 114625000, 861125000],
      [1000000, 2500000, 2500000, 20000000, 115500000, 858500000],
    ];
    for (const edition of PACK_EDITIONS) {
      expect(oddsRows(edition.index, 5).map(({ ppb }) => ppb)).toEqual(
        golden[edition.index],
      );
      expect(
        oddsRows(edition.index, 0).reduce((n, row) => n + row.ppb, 0),
      ).toBe(1e9);
      expect(
        oddsRows(edition.index, 0)
          .filter((row) => row.transferredToSilver)
          .map(({ id }) => id),
      ).toEqual(["one_pct", "jackpot"]);
      expect(oddsRows(edition.index, 5, true)[0]!.ppb).toBe(
        golden[edition.index]![0]! * 1.5,
      );
      expect(fairnessEdition(edition.index, 5, false).holderRows).toBeNull();
      expect(
        fairnessEdition(edition.index, 5, false).stockExpectedNumerator,
      ).toBe(7200000000000n);
      expect(await oddsTableHash(edition.index)).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.parse(canonicalOddsTable(edition.index)).rows).toHaveLength(
        6,
      );
    }
  });
});

describe("The 1% and Jackpot chain models", () => {
  const machine = () => {
    const decoded = machineLayout.decode(
      machineLayout.encode({
        on_air_ts: 1000n,
        end_ts: 2000n,
        onepct: TOKEN_1PCT.onePctReleaseOffsetsSeconds.map(() => ({
          state: 0,
          amount: TOKEN_1PCT.onePctCardAmount,
        })),
      }),
    );
    return { ...decoded, onepct: decoded.onepct.map((slot) => ({ ...slot })) };
  };
  it("does not treat stored Live as released, and later cards wait for earlier cards", () => {
    const state = machine();
    state.onepct[0]!.state = 1;
    expect(onePctLiveIndex(state, 999n)).toBeNull();
    expect(onePctLiveIndex(state, 1000000n)).toBe(0);
    state.onepct[0]!.state = 2;
    expect(onePctLiveIndex(state, 1000n)).toBeNull();
    expect(onePctLiveIndex(state, 1000000n)).toBe(1);
    state.onepct[1]!.state = 3;
    expect(onePctLiveIndex(state, 1000000n)).toBeNull();
  });
  it("never advertises an empty The 1% slot as available", () => {
    const state = machine();
    state.onepct[0]!.amount = 0n;
    expect(onePctLiveIndex(state, 1000000n)).toBeNull();
    expect(
      specialLiveFlags(state, PACK_EDITIONS[0].priceLamports, 1000000n),
    ).toBe(0);
  });
  it("retains live specials after end_ts until the final snapshot", () => {
    const state = machine();
    state.jackpot_tokens = 1n;
    state.jackpot_cost = 1500000000n;
    expect(specialLiveFlags(state, PACK_EDITIONS[0].priceLamports, 3000n)).toBe(
      5,
    );
    expect(specialLiveFlags(state, PACK_EDITIONS[1].priceLamports, 3000n)).toBe(
      1,
    );
    const data = tokenModel(
      configLayout.decode(configLayout.encode()),
      state,
      3000n,
    );
    expect(data.mint).toBeNull();
    expect(data.onePct[1]!.releaseTs).toBe(
      1_000n + BigInt(TOKEN_1PCT.onePctReleaseOffsetsSeconds[1]),
    );
    expect(data.jackpot).not.toHaveProperty("valueSol");
  });
});

describe("chain authority trust", () => {
  const admin = new PublicKey(new Uint8Array(32).fill(7));
  const account = (data: Buffer, owner: PublicKey): AccountInfo<Buffer> => ({
    data,
    owner,
    executable: false,
    lamports: 1,
    rentEpoch: 0,
  });
  const programData = (authority: PublicKey | null) => {
    const data = Buffer.alloc(45);
    data.writeUInt32LE(3);
    data[12] = authority ? 1 : 0;
    authority?.toBuffer().copy(data, 13);
    return account(data, LOADER);
  };
  const multisig = () => {
    const [data] = accounts.Multisig.fromArgs({
      createKey: admin,
      configAuthority: PublicKey.default,
      threshold: GOVERNANCE.multisigThreshold,
      timeLock: GOVERNANCE.timelockSeconds,
      transactionIndex: 0,
      staleTransactionIndex: 0,
      rentCollector: null,
      bump: 0,
      members: [7, 8, 9].map((value) => ({
        key: new PublicKey(new Uint8Array(32).fill(value)),
        permissions: { mask: 7 },
      })),
    }).serialize();
    return account(data, new PublicKey(PROGRAM_IDS.squadsV4));
  };
  it("shows only evidence-supported authority states", () => {
    expect(multisigVault(admin)).toEqual(
      getVaultPda({ multisigPda: admin, index: 0 })[0],
    );
    const input = {
      programData: programData(multisigVault(admin)),
      adminMultisig: admin.toBase58(),
      multisig: multisig(),
    };
    expect(trustModel(input)).toBe("timelocked");
    expect(trustModel({ ...input, programData: programData(null) })).toBe(
      "sealed",
    );
    expect(
      trustModel({ ...input, programData: programData(admin) }),
    ).toBeNull();
    expect(trustModel({ ...input, adminMultisig: null })).toBeNull();
    input.multisig.data.writeUInt32LE(3600, 74);
    expect(trustModel(input)).toBeNull();
    input.multisig = multisig();
    input.multisig.data[40] = 1;
    expect(trustModel(input)).toBeNull();
    input.multisig = multisig();
    input.multisig.owner = PublicKey.default;
    expect(trustModel(input)).toBeNull();
    expect(
      trustModel({ ...input, programData: account(Buffer.alloc(5), LOADER) }),
    ).toBeNull();
  });
});

describe("confirmed TV adapter", () => {
  const who = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
  const event = {
    id: "12-1-0",
    event: "feed",
    data: {
      name: "BagFed",
      depositor: who,
      mint: who,
      amount: "99",
      deck_index: 1,
      deposit: "1",
      fresh_in_deck: 1,
      asOfSlot: 999,
      signature: "1".repeat(64),
    },
  };
  it("sanitizes tickers, uses canonical slot, never invents timestamps or amounts", () => {
    const entry = tvEvent(event, { ticker: "<script>\u202e$bad_1234567890" });
    expect(entry?.ticker).toBe("SCRIPTBAD1");
    expect(entry?.who).toBe(`${who.slice(0, 3)}…${who.slice(-2)}`);
    expect(entry?.slot).toBe(12);
    expect(entry?.ts).toBeNull();
    expect(entry).not.toHaveProperty("lamports");
    expect(entry?.announce).toBe(false);
    expect(() => tvEvent({ ...event, event: "reveal" })).toThrow();
  });
});

describe("broadcast season state", () => {
  const totals = {
    asOfSlot: 100,
    stock: { book: "0" },
    deck: { len: 0 },
    pendingPulls: "0",
    jackpot: { tokens: "0" },
  } as unknown as MachineResponse;
  it("stops announcing Last Call at the chain deadline before a phase-advance transaction", () => {
    const end = BigInt(SEASON.lastCallSeconds) * 2n;
    const machine = { phase: PHASE.onAir, on_air_ts: 1n, end_ts: end };
    expect(
      liveModel(totals, machine, end - 21_601n, { onAir: true }, []).tv.state,
    ).toBe("onAir");
    expect(
      liveModel(totals, machine, end - 21_600n, { onAir: true }, []).tv.state,
    ).toBe("lastCall");
    expect(
      liveModel(totals, machine, end - 1n, { onAir: true }, []).tv.state,
    ).toBe("lastCall");
    expect(liveModel(totals, machine, end, { onAir: true }, []).tv.state).toBe(
      "buysClosed",
    );
    expect(
      liveModel(
        totals,
        { ...machine, phase: PHASE.buysClosed },
        end + 1n,
        { onAir: false },
        [],
      ).tv,
    ).toMatchObject({ state: "buysClosed", onAir: false });
    expect(
      liveModel(
        totals,
        { ...machine, phase: PHASE.finalPull },
        end + 1n,
        { onAir: true },
        [],
      ).tv.state,
    ).toBe("finalPull");
  });
});
