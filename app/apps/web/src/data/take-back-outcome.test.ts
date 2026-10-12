// @vitest-environment node
import { webDeployment } from "./deployment";
import { describe, expect, it, vi } from "vitest";
import { PACK_EDITIONS, PACK_SPLIT_BPS } from "@onepercent/config/web";
import { BPS_DENOMINATOR } from "@onepercent/config";
import { parseOnepercentLogs } from "@onepercent/sdk/events";
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  type Connection,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import capture from "../../../../packages/sdk/src/verify/fixtures/validator-pulls.json";
import { readPulledRoyalty } from "./take-back-outcome";

const PROGRAM_ID = webDeployment().programId;
function fixture() {
  const row = capture.pulls[0]!;
  const events = parseOnepercentLogs({
    logs: row.callback.logs,
    err: null,
    programId: PROGRAM_ID.toBase58(),
  });
  const reveal = events.events.find((event) => event.name === "PackRevealed");
  if (!reveal || reveal.name !== "PackRevealed")
    throw new Error("Missing recorded PackRevealed");
  const pick = reveal.data.dust[0];
  const wallet = new PublicKey(pick.depositor);
  const entries = [
    { mint: new PublicKey(pick.mint), amount: pick.amount, depositor: wallet },
  ];
  const topPrograms = row.callback.logs.flatMap((line) => {
    const match = /^Program (\S+) invoke \[1\]$/.exec(line);
    return match ? [new PublicKey(match[1]!)] : [];
  });
  const transaction: VersionedTransactionResponse = {
    slot: row.callback.slot,
    blockTime: null,
    meta: {
      err: null,
      fee: 0,
      preBalances: [],
      postBalances: [],
      logMessages: [...row.callback.logs],
    },
    transaction: {
      signatures: [row.callbackSignature],
      message: new TransactionMessage({
        payerKey: wallet,
        recentBlockhash: PublicKey.default.toBase58(),
        instructions: topPrograms.map(
          (programId) =>
            new TransactionInstruction({
              programId,
              keys: [],
              data: Buffer.alloc(0),
            }),
        ),
      }).compileToLegacyMessage(),
    },
    version: "legacy",
  };
  const getSignaturesForAddress = vi.fn(async () => [
    {
      signature: row.callbackSignature,
      slot: row.callback.slot,
      err: null,
      memo: null,
      blockTime: null,
    },
  ]);
  const getTransaction = vi.fn(async () => transaction);
  const rpc = {
    getSignaturesForAddress,
    getTransaction,
  } as unknown as Connection;
  return {
    rpc,
    wallet,
    entries,
    observedSlot: row.callback.slot - 1,
    getSignaturesForAddress,
    getTransaction,
    transaction,
    reveal: reveal.data,
  };
}

describe("evidence for a card pulled during take-back", () => {
  it("reads a bounded successful SDK event and returns that edition's royalty", async () => {
    const f = fixture();
    const edition = PACK_EDITIONS.find(
      (entry) => entry.index === f.reveal.edition,
    )!;
    expect(
      await readPulledRoyalty(f.rpc, f.wallet, f.entries, f.observedSlot),
    ).toBe(
      (edition.priceLamports * BigInt(PACK_SPLIT_BPS.royaltyPerDustCard)) /
        BigInt(BPS_DENOMINATOR),
    );
    expect(f.getSignaturesForAddress).toHaveBeenCalledWith(
      expect.any(PublicKey),
      { limit: 2, minContextSlot: f.observedSlot },
      "confirmed",
    );
    expect(f.getTransaction).toHaveBeenCalledWith(
      f.transaction.transaction.signatures[0],
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    );
  });
  it("never substitutes an old receipt for a disappearance after the observed Deck", async () => {
    const f = fixture();
    expect(
      await readPulledRoyalty(f.rpc, f.wallet, f.entries, f.transaction.slot),
    ).toBeNull();
    expect(f.getTransaction).not.toHaveBeenCalled();
  });
  it("requires exact depositor, mint and amount, and a separate pick per missing entry", async () => {
    const f = fixture();
    for (const entries of [
      [{ ...f.entries[0]!, amount: f.entries[0]!.amount + 1n }],
      [{ ...f.entries[0]!, mint: Keypair.generate().publicKey }],
      [{ ...f.entries[0]!, depositor: Keypair.generate().publicKey }],
      Array.from({ length: f.reveal.dust.length + 1 }, () => f.entries[0]!),
    ])
      expect(
        await readPulledRoyalty(f.rpc, f.wallet, entries, f.observedSlot),
      ).toBeNull();
  });
  it("refuses failed, foreign, truncated and mismatched transaction evidence", async () => {
    const changes: ((f: ReturnType<typeof fixture>) => void)[] = [
      (f) => {
        f.transaction.meta!.err = "AccountNotFound";
      },
      (f) => {
        f.transaction.meta!.logMessages = f.transaction.meta!.logMessages!.map(
          (line) =>
            line.replaceAll(
              PROGRAM_ID.toBase58(),
              PublicKey.default.toBase58(),
            ),
        );
      },
      (f) => {
        f.transaction.meta!.logMessages!.push("Log truncated");
      },
      (f) => {
        f.transaction.transaction.signatures = ["unrelated"];
      },
      (f) => {
        f.transaction.slot += 1;
      },
      (f) => {
        f.transaction.meta!.logMessages = [];
      },
    ];
    for (const change of changes) {
      const f = fixture();
      change(f);
      expect(
        await readPulledRoyalty(f.rpc, f.wallet, f.entries, f.observedSlot),
      ).toBeNull();
    }
  });
  it("returns unknown when receipt lookup is unavailable or no entry is missing", async () => {
    const f = fixture();
    f.getTransaction.mockRejectedValue(new Error("offline"));
    expect(
      await readPulledRoyalty(f.rpc, f.wallet, f.entries, f.observedSlot),
    ).toBeNull();
    expect(
      await readPulledRoyalty(f.rpc, f.wallet, [], f.observedSlot),
    ).toBeNull();
  });
});
