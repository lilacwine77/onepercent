// @vitest-environment node
import { webDeployment } from "../../data/deployment";
import { describe, expect, it } from "vitest";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  EXTERNAL_IDS,
  FEED_BYTE_BUDGET,
  serializedSize,
  userAta,
  type PlannedFeedBag,
} from "@onepercent/sdk";
import type { ChainTokenAccount } from "../../data/feed-chain";
import { approvalCount, closePlan, feedChunks } from "./plan";

const PROGRAM_ID = webDeployment().programId;
const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const wallet = key(1);
function bag(n: number): PlannedFeedBag {
  const mint = key(n + 2);
  return {
    mint,
    amount: 100n,
    tokenProgram: EXTERNAL_IDS.splToken,
    source: userAta(wallet, mint, EXTERNAL_IDS.splToken),
    decimals: 6,
    vaultExists: false,
    closeSource: true,
  };
}
describe("Feed byte planning", () => {
  it.each([1, 2, 8, 9, 16, 25])(
    "previews %i bags without spending the nonce window",
    async (count) => {
      const plans = await feedChunks({
        wallet,
        bags: Array.from({ length: count }, (_, n) => bag(n)),
        signer: key(99),
        nonceBase: 20,
        nonceBits: 0xffff,
        price: 1n,
        blockhash: key(98).toBase58(),
      });
      expect(plans.flatMap((plan) => plan.bags)).toHaveLength(count);
      for (const plan of plans) {
        expect(serializedSize(plan.transaction)).toBeLessThanOrEqual(
          FEED_BYTE_BUDGET,
        );
        const tx = plan.transaction as Transaction;
        expect(
          tx.instructions.filter((ix) => ix.programId.equals(PROGRAM_ID)),
        ).toHaveLength(1);
        expect(tx.compileMessage().header.numRequiredSignatures).toBe(1);
      }
      expect(approvalCount(plans.length, 8)).toBe(Math.ceil(plans.length / 8));
    },
  );
  it("reserves compute space while packing empty closes and rejects foreign accounts", () => {
    const empties = Array.from(
      { length: 40 },
      (_, n) =>
        ({
          address: key(n + 5),
          owner: wallet,
          tokenProgram: EXTERNAL_IDS.splToken,
          amount: 0n,
          closeAuthority: null,
          closable: true,
        }) as ChainTokenAccount,
    );
    const transactions = closePlan(wallet, empties, key(98).toBase58());
    expect(transactions.length).toBeGreaterThan(1);
    expect(transactions.flatMap((tx) => tx.instructions.slice(2))).toHaveLength(
      40,
    );
    expect(
      transactions.every((tx) => serializedSize(tx) <= FEED_BYTE_BUDGET),
    ).toBe(true);
    expect(() =>
      closePlan(
        wallet,
        [{ ...empties[0]!, owner: key(100) }],
        key(98).toBase58(),
      ),
    ).toThrow("Unsafe");
  });
});
