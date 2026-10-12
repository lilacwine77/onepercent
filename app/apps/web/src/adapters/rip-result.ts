import { HIT_TIERS, TOKEN_1PCT } from "@onepercent/config";
import { amount, cardTicker, sol, t } from "@onepercent/copy";
import type { PackRevealed } from "@onepercent/sdk/events";
import type { ValuesOutput } from "@onepercent/web-api";
import type { RipResult } from "../experience/index";

export function ripResult(
  pack: PackRevealed,
  display: ValuesOutput,
  sell?: { payout: bigint; reason?: string },
): RipResult {
  const tiers = [
    ...HIT_TIERS.map((tier) => tier.id),
    "jackpot",
    "one_pct",
  ] as const;
  const tier = tiers[pack.tier - 1] as RipResult["hit"]["tier"] | undefined;
  if (!tier) throw new Error("Unsupported reveal tier");
  const info = (mint: string, units: bigint) =>
    display.items.find((item) => item.mint === mint && item.amount === units);
  const token = (mint: string, units: bigint) => {
    const item = info(mint, units);
    return {
      symbol: cardTicker(item?.symbol ?? "", mint),
      amountUi:
        item?.decimals === null || item?.decimals === undefined
          ? t("common.noValue")
          : amount(units, item.decimals),
      logoUrl: item?.logo ?? "",
      valueSolUi:
        item?.value.status === "ok" && item.value.label === "if_sold_now"
          ? sol(BigInt(item.value.lamports))
          : null,
    };
  };
  const hit = token(pack.hit_mint, pack.hit_amount);
  const stocked = HIT_TIERS.some((item) => item.id === tier);
  return {
    dust: pack.dust.map((pick, index) => ({
      ...token(pick.mint, pick.amount),
      house: (pack.house_mask & (1 << index)) !== 0,
      fedBy: pick.depositor,
      actions: [],
    })),
    hit: {
      ...hit,
      tier,
      symbol: stocked ? hit.symbol : TOKEN_1PCT.symbol,
      valueSolUi: stocked ? null : hit.valueSolUi,
      ...(stocked && sell
        ? { sellBackSolUi: sol(sell.payout), sellBackReason: sell.reason }
        : {}),
      actions: stocked && sell ? ["sell_back", "my_cards"] : ["my_cards"],
    },
    verifyUrl: `/verify/${pack.seq}`,
  };
}
