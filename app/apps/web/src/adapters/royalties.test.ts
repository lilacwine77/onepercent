import { describe, expect, it } from "vitest";
import type { MeResponse } from "@onepercent/sdk/api";
import { RoyaltiesResponse } from "@onepercent/web-api";
import { count, pctBps, short, sol, t } from "@onepercent/copy";
import { PACK_SPLIT_BPS } from "@onepercent/config/web";
import { royaltyDigest, royaltyRows } from "./royalties";

const royalties: MeResponse["royalties"] = {
  count24h: 2,
  lamports24h: "4000000",
  total: "6000000",
  settlementReceipts: { lamports24h: "4812800", total: "7219200" },
};
const mint = "So11111111111111111111111111111111111111112";
const row = {
  seq: "18446744073709551615",
  pack: 0,
  lamports: "2000000",
  edition: "original",
  mint,
  sig: "1".repeat(64),
  ts: 1800000000,
  redirected: false,
};

describe("royalty display adapter", () => {
  it("uses the indexed 24-hour royalty total rather than combined receipts", () => {
    expect(royaltyDigest(royalties)).toBe(
      t("royalty.digest.other", {
        n: count(royalties.count24h),
        sol: sol(BigInt(royalties.lamports24h!)),
      }),
    );
    expect(royaltyDigest({ ...royalties, count24h: 1 })).toBe(
      t("royalty.digest.one", { sol: sol(BigInt(royalties.lamports24h!)) }),
    );
  });

  it("does not invent royalties for partial settlements or absent data", () => {
    expect(royaltyDigest(null)).toBeNull();
    expect(royaltyDigest({ ...royalties, lamports24h: null })).toBeNull();
    expect(royaltyDigest({ ...royalties, count24h: 0, lamports24h: "0" })).toBe(
      t("royalty.none"),
    );
  });

  it("links exact u64 sequences to Verify and uses a truthful mint fallback", () => {
    const result = royaltyRows(RoyaltiesResponse.parse([row]));
    expect(result[0]?.href).toBe(`/verify/${row.seq}`);
    expect(result[0]?.text).toContain(short(mint));
    expect(result[0]?.text).toContain(row.seq);
    expect(result[0]?.text).toContain(sol(2_000_000n));
  });

  it("uses redirected copy without claiming SOL arrived and keeps duplicate card rows", () => {
    const result = royaltyRows(
      RoyaltiesResponse.parse([row, row, { ...row, redirected: true }]),
    );
    expect(new Set(result.map((item) => item.id)).size).toBe(3);
    expect(result[2]?.text).toBe(
      t("royalty.redirected", {
        pct: pctBps(PACK_SPLIT_BPS.royaltyPerDustCard),
      }),
    );
    expect(result[2]?.text).not.toContain("+0.002");
    expect(royaltyRows(null)).toEqual([]);
  });
});
