import { PROGRAM_ID } from "../../../../packages/sdk/tests/program-id.js";
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  type Connection,
  type VersionedTransactionResponse,
} from "@solana/web3.js";

import fixture from "../../../../packages/sdk/src/verify/fixtures/validator-pulls.json";
import { loadVerify } from "./verify";
import { api } from "./api";

vi.mock("./api", () => ({ api: vi.fn() }));
type RecordedPull = (typeof fixture.pulls)[number];
function transaction(
  value: RecordedPull["request"],
): VersionedTransactionResponse {
  const programs = value.logs.flatMap((line) => {
    const match = /^Program (\S+) invoke \[1\]$/.exec(line);
    return match ? [match[1]!] : [];
  });
  const message = new TransactionMessage({
    payerKey: PublicKey.default,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: programs.map(
      (program) =>
        new TransactionInstruction({
          programId: new PublicKey(program),
          keys: [],
          data: new Uint8Array() as never,
        }),
    ),
  }).compileToV0Message();
  return {
    slot: value.slot,
    blockTime: value.blockTime,
    transaction: { message, signatures: [] },
    meta: {
      err: null,
      logMessages: value.logs,
      fee: 0,
      preBalances: [],
      postBalances: [],
      innerInstructions: [],
    },
  };
}
function rpcFor(draw: RecordedPull): Connection {
  return {
    getSignaturesForAddress: vi.fn().mockResolvedValue([
      { signature: draw.callbackSignature, err: null },
      { signature: draw.requestSignature, err: null },
    ]),
    getTransaction: vi.fn(async (signature: string) =>
      signature === draw.requestSignature
        ? transaction(draw.request)
        : signature === draw.callbackSignature
          ? transaction(draw.callback)
          : null,
    ),
  } as unknown as Connection;
}

describe("Verify recorded validator replay", () => {
  it("recomputes all 100 captured callbacks through the address route without an indexer", async () => {
    expect(fixture.provenance.pulls).toBe(100);
    expect(fixture.provenance.programId).toBe(PROGRAM_ID.toBase58());
    const seen = new Set<string>();
    for (const draw of fixture.pulls) {
      const result = await loadVerify(rpcFor(draw), draw.pull);
      expect(result?.source).toBe("rpc");
      expect(result?.check?.ok, `Pull ${draw.header.seq}`).toBe(true);
      expect(result?.check?.callerSeed.matches).toBeNull();
      expect(result?.providerProofVerified).toBe(false);
      expect(result?.revealedSlot).toBe(draw.callback.slot);
      expect(result?.links.callback).toBe(draw.callbackSignature);
      expect(result?.check?.packs[0]?.hitBucket.verified).toBe(false);
      seen.add(result!.seq);
    }
    expect(seen.size).toBe(100);
    expect(api).not.toHaveBeenCalled();
  });
  it("refuses an address with unavailable logs instead of presenting a successful check", async () => {
    const draw = fixture.pulls[0]!;
    const rpc = rpcFor(draw);
    vi.mocked(rpc.getTransaction).mockResolvedValue(null);
    expect(await loadVerify(rpc, draw.pull)).toBeNull();
  });
});
