import { describe, it } from "vitest";
import { runValidatorFlow } from "../../scripts/e2e-validator.js";
// npm LiteSVM 0.8.0 cannot execute the deployable v3 artifact (VERSIONS.md S0).
// Master §0.5 requires the validator fallback, including a pre-aged E3 fixture.
describe("SDK transactions on the deployable sBPFv3 binary", () => {
  it("E1 Feed one bag then take it back", async () => {
    await runValidatorFlow("feed");
  });
  it("E2 Rip, fulfil, settle and Redeem all five cards", async () => {
    await runValidatorFlow("rip");
  });
  it("E3 refund a pre-aged Pending Pull", async () => {
    await runValidatorFlow("refund");
  });
  it("E4 settle one or two packs whose four FRESH Binders are closed", async () => {
    await runValidatorFlow("settle-closed");
  });
  it("E5 Sell, Feed back, owed SOL, Redeem every kind and close My cards", async () => {
    await runValidatorFlow("sellback");
  });
  it("M4 DBC launch, 85 SOL migration, DAMM claims and all D27 regimes", async () => {
    await runValidatorFlow("meteora-season");
  });
  it("M4 Power-On and direct FeeIn seeding follow D27", async () => {
    await runValidatorFlow("power-on");
  });
  it("E4b forced specials settle and Redeem", async () => {
    await runValidatorFlow("season");
  });
  it("E4b closes buys and collects fees entirely to team", async () => {
    await runValidatorFlow("season-closed");
  });
});
