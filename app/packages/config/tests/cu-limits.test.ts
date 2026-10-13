import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CU_LIMITS, PARAMS, validateParams } from "../src/index.js";

const report = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/reports/cu.json", import.meta.url),
    "utf8",
  ),
) as {
  measured: {
    feed: number[];
    takeBack: number;
    buyPacks: [number, number];
    settle: number[];
    refundPull: number;
    redeem: [number, number];
  };
  limits: typeof CU_LIMITS;
  corpora: {
    name: string;
    cases: {
      instruction: string;
      packs?: number;
      pullQty?: number;
      closedFreshBinders?: number;
      cu: number;
    }[];
  }[];
};
const rounded = (measured: number) =>
  Math.ceil((measured * 1.25) / 1_000) * 1_000;
const season = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/reports/m4-cu.json", import.meta.url),
    "utf8",
  ),
) as {
  measured: {
    powerOn: number;
    collectCreatorFees: number;
    claimLaunchFees: Record<"curve" | "pool" | "surplus", number>;
    feeChainTx: Record<"curve" | "pool" | "surplus", number>;
  };
  limits: {
    powerOn: number;
    collectCreatorFees: number;
    claimLaunchFees: Record<"curve" | "pool" | "surplus", number>;
    feeChainTx: Record<"curve" | "pool" | "surplus", number>;
  };
  transactionBytes: {
    powerOn: number;
    collectCreatorFees: number;
    claimLaunchFees: Record<"curve" | "pool" | "surplus", number>;
    feeChainTx: Record<"curve" | "pool" | "surplus", number>;
  };
};
const meteora = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/reports/m4-meteora-season.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  computeUnits: Record<string, number>;
  transactionBytes: Record<string, number>;
};
const venueLimits = (native: Record<string, number>, suffix: string) =>
  Object.fromEntries(
    Object.entries(native).map(([kind, units]) => [
      kind,
      rounded(
        Math.max(units, meteora.computeUnits[`claim${kind}${suffix}`] ?? 0),
      ),
    ]),
  );
const executor = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/reports/m2-exec.json", import.meta.url),
    "utf8",
  ),
) as {
  nativeCases: {
    beginCu: number;
    endCu: number;
    pairBytesWithoutSwap: number;
  }[];
  validatorCases: {
    beginCu: number;
    endCu: number;
    transactionBytes: number;
  }[];
  measured: { execBegin: number; execEnd: number };
  limits: { execBegin: number; execEnd: number };
};
type FinalPullLimits = Pick<
  typeof CU_LIMITS,
  "startFinalPull" | "claimFinalSol" | "claimFinalTokens"
>;
const finalPull = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/reports/final-pull-cu.json", import.meta.url),
    "utf8",
  ),
) as {
  measured: FinalPullLimits & { combinedClaims: number };
  limits: FinalPullLimits;
  cases: {
    instruction: string;
    variant?: string;
    cu: number;
    bytes: number;
  }[];
};
const roundedFinalPull = {
  startFinalPull: rounded(finalPull.measured.startFinalPull),
  claimFinalSol: {
    x1: rounded(finalPull.measured.claimFinalSol.x1),
    xMax: rounded(finalPull.measured.claimFinalSol.xMax),
  },
  claimFinalTokens: rounded(finalPull.measured.claimFinalTokens),
};
const finalBurn = JSON.parse(
  readFileSync(
    new URL(
      "../../../fixtures/reports/final-pull-burn-cu.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  measured: { existingTransaction: number; restorationTransaction: number };
  limits: Pick<typeof CU_LIMITS, "execBegin" | "execEnd" | "restoreBurnVault">;
  restorationAllowanceDerivation: {
    additionalRequired: number;
    baseHandlerBudget: number;
    wholeRestorationWith25PercentMargin: number;
  };
  transactionLimits: { existing: number; restoration: number };
  variants: { variant: string; transactionMax: number }[];
};
const baseExecutorBudget =
  rounded(executor.measured.execBegin) + rounded(executor.measured.execEnd);
const restorationBudget = rounded(finalBurn.measured.restorationTransaction);
const restorationAllowance = Math.max(
  0,
  restorationBudget - baseExecutorBudget,
);
const realVrf = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/reports/real-vrf.json", import.meta.url),
    "utf8",
  ),
) as {
  measured: { buyPacks: [number, number] };
  limits: { buyPacks: { x1: number; x10: number } };
  samples: { qty: number; success: boolean; units: number; copyKey: string }[];
};
type MyCardsLimits = Pick<
  typeof CU_LIMITS,
  "sellBack" | "feedBack" | "closeBinder" | "withdrawOwed"
>;
const myCards = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/reports/mycards.json", import.meta.url),
    "utf8",
  ),
) as { measured: MyCardsLimits; limits: MyCardsLimits };
const roundedMyCards = {
  sellBack: {
    x1: rounded(myCards.measured.sellBack.x1),
    x8: rounded(myCards.measured.sellBack.x8),
  },
  feedBack: {
    x1: rounded(myCards.measured.feedBack.x1),
    x8: rounded(myCards.measured.feedBack.x8),
  },
  closeBinder: rounded(myCards.measured.closeBinder),
  withdrawOwed: rounded(myCards.measured.withdrawOwed),
};

describe("measured transaction compute limits", () => {
  it("uses exactly the measured maximum with 25% headroom and upward rounding", () => {
    const m = report.measured;
    expect(report.limits).toEqual({
      feed: m.feed.map(rounded),
      takeBack: rounded(m.takeBack),
      buyPacks: { x1: rounded(m.buyPacks[0]), x10: rounded(m.buyPacks[1]) },
      settle: m.settle.map(rounded),
      refundPull: rounded(m.refundPull),
      redeem: { x1: rounded(m.redeem[0]), x8: rounded(m.redeem[1]) },
    });
    expect(CU_LIMITS).toEqual({
      ...report.limits,
      ...season.limits,
      claimLaunchFees: venueLimits(season.measured.claimLaunchFees, ""),
      feeChainTx: venueLimits(season.measured.feeChainTx, "AndCollect"),
      buyPacks: {
        x1: rounded(Math.max(m.buyPacks[0], realVrf.measured.buyPacks[0])),
        x10: rounded(Math.max(m.buyPacks[1], realVrf.measured.buyPacks[1])),
      },
      ...roundedMyCards,
      ...roundedFinalPull,
      execBegin: rounded(executor.measured.execBegin),
      execEnd: rounded(executor.measured.execEnd),
      restoreBurnVault: restorationAllowance,
    });
  });

  it("derives Final Pull limits from the complete measured transactions", () => {
    const maximum = (instruction: string, combined = false) =>
      Math.max(
        ...finalPull.cases
          .filter(
            (entry) =>
              entry.instruction === instruction &&
              (entry.variant === "combined") === combined,
          )
          .map((entry) => entry.cu),
      );
    expect(finalPull.measured).toEqual({
      startFinalPull: maximum("startFinalPull"),
      claimFinalSol: {
        x1: maximum("claimFinalSol"),
        xMax: maximum("claimFinalSolBatch"),
      },
      claimFinalTokens: maximum("claimFinalTokens"),
      combinedClaims: maximum("claimFinalTokens", true),
    });
    expect(finalPull.limits).toEqual(roundedFinalPull);
    expect(rounded(finalPull.measured.combinedClaims)).toBeLessThanOrEqual(
      CU_LIMITS.claimFinalSol.x1 + CU_LIMITS.claimFinalTokens,
    );
    for (const entry of finalPull.cases)
      expect(entry.bytes).toBeLessThanOrEqual(PARAMS.TX_LIMITS.maxTxBytes);
  });

  it("adds only the measured allowance for optional Done Burn restoration", () => {
    for (const [name, restored] of [
      ["existingTransaction", false],
      ["restorationTransaction", true],
    ] as const)
      expect(finalBurn.measured[name]).toBe(
        Math.max(
          ...finalBurn.variants
            .filter((entry) => (entry.variant !== "existing") === restored)
            .map((entry) => entry.transactionMax),
        ),
      );
    expect(finalBurn.restorationAllowanceDerivation).toEqual({
      additionalRequired: restorationAllowance,
      baseHandlerBudget: baseExecutorBudget,
      wholeRestorationWith25PercentMargin: restorationBudget,
    });
    expect(finalBurn.limits).toEqual({
      ...executor.limits,
      restoreBurnVault: restorationAllowance,
    });
    expect(finalBurn.transactionLimits).toEqual({
      existing: baseExecutorBudget,
      restoration: baseExecutorBudget + restorationAllowance,
    });
  });

  it("covers every exec path and real venue transaction in the measurement report", () => {
    expect(executor.nativeCases).toHaveLength(16);
    expect(executor.validatorCases).toHaveLength(6);
    const cases = [...executor.nativeCases, ...executor.validatorCases];
    expect(executor.measured).toEqual({
      execBegin: Math.max(...cases.map((entry) => entry.beginCu)),
      execEnd: Math.max(...cases.map((entry) => entry.endCu)),
    });
    expect(executor.limits).toEqual({
      execBegin: rounded(executor.measured.execBegin),
      execEnd: rounded(executor.measured.execEnd),
    });
    for (const bytes of [
      ...executor.nativeCases.map((entry) => entry.pairBytesWithoutSwap),
      ...executor.validatorCases.map((entry) => entry.transactionBytes),
    ])
      expect(bytes).toBeLessThanOrEqual(PARAMS.TX_LIMITS.maxTxBytes);
  });

  it("covers the launch and fee-collection transactions with measured limits", () => {
    expect(season.limits).toEqual({
      powerOn: rounded(season.measured.powerOn),
      collectCreatorFees: rounded(season.measured.collectCreatorFees),
      claimLaunchFees: Object.fromEntries(
        Object.entries(season.measured.claimLaunchFees).map(([kind, value]) => [
          kind,
          rounded(value),
        ]),
      ),
      feeChainTx: Object.fromEntries(
        Object.entries(season.measured.feeChainTx).map(([kind, value]) => [
          kind,
          rounded(value),
        ]),
      ),
    });
    for (const bytes of [
      season.transactionBytes.powerOn,
      season.transactionBytes.collectCreatorFees,
      ...Object.values(season.transactionBytes.claimLaunchFees),
      ...Object.values(season.transactionBytes.feeChainTx),
      ...Object.values(meteora.transactionBytes),
    ]) {
      expect(bytes).toBeLessThanOrEqual(PARAMS.TX_LIMITS.maxTxBytes);
    }
  });

  it("covers closed FRESH Binders with a referrer for every Settle transaction shape", () => {
    const corpus = report.corpora.find(
      (item) => item.name === "g1-closed-binders",
    );
    expect(corpus).toBeDefined();
    for (const [packs, pullQty] of [
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ] as const) {
      const samples = corpus!.cases.filter(
        (sample) =>
          sample.instruction === "settle" &&
          sample.packs === packs &&
          sample.pullQty === pullQty,
      );
      expect(samples).toHaveLength(32);
      for (const sample of samples) {
        expect(sample.closedFreshBinders).toBe(4 * packs);
        expect(rounded(sample.cu)).toBeLessThanOrEqual(
          CU_LIMITS.settle[packs - 1]!,
        );
      }
    }
    // This corpus must retain the regression that exceeded the former x1 limit.
    expect(
      Math.max(
        ...corpus!.cases
          .filter((sample) => sample.packs === 1)
          .map((sample) => sample.cu),
      ),
    ).toBeGreaterThan(28_000);
  });

  it("includes real oracle queue failures as well as successful request costs", () => {
    const maxima = [1, 2].map((group) =>
      Math.max(
        ...realVrf.samples
          .filter((sample) => (group === 1 ? sample.qty === 1 : sample.qty > 1))
          .map((sample) => sample.units),
      ),
    );
    expect(realVrf.measured.buyPacks).toEqual(maxima);
    expect(realVrf.limits.buyPacks).toEqual({
      x1: rounded(maxima[0]!),
      x10: rounded(maxima[1]!),
    });
    expect(realVrf.samples.some((sample) => sample.success)).toBe(true);
    const failed = realVrf.samples.filter((sample) => !sample.success);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.every((sample) => sample.copyKey === "busy")).toBe(true);
    for (const sample of realVrf.samples) {
      expect(sample.units).toBeLessThanOrEqual(
        sample.qty === 1 ? CU_LIMITS.buyPacks.x1 : CU_LIMITS.buyPacks.x10,
      );
    }
  });

  it.each([0, 999, 1_001, 1_401_000])(
    "rejects invalid limits (%i)",
    (value) => {
      expect(() =>
        validateParams({
          ...PARAMS,
          CU_LIMITS: { ...CU_LIMITS, refundPull: value },
        }),
      ).toThrow();
    },
  );

  it("includes measured My cards limits with the same headroom and rounding", () => {
    expect(myCards.limits).toEqual(roundedMyCards);
  });

  it.each([0, 999, 1_001, 1_401_000])(
    "rejects invalid My cards limits (%i)",
    (value) => {
      for (const group of ["sellBack", "feedBack"] as const)
        for (const batch of ["x1", "x8"] as const)
          expect(() =>
            validateParams({
              ...PARAMS,
              CU_LIMITS: {
                ...CU_LIMITS,
                [group]: { ...CU_LIMITS[group], [batch]: value },
              },
            }),
          ).toThrow();
      for (const instruction of ["closeBinder", "withdrawOwed"] as const)
        expect(() =>
          validateParams({
            ...PARAMS,
            CU_LIMITS: { ...CU_LIMITS, [instruction]: value },
          }),
        ).toThrow();
    },
  );
});
