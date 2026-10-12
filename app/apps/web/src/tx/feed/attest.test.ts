// @vitest-environment node
import { webDeployment } from "../../data/deployment";
import { describe, expect, it, vi, afterEach } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ATTESTATIONS, PROGRAM_IDS } from "@onepercent/config";
import {
  bagsHash,
  feedMessage,
  feedNonces,
  type PlannedFeedBag,
} from "@onepercent/sdk";
import type { FeedAttestResponse } from "@onepercent/sdk/api";
import { requestAttest, validateAttest } from "./attest";

const PROGRAM_ID = webDeployment().programId;
function fixture() {
  const wallet = Keypair.generate().publicKey;
  const signer = Keypair.generate().publicKey;
  const chunks: PlannedFeedBag[][] = Array.from({ length: 2 }, () => [
    {
      mint: Keypair.generate().publicKey,
      source: Keypair.generate().publicKey,
      tokenProgram: new PublicKey(PROGRAM_IDS.splToken),
      amount: 12n,
      decimals: 6,
      vaultExists: true,
      closeSource: true,
    },
  ]);
  const nonceBase = 5;
  const nonceBits = 1;
  const expiry = 1_000n + BigInt(ATTESTATIONS.feedTtlSeconds) - 10n;
  const nonces = feedNonces(nonceBase, nonceBits, chunks.length);
  const response: FeedAttestResponse = {
    wallet: wallet.toBase58(),
    signer: signer.toBase58(),
    snapshotSlot: 90,
    asOfSlot: 100,
    refused: [],
    attestations: chunks.map((bags, chunk) => ({
      chunk,
      nonce: nonces[chunk]!,
      expiry: Number(expiry),
      bagsHash: bagsHash(bags).toString("hex"),
      message: feedMessage({
        programId: PROGRAM_ID,
        wallet,
        nonce: nonces[chunk]!,
        expiry,
        bags,
      }).toString("base64"),
      signature: Buffer.alloc(64, 1).toString("base64"),
      bags: bags.map((bag) => ({
        mint: bag.mint.toBase58(),
        source: bag.source.toBase58(),
        tokenProgram: bag.tokenProgram.toBase58(),
        amount: bag.amount.toString(),
        decimals: bag.decimals,
        mergeFrom: [],
      })),
    })),
  };
  return {
    wallet,
    signer,
    snapshotSlot: 90n,
    minSlot: 100,
    now: 1_000n,
    nonceBase,
    nonceBits,
    chunks,
    response,
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("intake attestation binding", () => {
  it("binds wallet, live signer, snapshot, balance, source and nonce window", () => {
    const f = fixture();
    const result = validateAttest(f);
    expect(result.map((item) => item.nonce)).toEqual(
      feedNonces(f.nonceBase, f.nonceBits, 2),
    );
    expect(result[0]?.bags).toEqual(f.chunks[0]);
  });

  it("accepts an isolated refusal without dropping eligible sibling chunks", () => {
    const f = fixture();
    f.response.refused = [
      {
        mint: f.chunks[1]![0]!.mint.toBase58(),
        reason: "evidence_unavailable",
        date: null,
      },
    ];
    f.response.attestations.pop();
    expect(validateAttest(f)).toHaveLength(1);
  });

  it("rejects changed identities, stale reads, omitted bags and repeated refusals", () => {
    const changes: ((f: ReturnType<typeof fixture>) => void)[] = [
      (f) => {
        f.response.wallet = f.signer.toBase58();
      },
      (f) => {
        f.response.signer = f.wallet.toBase58();
      },
      (f) => {
        f.response.snapshotSlot -= 1;
      },
      (f) => {
        f.response.asOfSlot -= 1;
      },
      (f) => {
        f.response.attestations.pop();
      },
      (f) => {
        f.response.refused = [
          { mint: f.signer.toBase58(), reason: "not_supported", date: null },
        ];
      },
      (f) => {
        const refused = {
          mint: f.chunks[0]![0]!.mint.toBase58(),
          reason: "not_supported" as const,
          date: null,
        };
        f.response.refused = [refused, refused];
      },
    ];
    for (const change of changes) {
      const f = fixture();
      change(f);
      expect(() => validateAttest(f)).toThrow();
    }
  });

  it("rejects changed amounts, merge sources, hashes, signatures and nonce order", () => {
    const changes: ((f: ReturnType<typeof fixture>) => void)[] = [
      (f) => {
        f.response.attestations[0]!.bags[0]!.amount = "13";
      },
      (f) => {
        f.response.attestations[0]!.bags[0]!.source = f.signer.toBase58();
      },
      (f) => {
        f.response.attestations[0]!.bags[0]!.tokenProgram =
          PROGRAM_IDS.token2022;
      },
      (f) => {
        f.response.attestations[0]!.bags[0]!.decimals += 1;
      },
      (f) => {
        f.response.attestations[0]!.bags[0]!.mergeFrom.push(
          f.signer.toBase58(),
        );
      },
      (f) => {
        f.response.attestations[0]!.bagsHash = "0".repeat(64);
      },
      (f) => {
        f.response.attestations[0]!.message =
          Buffer.alloc(32).toString("base64");
      },
      (f) => {
        f.response.attestations[0]!.signature =
          Buffer.alloc(64).toString("base64");
      },
      (f) => {
        f.response.attestations[0]!.signature = Buffer.alloc(63, 1).toString(
          "base64",
        );
      },
      (f) => {
        f.response.attestations[0]!.nonce += 1;
      },
      (f) => {
        f.response.attestations.reverse();
      },
    ];
    for (const change of changes) {
      const f = fixture();
      change(f);
      expect(() => validateAttest(f)).toThrow();
    }
  });

  it("rejects expired or overlong authorizations using chain time", () => {
    for (const expiry of [1_000, 1_001 + ATTESTATIONS.feedTtlSeconds]) {
      const f = fixture();
      f.response.attestations[0]!.expiry = expiry;
      expect(() => validateAttest(f)).toThrow("errors.tooLong");
    }
  });

  it("requests mint-only chunks through the shared D22 schema", async () => {
    const f = fixture();
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(JSON.stringify(f.response), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);
    expect((await requestAttest(f.wallet, f.chunks)).asOfSlot).toBe(100);
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/feed/attest");
    const body = JSON.parse(
      (fetch.mock.calls[0]?.[1] as RequestInit).body as string,
    );
    expect(body).toEqual({
      wallet: f.wallet.toBase58(),
      chunks: f.chunks.map((bags) =>
        bags.map((bag) => ({ mint: bag.mint.toBase58() })),
      ),
    });
  });
});
