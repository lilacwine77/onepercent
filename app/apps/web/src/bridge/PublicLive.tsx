import { deploymentChain } from "../data/deployment";
import { useEffect, useMemo, useState } from "react";
import { PACK_EDITIONS, WEB } from "@onepercent/config";
import { amount, countdown } from "@onepercent/copy";
import { decodeStreamEvent } from "@onepercent/sdk/api";
import { LIVE_FLAGS, PHASE } from "@onepercent/sdk/constants";
import { fairnessEdition, oddsTableHash } from "../adapters/odds";
import { specialLiveFlags, tokenModel } from "../adapters/token";
import { liveModel } from "../adapters/live";
import { tvEvents } from "../adapters/tv-events";
import { preloadModule } from "../app/lazy-module";
import { useConfig, useWebConfig } from "../data/config";
import { useFlag } from "../data/flags";
import {
  loadHighlights,
  loadLiveTiles,
  loadPublicMachine,
  loadTrust,
} from "../data/public-machine";
import { resource, useResource } from "../data/resource";
import { createRpc } from "../data/rpc";
import type { TransportEvent } from "../data/stream";
import { liveStream, useLive } from "../data/use-live";
import { loadVerify } from "../data/verify";
import { FeedShape, loadPublic, type PublicViewProps } from "../experience";
import { ExperienceSlot } from "./ExperienceSlot";

const chainResource = resource("/chain/public-machine", () =>
  loadPublicMachine(createRpc()),
);
const totalsResource = resource("/api/machine/public", loadLiveTiles);
const highlightsResource = (window: "today" | "season") =>
  resource(`/api/highlights?window=${window}`, (signal) =>
    loadHighlights(window, signal),
  );
const emptyProof = { loading: true, error: false, data: null };
export const ready = () => preloadModule(loadPublic);

function useBase() {
  const config = useConfig();
  const web = useWebConfig();
  const admin = web.data?.adminMultisig ?? null;
  const trustRead = useResource(
    resource(`/chain/trust/${admin ?? "none"}`, () =>
      loadTrust(createRpc(), admin),
    ),
  );
  const trust = trustRead.error ? null : (trustRead.data ?? null);
  let cluster: "mainnet" | "devnet" =
    import.meta.env.VITE_CLUSTER === "mainnet" ? "mainnet" : "devnet";
  try {
    cluster = deploymentChain() === "solana:mainnet" ? "mainnet" : "devnet";
  } catch {
    // Base odds stay public before a deployment exists. Chain data stays unavailable.
  }
  return {
    config,
    trust,
    cluster,
  };
}
function Frame(props: PublicViewProps) {
  return (
    <ExperienceSlot
      load={loadPublic}
      props={props}
      component={props.kind === "fairness" ? "verify" : props.kind}
      poster={<FeedShape />}
      placeholder={<FeedShape />}
    />
  );
}
function VerifyLive({ identifier }: { identifier: string }) {
  const base = useBase();
  const paramsHash = base.config.data?.paramsHash ?? null;
  const [revision, refresh] = useState(0);
  const [read, setRead] = useState<{
    loading: boolean;
    error: boolean;
    data: Awaited<ReturnType<typeof loadVerify>>;
  }>(emptyProof);
  useEffect(() => {
    let active = true;
    setRead(emptyProof);
    void loadVerify(createRpc(), identifier, paramsHash).then(
      (data) => active && setRead({ loading: false, error: false, data }),
      () => active && setRead({ loading: false, error: true, data: null }),
    );
    return () => {
      active = false;
    };
  }, [identifier, paramsHash, revision]);
  const result = read.data;
  const data: Extract<PublicViewProps, { kind: "verify" }>["data"] = result
    ? {
        seq: result.seq,
        source: result.source,
        refunded: result.refunded,
        matches: result.check?.ok ?? null,
        seed: result.check?.callerSeed.matches ?? null,
        slot: result.revealedSlot,
        order: result.revealOrder,
        tableHash: result.tableHash,
        paramsHash: result.paramsHash,
        request: result.links.request,
        callback: result.links.callback,
        settles: result.links.settles,
        packs: result.packs.map((pack) => {
          const checked = result.check?.packs.find(
            (row) => row.pack === pack.pack,
          );
          return {
            index: pack.pack,
            kind: pack.kind,
            matches: checked?.ok ?? false,
            draw: pack.t,
            widths: pack.widths,
            bucket: pack.hitBucket,
            dust: checked?.dust ?? [],
          };
        }),
      }
    : null;
  return (
    <Frame
      kind="verify"
      identifier={identifier}
      data={data}
      cluster={base.cluster}
      trust={base.trust}
      loading={read.loading}
      error={read.error}
      stale={false}
      asOfSlot={result?.revealedSlot ?? null}
      onRefresh={() => refresh((value) => value + 1)}
    />
  );
}
function FairnessLive() {
  const base = useBase();
  const chain = useResource(chainResource);
  const holderBoost = useFlag("HOLDER_BOOST");
  const [edition, setEdition] = useState(0);
  const [tableHash, setTableHash] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setTableHash(null);
    void oddsTableHash(edition).then(
      (hash) => active && setTableHash(hash),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [edition]);
  const current = chain.data && !chain.error ? chain.data : null;
  const flags = current
    ? specialLiveFlags(
        current.machine,
        PACK_EDITIONS[edition]!.priceLamports,
        current.nowSeconds,
      )
    : LIVE_FLAGS.onePct | LIVE_FLAGS.jackpot;
  const model = fairnessEdition(edition, flags, holderBoost);
  return (
    <Frame
      kind="fairness"
      cluster={base.cluster}
      trust={base.trust}
      loading={chain.loading}
      error={Boolean(chain.error)}
      stale={Boolean(chain.data && chain.error)}
      asOfSlot={chain.data?.asOfSlot ?? null}
      onRefresh={() => void chainResource.refresh()}
      data={{
        edition,
        liveKnown: current !== null,
        salesClosed: Boolean(
          current &&
          (current.machine.phase >= PHASE.buysClosed ||
            (current.machine.end_ts > 0n &&
              current.nowSeconds >= current.machine.end_ts)),
        ),
        rows: model.rows.map((row, index) => ({
          ...row,
          probability: `${amount(BigInt(row.ppb), 7)}%`,
          holderProbability: model.holderRows
            ? `${amount(BigInt(model.holderRows[index]!.ppb), 7)}%`
            : null,
        })),
        tableHash,
        paramsHash: base.config.data?.paramsHash ?? null,
        onEdition: setEdition,
      }}
    />
  );
}
function TokenLive() {
  const base = useBase();
  const chain = useResource(chainResource);
  return (
    <Frame
      kind="token"
      cluster={base.cluster}
      trust={base.trust}
      loading={chain.loading}
      error={Boolean(chain.error)}
      stale={Boolean(chain.data && chain.error)}
      asOfSlot={chain.data?.asOfSlot ?? null}
      onRefresh={() => void chainResource.refresh()}
      data={
        chain.data
          ? tokenModel(
              chain.data.config,
              chain.data.machine,
              chain.data.nowSeconds,
            )
          : null
      }
    />
  );
}
function MachineLive() {
  const base = useBase();
  const chain = useResource(chainResource);
  const totals = useResource(totalsResource);
  const [window, setWindow] = useState<"today" | "season">("today");
  const highlights = useResource(highlightsResource(window));
  const enabled = useFlag("TV_LIVE");
  const [events, setEvents] = useState<TransportEvent[]>([]);
  const signal = useLive(enabled);
  useEffect(() => {
    const receive = () => {
      const event = liveStream.snapshot().lastEvent;
      if (!event) return;
      try {
        decodeStreamEvent(event);
      } catch {
        return;
      }
      setEvents((previous) =>
        previous.some((item) => item.id === event.id)
          ? previous
          : [...previous, event].slice(-WEB.streamDedupeMax),
      );
    };
    const release = liveStream.subscribe(receive);
    receive();
    return release;
  }, []);
  const model =
    totals.data && chain.data
      ? liveModel(
          totals.data,
          chain.data.machine,
          chain.data.nowSeconds,
          signal,
          events,
        )
      : null;
  const entries = useMemo(() => tvEvents(events), [events]);
  return (
    <Frame
      kind="live"
      cluster={base.cluster}
      trust={base.trust}
      loading={chain.loading || totals.loading}
      error={Boolean(chain.error || totals.error)}
      stale={Boolean(
        (chain.error && chain.data) || (totals.error && totals.data),
      )}
      asOfSlot={totals.data?.asOfSlot ?? chain.data?.asOfSlot ?? null}
      onRefresh={() => {
        void chainResource.refresh();
        void totalsResource.refresh();
        void highlightsResource(window).refresh();
      }}
      data={{
        totals: totals.data
          ? {
              stockLamports: BigInt(totals.data.stock.book),
              deckCards: totals.data.deck.len,
              pendingPulls: BigInt(totals.data.pendingPulls),
              jackpotTokens: BigInt(totals.data.jackpot.tokens),
            }
          : null,
        window,
        highlights: highlights.error
          ? null
          : (highlights.data?.map((entry) => ({
              ...entry,
              seq: entry.seq.toString(),
              hitValueLamports: entry.hitValueLamports.toString(),
            })) ?? null),
        tv: {
          enabled,
          onAir: signal.onAir,
          state: chain.error ? null : (model?.tv.state ?? null),
          countdown:
            model?.tv.countdownTo && chain.data
              ? countdown(Number(model.tv.countdownTo - chain.data.nowSeconds))
              : null,
          events: entries,
        },
        onWindow: setWindow,
      }}
    />
  );
}
export default function PublicLive({
  kind,
  identifier = "",
}: {
  kind: PublicViewProps["kind"];
  identifier?: string;
}) {
  if (kind === "verify") return <VerifyLive identifier={identifier} />;
  if (kind === "fairness") return <FairnessLive />;
  if (kind === "token") return <TokenLive />;
  return <MachineLive />;
}
