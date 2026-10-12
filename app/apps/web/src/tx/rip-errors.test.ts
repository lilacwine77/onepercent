import { PROGRAM_ID } from "../../../../packages/sdk/tests/program-id.js";
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EXTERNAL_IDS } from "@onepercent/sdk";
import { ripSimulationError } from "./rip-errors";

describe("Rip simulation copy", () => {
  it.each([
    ["LiveFlagsChanged", "rip.machineChanged"],
    ["Refilling", "rip.state.refilling"],
    ["MachineHungry", "rip.state.hungry"],
    ["BinderFull", "rip.myCardsFull"],
    ["WrongPhase", "errors.seasonOver"],
    ["SeasonOver", "errors.seasonOver"],
  ])("maps %s through the SDK", (name, expected) => {
    expect(
      ripSimulationError({}, [
        `Program log: AnchorError. Error Code: ${name}.`,
        `Program ${PROGRAM_ID} failed: custom program error`,
      ]),
    ).toBe(expected);
  });
  it("distinguishes the VRF program failure from compute exhaustion", () => {
    const logs = [
      `Program ${EXTERNAL_IDS.magicblockVrf} failed: custom program error`,
      `Program ${PROGRAM_ID} failed: custom program error`,
    ];
    expect(ripSimulationError({}, logs)).toBe("rip.state.busy");
    expect(
      ripSimulationError(
        { InstructionError: [0, "ComputationalBudgetExceeded"] },
        logs,
      ),
    ).toBe("errors.simulation");
    expect(
      ripSimulationError({}, [
        `Program ${PROGRAM_ID} failed: custom program error`,
      ]),
    ).toBe("errors.simulation");
  });
});
