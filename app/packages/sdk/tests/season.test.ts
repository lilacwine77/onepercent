import { PublicKey, SystemProgram } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  METEORA_BY_CLUSTER,
  PACK_EDITIONS,
  STOCK,
  TOKEN_1PCT,
} from "@onepercent/config";
import {
  collectCreatorFeesIx,
  createDeploymentSelector,
  creatorFeeBook,
  creatorFeeRegime,
  CREATOR_FEE_REGIME,
  decodeMachine,
  encodeMachine,
  EXTERNAL_IDS,
  feeInPda,
  jackpotLive,
  liveFlags,
  onePctLiveIndex,
  PHASE,
  powerOnIx,
  releaseTimes,
  splitCreatorFees,
  STUB_INSTRUCTIONS,
  userAta,
  vaultAta,
  vaultAuthPda,
  configPda,
  machinePda,
  ledgerPda,
  dbcPoolPda,
  dbcLaunchDataIsValid,
} from "../src/index.js";
import { decimalJson, vectors } from "./vectors.js";
import { DEPLOYMENT, PROGRAM_ID } from "./program-id.js";

interface SpecialVector {
  input: {
    states: number[];
    onAirTs: string;
    nowTs: string;
    edition: number;
    jackpotTokens: string;
    jackpotCost: string;
  };
  output: {
    flags: number;
    onePctIndex: number | null;
    jackpotLive: boolean;
    releaseTimes: string[];
  };
}
interface FeeVector {
  input: {
    phase: number;
    stockSol: string;
    bucketCosts: string[];
    hitOutLastHour: string;
    amount: string;
  };
  output: {
    regime: number;
    book: string;
    target: string;
    split: { stock: string; burn: string; team: string };
  };
}
const machine = (input: Parameters<typeof encodeMachine>[0] = {}) =>
  decodeMachine(encodeMachine(input));

describe("M4 launch math mirrors", () => {
  it("matches Rust release, corrupted-state, threshold and random vectors", () => {
    const cases = vectors<SpecialVector[]>("specials");
    expect(cases.length).toBeGreaterThanOrEqual(111);
    for (const { input, output } of cases) {
      const state = machine({
        on_air_ts: BigInt(input.onAirTs),
        onepct: input.states.map((state) => ({
          state,
          amount: TOKEN_1PCT.onePctCardAmount,
        })),
        jackpot_tokens: BigInt(input.jackpotTokens),
        jackpot_cost: BigInt(input.jackpotCost),
      });
      const now = BigInt(input.nowTs);
      expect(liveFlags(state, input.edition, now)).toEqual({
        flags: output.flags,
        onePctIndex: output.onePctIndex,
      });
      expect(onePctLiveIndex(state, now)).toBe(output.onePctIndex);
      expect(
        jackpotLive(state, PACK_EDITIONS[input.edition]!.priceLamports),
      ).toBe(output.jackpotLive);
      expect(releaseTimes(state).map(String)).toEqual(output.releaseTimes);
      expect(output.flags & 2).toBe(0);
    }
  });

  it("matches D27 Rust splits, exact floor, all bucket costs and u64 extremes", () => {
    const cases = vectors<FeeVector[]>("creator_fee");
    expect(cases.length).toBeGreaterThanOrEqual(100);
    for (const { input, output } of cases) {
      const state = machine({
        phase: input.phase,
        stock_sol: BigInt(input.stockSol),
        hit_out_last_hour: BigInt(input.hitOutLastHour),
        buckets: input.bucketCosts.map((cost) => ({ cost: BigInt(cost) })),
      });
      const regime = creatorFeeRegime(state, 0n);
      expect(regime).toBe(output.regime);
      expect(creatorFeeBook(state).toString()).toBe(output.book);
      const split = splitCreatorFees(BigInt(input.amount), regime);
      expect(decimalJson(split)).toEqual(output.split);
      expect(split.stock + split.burn + split.team).toBe(BigInt(input.amount));
      expect(split.burn).toBe(0n);
    }
  });

  it("uses one pre-collection regime when funding crosses the floor", () => {
    const initial = machine({
      phase: PHASE.poweredOn,
      stock_sol: STOCK.creatorFeeFloorLamports - 1n,
    });
    const regime = creatorFeeRegime(initial, 7200n);
    expect(regime).toBe(CREATOR_FEE_REGIME.belowFloor);
    expect(splitCreatorFees(10n, regime)).toEqual({
      stock: 10n,
      burn: 0n,
      team: 0n,
    });
    expect(
      creatorFeeRegime(
        { ...initial, stock_sol: initial.stock_sol + 10n },
        7200n,
      ),
    ).toBe(CREATOR_FEE_REGIME.season);
    expect(initial.stock_sol).toBe(STOCK.creatorFeeFloorLamports - 1n);
  });

  it("ignores the target and hour changes, and reads the phase for After End", () => {
    const initial = machine({
      phase: PHASE.onAir,
      stock_sol: STOCK.targetBaseLamports + 1n,
      hour_index: 1n,
      hit_out_this_hour: (1n << 64n) - 1n,
      end_ts: 1n,
    });
    expect(creatorFeeRegime(initial, 7200n)).toBe(CREATOR_FEE_REGIME.season);
    expect(splitCreatorFees(9n, CREATOR_FEE_REGIME.season)).toEqual({
      stock: 5n,
      burn: 0n,
      team: 4n,
    });
    expect(
      creatorFeeRegime({ ...initial, phase: PHASE.buysClosed }, 7200n),
    ).toBe(CREATOR_FEE_REGIME.afterEnd);
    expect(splitCreatorFees(9n, CREATOR_FEE_REGIME.afterEnd)).toEqual({
      stock: 0n,
      burn: 0n,
      team: 9n,
    });
  });
});

describe("D29 launch layouts", () => {
  it("matches the Rust pool and config field validation vectors", () => {
    const cases = vectors<
      {
        name: string;
        feeIn: string;
        mint: string;
        dbcConfig: string;
        poolData: string;
        configData: string;
        accepted: boolean;
      }[]
    >("launch_pool");
    expect(cases.length).toBeGreaterThanOrEqual(19);
    for (const row of cases) {
      expect(
        dbcLaunchDataIsValid({
          pool: Buffer.from(row.poolData, "hex"),
          config: Buffer.from(row.configData, "hex"),
          mint: new PublicKey(row.mint),
          dbcConfig: new PublicKey(row.dbcConfig),
          feeIn: new PublicKey(row.feeIn),
        }),
        row.name,
      ).toBe(row.accepted);
    }
  });
});

describe("M4 launch builders", () => {
  const caller = new PublicKey(new Uint8Array(32).fill(31));
  const mint = new PublicKey(new Uint8Array(32).fill(32));
  it("selects launch IDs and Meteora pins together across interleaved clusters", () => {
    const programIds = {
      localnet: new PublicKey(new Uint8Array(32).fill(41)),
      devnet: new PublicKey(new Uint8Array(32).fill(42)),
    };
    const selectDeployment = createDeploymentSelector(programIds);
    const machines: PublicKey[] = [];
    for (const cluster of ["localnet", "devnet", "localnet"] as const) {
      const deployment = selectDeployment(cluster);
      const programId = programIds[cluster];
      const config = new PublicKey(METEORA_BY_CLUSTER[cluster].dbcConfig);
      const machine = PublicKey.findProgramAddressSync(
        [Buffer.from("machine")],
        programId,
      )[0];
      const feeIn = PublicKey.findProgramAddressSync(
        [Buffer.from("fee_in")],
        programId,
      )[0];
      const [maximum, minimum] =
        Buffer.compare(mint.toBuffer(), NATIVE_MINT.toBuffer()) > 0
          ? [mint, NATIVE_MINT]
          : [NATIVE_MINT, mint];
      const pool = PublicKey.findProgramAddressSync(
        [
          Buffer.from("pool"),
          config.toBuffer(),
          maximum.toBuffer(),
          minimum.toBuffer(),
        ],
        EXTERNAL_IDS.meteoraDbc,
      )[0];
      const launch = powerOnIx(deployment, {
        launchWallet: caller,
        mint,
        tokenProgram: EXTERNAL_IDS.splToken,
      });
      expect(launch.programId).toEqual(programId);
      expect(launch.keys[2]?.pubkey).toEqual(machine);
      expect(launch.keys[4]?.pubkey).toEqual(pool);
      expect(launch.keys[5]?.pubkey).toEqual(config);
      expect(launch.keys[6]?.pubkey).toEqual(feeIn);
      const collect = collectCreatorFeesIx(deployment, { payer: caller });
      expect(collect.programId).toEqual(programId);
      expect(collect.keys[1]?.pubkey).toEqual(machine);
      expect(collect.keys[2]?.pubkey).toEqual(feeIn);
      expect(collect.keys[3]?.pubkey).toEqual(
        userAta(feeIn, NATIVE_MINT, EXTERNAL_IDS.splToken),
      );
      machines.push(machine);
    }
    expect(machines[0]).not.toEqual(machines[1]);
    expect(machines[0]).toEqual(machines[2]);
  });
  it("excludes deployment overrides from launch and collection inputs", () => {
    type Override = "cluster" | "programId" | "dbcConfig";
    expectTypeOf<
      Extract<keyof Parameters<typeof powerOnIx>[1], Override>
    >().toEqualTypeOf<never>();
    expectTypeOf<
      Extract<keyof Parameters<typeof collectCreatorFeesIx>[1], Override>
    >().toEqualTypeOf<never>();
  });
  it("derives every launch account with exactly one signing wallet", () => {
    const ix = powerOnIx(DEPLOYMENT, {
      launchWallet: caller,
      mint,
      tokenProgram: EXTERNAL_IDS.splToken,
    });
    expect(ix.keys.map((meta) => meta.pubkey.toBase58())).toEqual(
      [
        caller,
        configPda(PROGRAM_ID)[0],
        machinePda(PROGRAM_ID)[0],
        mint,
        dbcPoolPda(mint, new PublicKey(DEPLOYMENT.meteora.dbcConfig))[0],
        new PublicKey(METEORA_BY_CLUSTER.localnet.dbcConfig),
        feeInPda(PROGRAM_ID)[0],
        ledgerPda(PROGRAM_ID, mint)[0],
        vaultAta(PROGRAM_ID, mint, EXTERNAL_IDS.splToken),
        vaultAuthPda(PROGRAM_ID)[0],
        EXTERNAL_IDS.splToken,
        SystemProgram.programId,
      ].map((key) => key.toBase58()),
    );
    expect(
      ix.keys.filter((meta) => meta.isSigner).map((meta) => meta.pubkey),
    ).toEqual([caller]);
    expect(ix.data.length).toBe(8);
  });
  it("rejects a Token-2022 launch mint", () => {
    expect(() =>
      powerOnIx(DEPLOYMENT, {
        launchWallet: caller,
        mint,
        tokenProgram: EXTERNAL_IDS.token2022,
      }),
    ).toThrow("SPL Token");
  });
  it("refuses mainnet launch construction while its config pin is PENDING", () => {
    const mainnet = createDeploymentSelector({ mainnet: caller })("mainnet");
    const build = () =>
      powerOnIx(mainnet, {
        launchWallet: caller,
        mint,
        tokenProgram: EXTERNAL_IDS.splToken,
      });
    if (METEORA_BY_CLUSTER.mainnet.dbcConfig === "PENDING")
      expect(build).toThrow("METEORA_DBC_CONFIG is PENDING for mainnet");
    else expect(build().programId.equals(caller)).toBe(true);
  });
  it("uses FeeIn's SPL wSOL ATA and leaves Final Pull builders deferred", () => {
    const ix = collectCreatorFeesIx(DEPLOYMENT, { payer: caller });
    expect(ix.keys.map((meta) => meta.pubkey.toBase58())).toEqual(
      [
        caller,
        machinePda(PROGRAM_ID)[0],
        feeInPda(PROGRAM_ID)[0],
        userAta(feeInPda(PROGRAM_ID)[0], NATIVE_MINT, EXTERNAL_IDS.splToken),
        EXTERNAL_IDS.splToken,
        SystemProgram.programId,
      ].map((key) => key.toBase58()),
    );
    expect(ix.keys.map((meta) => meta.isWritable)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(STUB_INSTRUCTIONS).toEqual([
      "spotlight_deposit",
      "spotlight_take_back",
      "start_final_pull",
      "claim_final_sol",
      "claim_final_tokens",
    ]);
  });
});
