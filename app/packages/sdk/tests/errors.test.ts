import { PROGRAM_ID } from "./program-id.js";
import { describe, expect, it } from "vitest";
import {
  IDL,
  EXTERNAL_IDS,
  programError as decodeProgramError,
  type ErrorContext,
} from "../src/index.js";
const named: Record<string, string> = {
  LiveFlagsChanged: "machineChanged",
  Refilling: "refilling",
  MachineHungry: "hungry",
  AttestationExpired: "tooLong",
  FreshCapReached: "freshCap",
  NotPumpFun: "notInSet",
  MintNotSafe: "notInSet",
  MintForbidden: "notInSet",
  SeasonOver: "seasonOver",
  WrongPhase: "seasonOver",
  QueueNotAllowed: "busy",
  BinderFull: "myCardsFull",
  CardMoved: "cardMoved",
  PayeeBelowRent: "payeeBelowRent",
  SellBackFloor: "sellBackFallback",
  SellBackBudget: "sellBackFallback",
  BucketCapExceeded: "sellBackFallback",
  BucketDisabled: "sellBackFallback",
  NotFeedable: "notFeedable",
  PullPending: "pullPending",
  BinderNotEmpty: "myCardsNotEmpty",
  FinalNotClaimed: "myCardsNotEmpty",
};
function programError(error: unknown, context: ErrorContext = {}) {
  return decodeProgramError(error, { programId: PROGRAM_ID, ...context });
}

describe("error copy keys", () => {
  it("maps D17 independently of the numeric error assignment", () => {
    expect(programError({ name: "PayeeBelowRent" })).toEqual({
      name: "PayeeBelowRent",
      copyKey: "payeeBelowRent",
    });
  });
  it("maps every generated IDL error, and preserves stable names", () => {
    expect(IDL.errors?.length).toBeGreaterThanOrEqual(69);
    expect(programError(6047)).toEqual({
      name: "PayeeBelowRent",
      copyKey: "payeeBelowRent",
    });
    for (const entry of IDL.errors ?? [])
      expect(programError(entry.code, { instruction: "buy_packs" })).toEqual({
        name: entry.name,
        copyKey: named[entry.name] ?? "generic",
      });
  });
  it("appends the M2 codes after D17 without moving existing errors", () => {
    const names = [
      "ExecPairing",
      "ExecInFlight",
      "TooSoon",
      "TrancheTooLarge",
      "HourlyCapReached",
      "TrendingShareExceeded",
      "BucketCapExceeded",
      "ReservedCapacity",
      "BucketDisabled",
      "OracleInvalid",
      "OracleStale",
      "OracleWide",
      "SlippageExceeded",
      "SlackShort",
      "NotSellBackable",
      "SellBackFloor",
      "SellBackBudget",
      "NotFeedable",
      "BinderNotEmpty",
      "PullPending",
      "FinalNotClaimed",
    ];
    for (const [index, name] of names.entries()) {
      const code = 6048 + index;
      expect(IDL.errors?.find((error) => error.code === code)?.name).toBe(name);
      expect(programError(code)).toEqual({
        name,
        copyKey: named[name] ?? "generic",
      });
    }
  });
  it("uses Sell back fallback only for Sell back attestation expiry", () => {
    const entry = IDL.errors?.find(
      (error) => error.name === "AttestationExpired",
    );
    expect(entry).toBeDefined();
    for (const error of [
      entry!.code,
      { name: "AttestationExpired" },
      {
        error: {
          errorCode: { code: "AttestationExpired", number: entry!.code },
        },
      },
    ]) {
      expect(programError(error, { instruction: "sell_back" })).toEqual({
        name: "AttestationExpired",
        copyKey: "sellBackFallback",
      });
      for (const instruction of [undefined, "feed", "buy_packs"])
        expect(programError(error, { instruction }).copyKey).toBe("tooLong");
    }
    expect(
      programError(
        {},
        {
          instruction: "sell_back",
          logs: ["Program log: AnchorError. Error Code: AttestationExpired."],
        },
      ).copyKey,
    ).toBe("sellBackFallback");
  });
  it("appends the two M4 errors after P0 with generic copy", () => {
    for (const [index, name] of [
      "NotLaunchCurve",
      "FinalPullNotDue",
    ].entries()) {
      const code = 6069 + index;
      expect(IDL.errors?.find((entry) => entry.code === code)?.name).toBe(name);
      expect(programError(code)).toEqual({ name, copyKey: "generic" });
    }
  });
  it("maps a recorded nested VRF failure by program address, never numeric code", () => {
    const logs = [
      `Program ${PROGRAM_ID} invoke [1]`,
      `Program ${EXTERNAL_IDS.magicblockVrf} invoke [2]`,
      `Program ${EXTERNAL_IDS.magicblockVrf} failed: custom program error: 0x1770`,
      `Program ${PROGRAM_ID} failed: custom program error: 0x1770`,
    ];
    expect(programError(6000, { instruction: "buy_packs", logs }).copyKey).toBe(
      "busy",
    );
    expect(programError(6000, { instruction: "feed", logs }).copyKey).toBe(
      "generic",
    );
    expect(programError(6000, { instruction: "buy_packs" }).copyKey).toBe(
      "generic",
    );
  });
  it("maps runtime compute exhaustion before an inner VRF failure", () => {
    const logs = [
      `Program ${PROGRAM_ID} invoke [1]`,
      `Program ${EXTERNAL_IDS.magicblockVrf} invoke [2]`,
      `Program ${EXTERNAL_IDS.magicblockVrf} consumed 71000 of 71000 compute units`,
      `Program ${EXTERNAL_IDS.magicblockVrf} failed: exceeded CUs meter at BPF instruction`,
      `Program ${PROGRAM_ID} failed: Program failed to complete`,
    ];
    expect(
      programError(
        { err: { InstructionError: [1, "ProgramFailedToComplete"] }, logs },
        { instruction: "buy_packs" },
      ),
    ).toEqual({
      name: "ComputeBudgetExceeded",
      copyKey: "computeBudgetExceeded",
    });
  });
  it("recognizes structured RPC compute exhaustion without logs", () => {
    const shapes = [
      { InstructionError: [0, "ComputationalBudgetExceeded"] },
      { name: "ComputationalBudgetExceeded" },
      new Error("RPC transaction failed", {
        cause: {
          err: { InstructionError: [0, "ComputationalBudgetExceeded"] },
        },
      }),
      {
        data: { err: { InstructionError: [2, "ComputationalBudgetExceeded"] } },
      },
      {
        value: {
          err: { InstructionError: [0, "ComputationalBudgetExceeded"] },
        },
      },
      new Error("Simulation failed: Computational budget exceeded"),
      {
        transactionMessage:
          "Error processing Instruction 1: computational budget exceeded",
      },
    ];
    for (const error of shapes)
      expect(
        programError(error, {
          instruction: "buy_packs",
          failingInnerProgramId: EXTERNAL_IDS.magicblockVrf,
        }).copyKey,
      ).toBe("computeBudgetExceeded");
  });
  it("does not infer exhaustion from a compute consumption line or an unrelated program failure", () => {
    expect(programError("ProgramFailedToComplete")).toEqual({
      name: "Unknown",
      copyKey: "generic",
    });
    expect(
      programError(6000, {
        instruction: "buy_packs",
        failingInnerProgramId: EXTERNAL_IDS.magicblockVrf,
        logs: [
          `Program ${EXTERNAL_IDS.magicblockVrf} consumed 71000 of 71000 compute units`,
        ],
      }).copyKey,
    ).toBe("busy");
    const circular: Record<string, unknown> = {};
    circular.error = circular;
    expect(programError(circular).copyKey).toBe("generic");
  });
  it("only maps WrongPhase to seasonOver in Rip", () => {
    expect(
      programError({ name: "WrongPhase" }, { instruction: "feed" }).copyKey,
    ).toBe("generic");
  });
  it("handles rejection, expiry, Anchor-shaped errors and unknown errors", () => {
    expect(programError({ code: 4001 })).toEqual({
      name: "WalletRejected",
      copyKey: "walletNo",
    });
    expect(programError(new Error("Blockhash not found")).copyKey).toBe(
      "tooLong",
    );
    expect(
      programError({
        error: { errorCode: { code: "CardMoved", number: 6024 } },
      }).copyKey,
    ).toBe("cardMoved");
    expect(programError(new Error("Unexpected response")).copyKey).toBe(
      "generic",
    );
  });
});
