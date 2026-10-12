// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { PublicKey, type Connection } from "@solana/web3.js";
import { decodePull, encodePull } from "@onepercent/sdk";
import recorded from "../../../../packages/sdk/src/verify/fixtures/validator-pulls.json";
import { loadPullEvidence } from "./pull";

const fixture = recorded.pulls[0]!;
function rpc(includeRequest = true) {
  const signatures = [
    fixture.callbackSignature,
    ...(includeRequest ? [fixture.requestSignature] : []),
  ];
  return {
    getSignaturesForAddress: vi.fn(async () =>
      signatures.map((signature) => ({ signature, err: null })),
    ),
    getTransaction: vi.fn(async (signature) => ({
      meta: {
        err: null,
        logMessages:
          signature === fixture.callbackSignature
            ? fixture.callback.logs
            : fixture.request.logs,
      },
    })),
  } as unknown as Connection;
}

describe("confirmed Pull event route", () => {
  it("recovers an already-closed Pull entirely from confirmed transaction logs", async () => {
    const connection = rpc();
    const evidence = await loadPullEvidence(
      connection,
      new PublicKey(fixture.pull),
    );
    expect(evidence?.source).toBe("rpc");
    expect(evidence?.header).toMatchObject({
      seq: BigInt(fixture.header.seq),
      buyer: fixture.header.buyer,
      qty: 1,
    });
    expect(evidence?.packs).toHaveLength(1);
    expect(evidence?.requestSignature).toBe(fixture.requestSignature);
    expect(connection.getTransaction).toHaveBeenCalledWith(
      fixture.callbackSignature,
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    );
  });
  it("keeps the request unavailable when only the closed Pull callback can be read", async () => {
    const evidence = await loadPullEvidence(
      rpc(false),
      new PublicKey(fixture.pull),
    );
    expect(evidence?.requestSignature).toBeNull();
    expect(evidence?.header.buyer).toBe(fixture.header.buyer);
    expect(evidence?.header.callerSeed).toBeUndefined();
  });
  it("rejects disagreement between the request and the observed account", async () => {
    const observed = decodePull(
      encodePull({
        seq: BigInt(fixture.header.seq),
        buyer: PublicKey.default,
        edition: 0,
        qty: 1,
      }),
    );
    await expect(
      loadPullEvidence(
        rpc(),
        new PublicKey(fixture.pull),
        observed.seq,
        observed,
      ),
    ).rejects.toThrow("disagrees");
  });
});
