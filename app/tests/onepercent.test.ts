import { AnchorProvider, BorshCoder, EventParser } from "@anchor-lang/core";
import { IDL, ping } from "@onepercent/sdk";
import { PROGRAM_ID } from "../packages/sdk/tests/program-id.js";
import { describe, expect, it } from "vitest";

describe("onepercent on the local validator", () => {
  it("emits Pong with version 1 from ping", async () => {
    const provider = AnchorProvider.env();
    const signature = await ping(
      PROGRAM_ID,
      provider.connection,
      provider.wallet,
    );
    const transaction = await provider.connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    expect(transaction).not.toBeNull();
    expect(transaction?.meta?.err).toBeNull();
    const parser = new EventParser(PROGRAM_ID, new BorshCoder(IDL));
    const events = Array.from(
      parser.parseLogs(transaction?.meta?.logMessages ?? []),
    );
    expect(events).toContainEqual({ name: "Pong", data: { version: 1 } });
  });
});
