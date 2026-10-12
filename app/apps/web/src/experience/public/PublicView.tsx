import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  GOVERNANCE,
  PACK_EDITIONS,
  PACK_SPLIT_BPS,
  TOKEN_1PCT,
  VRF,
} from "@onepercent/config";
import {
  amount,
  count,
  countUngrouped,
  dateUtc,
  pct,
  short,
  sol,
  solCost,
  t,
  timeUtc,
} from "@onepercent/copy";
import { FeedShape } from "../shapes/Shapes";
import type { LiveData, PublicViewProps, VerifyData } from "./types";
import "../shared/paper-panel.css";
import "./public.css";

const tier = (kind: string | null) => {
  switch (kind) {
    case "one_pct":
      return t("public.onePct");
    case "jackpot":
      return t("public.jackpot");
    case "dust":
      return t("public.dust");
    case "silver":
      return t("public.silver");
    case "blue":
      return t("public.blue");
    case "holo":
      return t("public.holo");
    case "black":
      return t("public.black");
    default:
      return t("public.unknown");
  }
};
const check = (matches: boolean | null) =>
  matches === null
    ? t("verify.unchecked")
    : matches
      ? t("verify.match")
      : t("verify.mismatch");
const explorer = (
  kind: "tx" | "account",
  value: string,
  cluster: PublicViewProps["cluster"],
) =>
  `https://solscan.io/${kind}/${encodeURIComponent(value)}${cluster === "devnet" ? "?cluster=devnet" : ""}`;
function Evidence({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="public-evidence">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function ProofLink({
  signature,
  label,
  cluster,
}: {
  signature: string;
  label: string;
  cluster: PublicViewProps["cluster"];
}) {
  return (
    <a
      href={explorer("tx", signature, cluster)}
      target="_blank"
      rel="noreferrer"
    >
      {label} ↗
    </a>
  );
}
function Verify({
  data,
  cluster,
}: {
  data: VerifyData;
  cluster: PublicViewProps["cluster"];
}) {
  const signatures: [string, string | null][] = [
    [t("verify.request"), data.request],
    [t("verify.callback"), data.callback],
    ...data.settles.map((sig, index): [string, string] => [
      t("verify.settle", { n: count(index + 1) }),
      sig,
    ]),
  ];
  return (
    <>
      <section
        className="feed-panel"
        data-verify-seq={data.seq}
        data-verify-state={
          data.refunded ? "refunded" : data.matches ? "verified" : "mismatch"
        }
        data-verify-seed={
          data.seed === null ? "unchecked" : data.seed ? "verified" : "mismatch"
        }
      >
        <p className="public-status" role="status">
          {data.refunded
            ? t("verify.refunded")
            : data.matches
              ? t("verify.passed")
              : t("verify.failed")}
        </p>
        <p>{data.source === "rpc" ? t("verify.rpc") : t("verify.indexer")}</p>
        <p>{t("verify.proof")}</p>
        <Evidence
          rows={[
            [t("verify.seed"), check(data.seed)],
            [
              t("verify.slot"),
              data.slot === null ? t("public.unknown") : count(data.slot),
            ],
            [
              t("verify.order"),
              data.order === null ? t("public.unknown") : count(data.order),
            ],
            [t("verify.tableHash"), <code>{data.tableHash}</code>],
            [
              t("verify.paramsHash"),
              data.paramsHash ? (
                <code>{data.paramsHash}</code>
              ) : (
                t("public.unknown")
              ),
            ],
          ]}
        />
      </section>
      {data.packs.map((pack) => (
        <section className="feed-panel" key={pack.index}>
          <h2>
            {t("verify.pack", { n: count(pack.index + 1) })} · {tier(pack.kind)}
          </h2>
          <Evidence
            rows={[
              [t("common.verify"), check(pack.matches)],
              [t("verify.draw"), count(pack.draw)],
              [
                t("verify.widths"),
                pack.widths.map((width) => count(width)).join(" · "),
              ],
              [t("verify.bucket"), count(pack.bucket)],
              ...pack.dust.map((dust): [string, ReactNode] => [
                t("verify.dust", { n: count(dust.slot + 1) }),
                `${count(dust.computed)} · ${check(dust.matches)}`,
              ]),
            ]}
          />
          <p>{t("verify.bucketNote")}</p>
        </section>
      ))}
      <section className="feed-panel">
        <h2>{t("verify.transactions")}</h2>
        <ul className="public-links">
          {signatures.map(([label, sig]) => (
            <li key={label}>
              {sig ? (
                <ProofLink signature={sig} label={label} cluster={cluster} />
              ) : (
                `${label}: ${t("public.unknown")}`
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
function Fairness({
  data,
}: {
  data: Extract<PublicViewProps, { kind: "fairness" }>["data"];
}) {
  const stock = (PACK_SPLIT_BPS.stock + PACK_SPLIT_BPS.jackpot) / 100;
  return (
    <>
      <section className="feed-panel">
        <div
          className="public-toolbar"
          role="group"
          aria-label={t("public.edition")}
        >
          {PACK_EDITIONS.map((edition) => (
            <button
              type="button"
              aria-pressed={data.edition === edition.index}
              key={edition.id}
              onClick={() => data.onEdition(edition.index)}
            >
              {edition.name}
            </button>
          ))}
        </div>
        <h2>{t("fairness.odds")}</h2>
        {!data.liveKnown && <p>{t("public.baseOdds")}</p>}
        {data.salesClosed && <p>{t("fairness.pendingDraws")}</p>}
        <div className="public-table-scroll">
          <table className="public-table">
            <thead>
              <tr>
                <th scope="col">{t("public.tier")}</th>
                <th scope="col">{t("fairness.probability")}</th>
                {data.rows.some((row) => row.holderProbability !== null) && (
                  <th scope="col">{t("fairness.holder")}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    {tier(row.id)}
                    {data.liveKnown &&
                      ["one_pct", "jackpot"].includes(row.id) && (
                        <small>
                          {row.transferredToSilver
                            ? t("public.notLive")
                            : t("public.liveNow")}
                        </small>
                      )}
                  </th>
                  <td>{row.probability}</td>
                  {row.holderProbability !== null && (
                    <td>{row.holderProbability}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="feed-panel">
        <h2>{t("fairness.design")}</h2>
        <p>{t("fairness.stocked", { pct: pct(stock) })}</p>
        <p>{t("fairness.realized")}</p>
      </section>
      <section className="feed-panel public-disclosures">
        <h2>{t("fairness.disclosures")}</h2>
        <ul className="public-disclosure-list">
          {(
            ["vrf", "state", "refund", "sell", "jackpot", "creator"] as const
          ).map((point) => (
            <li key={point}>
              <details>
                <summary>
                  <strong>{t(`fairness.${point}.title`)}</strong> ·{" "}
                  {t(`fairness.${point}.summary`)}
                </summary>
                <p>
                  {point === "refund"
                    ? t("fairness.refund", {
                        s: count(VRF.timeoutSeconds),
                        sol: solCost(VRF.feeLamports),
                      })
                    : t(`fairness.${point}`)}
                </p>
              </details>
            </li>
          ))}
        </ul>
      </section>
      <section className="feed-panel">
        <Evidence
          rows={[
            [
              t("verify.tableHash"),
              data.tableHash ? (
                <code>{data.tableHash}</code>
              ) : (
                t("public.unknown")
              ),
            ],
            [
              t("verify.paramsHash"),
              data.paramsHash ? (
                <code>{data.paramsHash}</code>
              ) : (
                t("public.unknown")
              ),
            ],
          ]}
        />
      </section>
    </>
  );
}
const tvState = (state: LiveData["tv"]["state"]) => {
  switch (state) {
    case "idle":
      return t("live.state.idle");
    case "countdown":
      return t("live.state.countdown");
    case "onAir":
      return t("live.state.onAir");
    case "lastCall":
      return t("live.state.lastCall");
    case "buysClosed":
      return t("live.state.buysClosed");
    case "finalPull":
      return t("live.state.finalPull");
    case "sealed":
      return t("live.state.sealed");
    default:
      return t("public.unknown");
  }
};
const eventText = (event: LiveData["tv"]["events"][number]) =>
  event.kind === "system"
    ? t("live.event.system")
    : event.kind === "feed"
      ? t("live.event.feed", { who: event.who })
      : t("live.event.pull", {
          who: event.who,
          title: tier(event.tier ?? null),
        });
function Broadcast({
  tv,
  cluster,
}: {
  tv: LiveData["tv"];
  cluster: PublicViewProps["cluster"];
}) {
  const [paused, setPaused] = useState(false);
  const frozen = useRef(tv.events);
  if (!paused) frozen.current = tv.events;
  const events = paused ? frozen.current : tv.events;
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef(new Set<string>());
  useEffect(() => {
    if (paused) return;
    const messages = tv.events.filter(
      (event) => event.announce && !announced.current.has(event.id),
    );
    tv.events.forEach((event) => announced.current.add(event.id));
    if (messages.length) setAnnouncement(messages.map(eventText).join(". "));
  }, [paused, tv.events]);
  return (
    <section className="feed-panel public-tv" aria-labelledby="broadcast-title">
      <div className="public-tv-art" aria-hidden="true">
        <img
          src="/experience/home/tv-768.webp"
          width="768"
          height="768"
          alt=""
          loading="lazy"
        />
      </div>
      <div>
        <div className="public-toolbar">
          <h2 id="broadcast-title">{t("live.tv")}</h2>
          <button
            type="button"
            aria-pressed={paused}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? t("common.resume") : t("common.pause")}
          </button>
        </div>
        <span className="public-signal" data-on-air={tv.enabled && tv.onAir}>
          {!tv.enabled
            ? t("live.disabled")
            : tv.onAir
              ? t("live.onAir")
              : t("live.offline")}
        </span>
        <p>
          {tvState(tv.state)}
          {tv.countdown !== null &&
            ` · ${t("live.countdown", { time: tv.countdown })}`}
        </p>
        {paused && <p>{t("live.paused")}</p>}
        <div
          role="log"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {announcement}
        </div>
        {events.length ? (
          <ol className="public-events">
            {events
              .slice(-5)
              .reverse()
              .map((event) => (
                <li key={event.id}>
                  <ProofLink
                    signature={event.sig}
                    label={eventText(event)}
                    cluster={cluster}
                  />
                </li>
              ))}
          </ol>
        ) : (
          <p>{t("live.waiting")}</p>
        )}
      </div>
    </section>
  );
}
function Live({
  data,
  cluster,
}: {
  data: LiveData;
  cluster: PublicViewProps["cluster"];
}) {
  return (
    <>
      {data.totals ? (
        <dl className="public-stats">
          {[
            [
              t("live.stock"),
              t("common.sol", { sol: sol(data.totals.stockLamports) }),
            ],
            [t("live.deck"), count(data.totals.deckCards)],
            [t("live.pending"), count(data.totals.pendingPulls)],
            [
              t("live.jackpot"),
              t("token.amount", {
                amount: amount(data.totals.jackpotTokens, TOKEN_1PCT.decimals),
              }),
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>{t("live.totalsUnavailable")}</p>
      )}
      <Broadcast tv={data.tv} cluster={cluster} />
      <section className="feed-panel">
        <div className="public-toolbar">
          <h2>{t("live.highlights")}</h2>
          <button
            type="button"
            aria-pressed={data.window === "today"}
            onClick={() => data.onWindow("today")}
          >
            {t("live.today")}
          </button>
          <button
            type="button"
            aria-pressed={data.window === "season"}
            onClick={() => data.onWindow("season")}
          >
            {t("live.season")}
          </button>
        </div>
        {data.highlights === null ? (
          <p>{t("live.highlightsUnavailable")}</p>
        ) : data.highlights.length ? (
          <ol className="public-events">
            {data.highlights.map((entry) => (
              <li key={`${entry.sig}:${entry.seq}`}>
                <a href={`/verify/${entry.seq}`}>
                  {t("live.highlight", {
                    who: short(entry.who),
                    title: tier(entry.tier),
                  })}
                </a>
                <small>
                  {t("live.highlightValue", {
                    sol: sol(BigInt(entry.hitValueLamports)),
                  })}
                </small>
              </li>
            ))}
          </ol>
        ) : (
          <p>{t("live.noHighlights")}</p>
        )}
      </section>
    </>
  );
}
function Token({
  data,
  cluster,
}: {
  data: Extract<PublicViewProps, { kind: "token" }>["data"];
  cluster: PublicViewProps["cluster"];
}) {
  if (!data) return null;
  return (
    <>
      <section className="feed-panel">
        <h2>{t("token.address")}</h2>
        {data.mint ? (
          <a
            className="public-address"
            href={explorer("account", data.mint, cluster)}
            target="_blank"
            rel="noreferrer"
          >
            {data.mint} ↗
          </a>
        ) : (
          <p>{t("token.before")}</p>
        )}
        <p>{t("token.launch")}</p>
      </section>
      <section className="feed-panel">
        <h2>{t("token.slots")}</h2>
        <p>{t("token.preceding")}</p>
        <div className="public-columns">
          {data.onePct.map((slot) => (
            <article
              className="public-slot"
              data-live={slot.live}
              key={slot.index}
            >
              <h3>{t("token.card", { n: count(slot.index + 1) })}</h3>
              <p>
                {t("token.amount", {
                  amount: amount(slot.amount, TOKEN_1PCT.decimals),
                })}
              </p>
              <b>
                {slot.live
                  ? t("public.liveNow")
                  : slot.state === 2
                    ? t("token.pulled")
                    : slot.state === 3
                      ? t("token.final")
                      : t("token.waiting")}
              </b>
              <p>
                {slot.releaseTs === null
                  ? t("token.releasePending")
                  : t("token.release", {
                      date: dateUtc(Number(slot.releaseTs) * 1000),
                      time: timeUtc(Number(slot.releaseTs) * 1000),
                    })}
              </p>
            </article>
          ))}
        </div>
      </section>
      <section className="feed-panel">
        <h2>{t("token.jackpot")}</h2>
        <Evidence
          rows={[
            [
              t("public.jackpot"),
              t("token.amount", {
                amount: amount(data.jackpot.tokens, TOKEN_1PCT.decimals),
              }),
            ],
            [
              t("token.jackpotCost"),
              t("common.sol", { sol: sol(data.jackpot.costLamports) }),
            ],
            [
              t("token.conversion"),
              t("common.sol", { sol: sol(data.jackpot.conversionLamports) }),
            ],
            [
              t("token.burned"),
              t("token.amount", {
                amount: amount(data.burnedTokens, TOKEN_1PCT.decimals),
              }),
            ],
          ]}
        />
        <p>{t("token.noEstimate")}</p>
      </section>
    </>
  );
}
export default function PublicView(props: PublicViewProps) {
  const title =
    props.kind === "verify"
      ? props.data
        ? t("verify.heading", { seq: countUngrouped(BigInt(props.data.seq)) })
        : t("common.verify")
      : props.kind === "fairness"
        ? t("nav.fairness")
        : props.kind === "live"
          ? t("nav.live")
          : t("nav.token");
  const intro =
    props.kind === "verify"
      ? t("verify.intro")
      : props.kind === "fairness"
        ? t("fairness.intro")
        : props.kind === "live"
          ? t("live.intro")
          : t("token.intro");
  return (
    <section className="public-page" data-public-view={props.kind}>
      <header className="public-head">
        <h1 tabIndex={-1}>{title}</h1>
        {props.kind === "verify" && !/^\d+$/.test(props.identifier) && (
          <p>
            <code>{short(props.identifier)}</code>
          </p>
        )}
        <p>{intro}</p>
      </header>
      <div className="public-stamp">
        {props.asOfSlot !== null && (
          <p>{t("public.updated", { s: count(props.asOfSlot) })}</p>
        )}
        <button type="button" onClick={props.onRefresh}>
          {t("public.refresh")}
        </button>
      </div>
      {props.error && (
        <p role="status" className="public-status">
          {props.stale
            ? t("public.stale")
            : props.kind === "verify"
              ? t("verify.error")
              : t("public.chainUnavailable")}
        </p>
      )}
      {props.loading && props.data === null ? (
        <FeedShape />
      ) : props.kind === "verify" ? (
        props.data ? (
          <Verify data={props.data} cluster={props.cluster} />
        ) : (
          !props.error && <p>{t("verify.empty")}</p>
        )
      ) : props.kind === "fairness" ? (
        <Fairness data={props.data} />
      ) : props.kind === "live" ? (
        <Live data={props.data} cluster={props.cluster} />
      ) : (
        <Token data={props.data} cluster={props.cluster} />
      )}
      {props.trust && (
        <p data-trust={props.trust}>
          {props.trust === "sealed"
            ? t("public.sealed")
            : t("public.timelocked", {
                n: count(GOVERNANCE.multisigThreshold),
                s: count(GOVERNANCE.timelockSeconds),
              })}
        </p>
      )}
    </section>
  );
}
