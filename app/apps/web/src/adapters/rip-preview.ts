import {
  count,
  depositCost,
  packPrice,
  ripTotal,
  short,
  solCost,
  solExact,
  t,
} from "@onepercent/copy";
import type { RipViewProps } from "../experience/index";

type Preview = Awaited<ReturnType<NonNullable<RipViewProps["onPrepare"]>>>;
export function ripPreview(input: {
  quantity: number;
  priceEach: bigint;
  costs: {
    price: bigint;
    drawFee: bigint;
    pullDeposit: bigint;
    binderDeposit: bigint;
    cardSlots: bigint;
    binderHeader: bigint;
  };
  networkFee: bigint;
  program: string;
  referrer?: string;
  settleCount?: number;
  settleFee?: bigint;
}): Preview {
  const { costs } = input;
  const settleCount = input.settleCount ?? 0;
  const settleFee = input.settleFee ?? 0n;
  const transactions = count(settleCount + 1);
  const deposits = costs.pullDeposit + costs.binderDeposit;
  return {
    lines: [
      {
        label: t("rip.preview.price", {
          n: count(input.quantity),
          each: packPrice(input.priceEach),
        }),
      },
      {
        label: t("rip.preview.drawFee", { sol: solExact(costs.drawFee) }),
        note: t("rip.preview.drawFeeNote"),
      },
      {
        label: t("rip.preview.deposits", { sol: depositCost(deposits) }),
        note: t("rip.preview.depositsNote"),
      },
      {
        label: t("rip.preview.networkEstimate", {
          sol: solCost(input.networkFee + settleFee),
        }),
      },
    ],
    total: t("rip.preview.total", {
      sol: ripTotal(
        costs.price + costs.drawFee + deposits + input.networkFee + settleFee,
      ),
    }),
    approvals: t(
      settleCount ? "rip.preview.approvalsMax" : "rip.preview.approvals",
      {
        transactions: t("count.transactions", { n: transactions }),
        approvals: t("count.approvals", { n: transactions }),
      },
    ),
    program: input.program,
    details: [
      {
        label: t("rip.preview.pullDeposit", {
          sol: solExact(costs.pullDeposit),
        }),
        note: t("rip.preview.pullNote"),
      },
      {
        label: t("rip.preview.slots", { sol: solExact(costs.cardSlots) }),
        note: t("rip.preview.slotsNote"),
      },
      ...(costs.binderHeader > 0n
        ? [
            {
              label: t("rip.preview.binder", {
                sol: solExact(costs.binderHeader),
              }),
              note: t("rip.preview.binderNote"),
            },
          ]
        : []),
      ...(input.referrer
        ? [{ label: t("rip.preview.referrer", { who: short(input.referrer) }) }]
        : []),
      ...(settleCount
        ? [
            {
              label: t("settle.prepend", {
                transactions: t("count.transactions", {
                  n: count(settleCount),
                }),
              }),
              note: t("settle.optional"),
            },
            { label: t("settle.fees", { sol: solExact(settleFee) }) },
          ]
        : []),
      { label: t("rip.preview.noHolder") },
    ],
  };
}
