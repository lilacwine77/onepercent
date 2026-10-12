import {
  BPS_DENOMINATOR,
  HIT_ODDS,
  HIT_TIERS,
  PACK_EDITIONS,
  PPB_DENOMINATOR,
  SELL_BACK,
} from "@onepercent/config";
import { bytesToHex, segments } from "@onepercent/sdk/browser";
import { LIVE_FLAGS } from "@onepercent/sdk/constants";

export interface OddsRow {
  id: string;
  ppb: number;
  live: boolean;
  oneIn: number | null;
  transferredToSilver: boolean;
}

/** Uses the same integer widths as the SDK and excludes the unused segment. */
export function oddsRows(
  edition: number,
  liveFlags: number,
  holder = false,
): OddsRow[] {
  const widths = segments(edition, liveFlags, holder);
  const rows = HIT_ODDS.walkOrder.flatMap((id, index) =>
    id === "spotlight"
      ? []
      : [
          {
            id,
            ppb: widths[index]!,
            live: widths[index]! > 0,
            oneIn: widths[index]! > 0 ? PPB_DENOMINATOR / widths[index]! : null,
            transferredToSilver:
              (id === "one_pct" || id === "jackpot") && widths[index] === 0,
          },
        ],
  );
  const ppb =
    PPB_DENOMINATOR - widths.reduce((total, width) => total + width, 0);
  return [
    ...rows,
    {
      id: "silver",
      ppb,
      live: true,
      oneIn: PPB_DENOMINATOR / ppb,
      transferredToSilver: false,
    },
  ];
}

export function fairnessEdition(
  edition: number,
  liveFlags: number,
  holderBoost: boolean,
) {
  const selected = PACK_EDITIONS[edition];
  if (!selected) throw new RangeError("Unknown edition");
  const rows = oddsRows(edition, liveFlags);
  const stockExpectedNumerator = rows.reduce((total, row) => {
    const tier = HIT_TIERS.find(({ id }) => id === row.id);
    return total + BigInt(row.ppb) * BigInt(tier?.valueBps ?? 0);
  }, 0n);
  return {
    edition: selected,
    rows,
    holderRows: holderBoost ? oddsRows(edition, liveFlags, true) : null,
    stockExpectedNumerator,
    stockExpectedDenominator: BigInt(PPB_DENOMINATOR) * BigInt(BPS_DENOMINATOR),
    sellExpectedNumerator: stockExpectedNumerator * BigInt(SELL_BACK.payoutBps),
    sellExpectedDenominator:
      BigInt(PPB_DENOMINATOR) * BigInt(BPS_DENOMINATOR) ** 2n,
    realized: null,
  };
}

/** Fixed field order is the canonical JSON format, independent of live state. */
export function canonicalOddsTable(edition: number): string {
  const selected = PACK_EDITIONS[edition];
  if (!selected) throw new RangeError("Unknown edition");
  return JSON.stringify({
    edition: selected.id,
    priceLamports: selected.priceLamports.toString(),
    ppbDenominator: PPB_DENOMINATOR,
    rows: oddsRows(edition, LIVE_FLAGS.onePct | LIVE_FLAGS.jackpot).map(
      ({ id, ppb }) => ({ id, ppb }),
    ),
    holderRows: oddsRows(
      edition,
      LIVE_FLAGS.onePct | LIVE_FLAGS.jackpot,
      true,
    ).map(({ id, ppb }) => ({ id, ppb })),
  });
}

export async function oddsTableHash(edition: number): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalOddsTable(edition)),
  );
  return bytesToHex(new Uint8Array(digest));
}
