import { expect, it } from "vitest";
import { serviceParams, serviceParamsSchema } from "../src/params.js";

it("keeps an RPC timeout strictly below the role authorization interval", () => {
  const validityMs = serviceParams.signers.roleRecheckSeconds * 1000;
  for (const rpcTimeoutMs of [validityMs, validityMs + 1]) {
    const parsed = serviceParamsSchema.safeParse({
      ...serviceParams,
      transport: { ...serviceParams.transport, rpcTimeoutMs },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["transport", "rpcTimeoutMs"] }),
        ]),
      );
    }
  }
  expect(
    serviceParamsSchema.safeParse({
      ...serviceParams,
      transport: { ...serviceParams.transport, rpcTimeoutMs: validityMs - 1 },
    }).success,
  ).toBe(true);
});
