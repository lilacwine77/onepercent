import { PACK_EDITIONS, PACK_SPLIT_BPS } from "@onepercent/config/web";
import { count, pctBps, short, sol, t, ticker } from "@onepercent/copy";
import type { MeResponse } from "@onepercent/sdk/api";
import type { RoyaltiesResponse } from "@onepercent/web-api";
import type { z } from "zod";

export type RoyaltyHistory = z.infer<typeof RoyaltiesResponse>;

export function royaltyDigest(
  royalties: MeResponse["royalties"] | null,
): string | null {
  if (!royalties || royalties.lamports24h === null) return null;
  if (royalties.count24h === 0) return t("royalty.none");
  return royalties.count24h === 1
    ? t("royalty.digest.one", { sol: sol(BigInt(royalties.lamports24h)) })
    : t("royalty.digest.other", {
        n: count(royalties.count24h),
        sol: sol(BigInt(royalties.lamports24h)),
      });
}

export function royaltyRows(
  history: RoyaltyHistory | null,
  symbols: Readonly<Record<string, string>> = {},
) {
  return (history ?? []).map((row, index) => {
    const edition = PACK_EDITIONS.find((item) => item.id === row.edition);
    if (!edition) throw new Error("Unknown royalty edition");
    return {
      id: `${row.seq}:${row.pack}:${row.mint}:${row.sig}:${index}`,
      href: `/verify/${row.seq}`,
      timestamp: row.ts,
      redirected: row.redirected,
      text: row.redirected
        ? t("royalty.redirected", {
            pct: pctBps(PACK_SPLIT_BPS.royaltyPerDustCard),
          })
        : t("royalty.row", {
            edition: edition.name,
            seq: count(row.seq, false),
            ticker: symbols[row.mint]
              ? ticker(symbols[row.mint]!, row.mint)
              : short(row.mint),
            sol: sol(row.lamports),
          }),
    };
  });
}
