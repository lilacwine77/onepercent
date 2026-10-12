/** Local visual fixtures only. No route imports this module in production. */
import { useEffect, useState } from "react";
import { amount } from "@onepercent/copy";
import { LIVE_FLAGS } from "@onepercent/sdk/constants";
import { fairnessEdition, oddsTableHash } from "../../src/adapters/odds";
import { loadPublic, type PublicViewProps } from "../../src/experience";
import { preloadModule, lazyModule } from "../../src/app/lazy-module";

const View = lazyModule(loadPublic);
export const ready = () => preloadModule(loadPublic);
const mint = "So11111111111111111111111111111111111111112";
const transaction =
  "5YmdrLAUSAWQLCVytroAcESqhpyBjLSrtmkUZKtUX4YwHoGB1ySiXF8ZmUNksbfd33YAvFeCkYo1ACChRrnpXzjb";
const base = {
  cluster: "devnet" as const,
  loading: false,
  error: false,
  stale: false,
  asOfSlot: 100,
  trust: null,
  onRefresh() {},
};
export default function PublicFixture({
  kind,
  identifier = "42",
}: {
  kind: PublicViewProps["kind"];
  identifier?: string;
}) {
  const [edition, setEdition] = useState(0);
  const [window, setWindow] = useState<"today" | "season">("today");
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => {
    void oddsTableHash(edition).then(setHash);
  }, [edition]);
  const model = fairnessEdition(
    edition,
    LIVE_FLAGS.onePct | LIVE_FLAGS.jackpot,
    true,
  );
  if (kind === "fairness")
    return (
      <View
        {...base}
        kind={kind}
        data={{
          edition,
          liveKnown: true,
          rows: model.rows.map((row, index) => ({
            ...row,
            probability: `${amount(BigInt(row.ppb), 7)}%`,
            holderProbability: `${amount(BigInt(model.holderRows![index]!.ppb), 7)}%`,
          })),
          tableHash: hash,
          paramsHash:
            "a36f64a3588c2d70fb4c27b353e206b97107932817a7f4f8d567bb1cf434d0e3",
          onEdition: setEdition,
        }}
      />
    );
  if (kind === "verify")
    return (
      <View
        {...base}
        kind={kind}
        identifier={identifier}
        data={{
          seq: "42",
          source: "rpc",
          refunded: false,
          matches: true,
          seed: true,
          slot: 100,
          order: 1,
          tableHash: hash ?? "",
          paramsHash:
            "a36f64a3588c2d70fb4c27b353e206b97107932817a7f4f8d567bb1cf434d0e3",
          request: transaction,
          callback: transaction,
          settles: [transaction],
          packs: [
            {
              index: 0,
              kind: "holo",
              matches: true,
              draw: 7936182,
              widths: [100000, 0, 250000, 2500000, 20000000, 113925000],
              bucket: 2,
              dust: [
                { slot: 0, computed: 43, matches: true },
                { slot: 1, computed: 6, matches: true },
                { slot: 2, computed: 11, matches: true },
                { slot: 3, computed: 24, matches: true },
              ],
            },
          ],
        }}
      />
    );
  if (kind === "token")
    return (
      <View
        {...base}
        kind={kind}
        data={{
          mint,
          burnedTokens: 456000000000n,
          jackpot: {
            tokens: 18302500000000n,
            costLamports: 25000000000n,
            conversionLamports: 3400000000n,
          },
          onePct: [0, 1, 2, 3].map((index) => ({
            index,
            amount: 10000000000000n,
            state: index === 0 ? 2 : index === 1 ? 1 : 0,
            live: index === 1,
            releaseTs: 1788912000n + BigInt(index * 151200),
          })),
        }}
      />
    );
  return (
    <View
      {...base}
      kind="live"
      data={{
        totals: {
          stockLamports: 126340000000n,
          deckCards: 284,
          pendingPulls: 3n,
          jackpotTokens: 18302500000000n,
        },
        window,
        onWindow: setWindow,
        highlights: [
          {
            seq: "42",
            tier: "holo",
            who: mint,
            hitValueLamports: "2500000000",
            sig: transaction,
          },
        ],
        tv: {
          enabled: true,
          onAir: true,
          state: "onAir",
          countdown: null,
          events: [
            {
              id: "1",
              kind: "feed",
              who: "5Ym…jb",
              sig: transaction,
              announce: false,
            },
            {
              id: "2",
              kind: "pull",
              who: "So1…12",
              tier: "holo",
              sig: transaction,
              announce: true,
            },
          ],
        },
      }}
    />
  );
}
