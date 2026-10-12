import { useEffect, useRef, useState } from "react";
import { feedOutlook, feedUpTo } from "@onepercent/config/feed-back";
import { count, sol, t, type CopyKey } from "@onepercent/copy";
import { FeedOutlook, outlookUpTo } from "../../app/FeedOutlook";
import { playCue, unlockAudio } from "../rip/sound";
import type {
  FeedPanelProps,
  FeedRow,
  InTheMachineProps,
  Msg,
  Value,
} from "./types";
import { copy } from "./copy";
import "./feed.css";

export interface FeedViewProps {
  panel: FeedPanelProps;
  machine: InTheMachineProps;
  soundOn: boolean;
  reducedMotion: boolean;
  onRip(): void;
}

type Loose = (key: CopyKey, vars?: Record<string, string>) => string;
const tr = t as unknown as Loose;
const say = (msg: Msg | null) => (msg ? tr(msg.key, msg.vars) : "");
const plural = (
  key:
    "count.bags" | "count.transactions" | "count.approvals" | "count.dustCards",
  n: number,
) => tr(key, { n: count(n) });

function CoinMark({
  ticker,
  logoUrl,
}: {
  ticker: string;
  logoUrl: string | null;
}) {
  // The monogram is the coin until its logo has decoded (it fades in), and stays
  // when the logo is missing or fails (logo proxy 404).
  const [state, setState] = useState<{ url: string; ok: boolean } | null>(null);
  const ready = state?.url === logoUrl && state.ok;
  const failed = state?.url === logoUrl && !state.ok;
  return (
    <span className="feed-coin" aria-hidden="true">
      <b>{ticker.replace(/^\$/, "").slice(0, 1).toUpperCase()}</b>
      {logoUrl && !failed && (
        <img
          src={logoUrl}
          alt=""
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
          className={ready ? "is-ready" : undefined}
          onLoad={() => setState({ url: logoUrl, ok: true })}
          onError={() => setState({ url: logoUrl, ok: false })}
        />
      )}
    </span>
  );
}

/** Bags that can't be fed, by their reason: each reason said once. */
function byReason(rows: FeedRow[]) {
  const groups = new Map<string, FeedRow[]>();
  for (const row of rows) {
    const reason = say(row.canFeed.reason);
    groups.set(reason, [...(groups.get(reason) ?? []), row]);
  }
  return [...groups];
}
const soldNowOf = (value: Value) =>
  value.kind === "none" ? null : value.lamports;
const checkAtFeed = (row: FeedRow) => row.note?.key === "feed.row.checkAtFeed";

/**
 * One line per bag: the coin and its amount; for a bag that can be fed, what it
 * fetches if sold now → the most its Dust Card pays when pulled, the "up to N×"
 * badge and the Feed checkbox; otherwise its one-line reason.
 */
function Row({
  row,
  panel,
  busy,
  marked,
}: {
  row: FeedRow;
  panel: FeedPanelProps;
  busy: boolean;
  /** A "*" for the footnote under the list (the final check), when only some bags get it. */
  marked: boolean;
}) {
  const feedable = row.canFeed.open;
  const soldNow = soldNowOf(row.value);
  const upTo = feedable ? feedUpTo(soldNow) : null;
  const note = row.note && !checkAtFeed(row) ? say(row.note) : null;
  return (
    <li
      className="feed-row"
      data-feed={feedable && row.feed ? "on" : feedable ? "off" : "no"}
      data-mint={row.coin.mint}
    >
      <CoinMark ticker={row.coin.ticker} logoUrl={row.coin.logoUrl} />
      <p className="feed-bag">
        <b>${row.coin.ticker}</b>
        {marked && (
          <sup className="feed-mark" aria-hidden="true">
            *
          </sup>
        )}
        <span>{row.amountUi}</span>
        {note && <span className="feed-note">{note}</span>}
      </p>
      {feedable ? (
        <>
          <p className="feed-roi">
            <span>
              {soldNow === null
                ? t("feed.row.noBid")
                : t("feed.row.roi", { sol: sol(soldNow) })}
            </span>
            {upTo !== null && (
              <b className="feed-times">
                {t("feed.row.multiple", { n: count(upTo) })}
              </b>
            )}
          </p>
          <input
            className="feed-check"
            type="checkbox"
            checked={row.feed}
            disabled={busy}
            aria-label={`${t("feed.row.feed")} $${row.coin.ticker}`}
            onChange={(event) =>
              panel.onToggle(row.coin.mint, event.target.checked)
            }
          />
        </>
      ) : (
        <p className="feed-why">{say(row.canFeed.reason)}</p>
      )}
    </li>
  );
}

/** Coins of the fed bags fly into "In the machine" once the Feed landed (no tells before). */
function useFeedFlight(
  panel: FeedPanelProps,
  reduced: boolean,
  sound: boolean,
) {
  const captured = useRef<{ rect: DOMRect; html: string }[]>([]);
  const phase = panel.flow.phase;
  useEffect(() => {
    if (phase !== "done" || !captured.current.length) return;
    const mark = document.getElementById("machine-title");
    if (!mark) return;
    const target = mark.getBoundingClientRect();
    const flights = captured.current;
    captured.current = [];
    if (reduced) return;
    flights.forEach(({ rect, html }, index) => {
      const clone = document.createElement("span");
      clone.className = "feed-coin feed-flight";
      clone.innerHTML = html;
      clone.style.setProperty("left", `${rect.left}px`);
      clone.style.setProperty("top", `${rect.top}px`);
      document.body.append(clone);
      const dx = target.left + target.width / 2 - (rect.left + rect.width / 2);
      const dy =
        target.top + target.height * 0.42 - (rect.top + rect.height / 2);
      const animation = clone.animate(
        [
          { transform: "translate(0,0) scale(1) rotate(0deg)", opacity: 1 },
          {
            transform: `translate(${dx * 0.45}px, ${dy - 120}px) scale(1.12) rotate(-140deg)`,
            opacity: 1,
            offset: 0.55,
          },
          {
            transform: `translate(${dx}px, ${dy}px) scale(0.42) rotate(-300deg)`,
            opacity: 0.9,
            offset: 0.92,
          },
          {
            transform: `translate(${dx}px, ${dy + 10}px) scale(0.2) rotate(-320deg)`,
            opacity: 0,
          },
        ],
        {
          duration: 820,
          delay: index * 90,
          easing: "cubic-bezier(.45,.05,.35,1)",
          fill: "both",
        },
      );
      animation.onfinish = () => {
        clone.remove();
        mark.animate(
          [
            { transform: "scale(1)" },
            { transform: "scale(1.08, .94)" },
            { transform: "scale(1)" },
          ],
          { duration: 260, easing: "cubic-bezier(.175,.885,.32,1.6)" },
        );
        if (sound) playCue("slot.drop");
      };
    });
  }, [phase, reduced, sound]);
  return (rows: FeedRow[]) => {
    captured.current = rows
      .filter((row) => row.canFeed.open && row.feed)
      .map((row) => {
        const coin = document.querySelector(
          `.feed-row[data-mint="${row.coin.mint}"] .feed-coin`,
        );
        return coin
          ? { rect: coin.getBoundingClientRect(), html: coin.innerHTML }
          : null;
      })
      .filter((item): item is { rect: DOMRect; html: string } => item !== null);
  };
}

export default function FeedView({
  panel,
  machine,
  soundOn,
  reducedMotion,
  onRip,
}: FeedViewProps) {
  const capture = useFeedFlight(panel, reducedMotion, soundOn);
  // First render only: the rows rise in a beat apart (styles.css .stagger). A row
  // that later moves between groups appears at once.
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setEntering(false), 1200);
    return () => clearTimeout(timer);
  }, []);
  const stagger = entering ? "stagger" : undefined;
  const busy = ["planning", "quoting", "signing", "sending"].includes(
    panel.flow.phase,
  );
  const done = panel.flow.phase === "done";
  const feedableRows = panel.rows.filter((row) => row.canFeed.open);
  const otherRows = panel.rows.filter((row) => !row.canFeed.open);
  const fedRows = feedableRows.filter((row) => row.feed);
  const fedValues = fedRows.map((row) => soldNowOf(row.value));
  const { soldNow, whenPulled } = feedOutlook(
    fedValues,
    panel.estimateLamports,
    panel.rentBack.lamports,
  );
  const plan = panel.plan;
  const rent = panel.rentBack.lamports;
  // The checked bags ("Feed 11 bags"); with none checked, the empty accounts alone.
  const label = !plan
    ? null
    : plan.bags > 0
      ? t("feed.button.feed", { bags: plural("count.bags", plan.bags) })
      : t("feed.button.rentOnly", { sol: sol(rent) });
  // The final check covers every bag that gets one: one footnote under the list, a
  // "*" on the bags it covers when only some do.
  const checked = feedableRows.filter(checkAtFeed);
  const markSome = checked.length > 0 && checked.length < feedableRows.length;
  function feed() {
    if (soundOn) unlockAudio();
    capture(panel.rows);
    panel.onFeed({ feed: fedRows.map((row) => row.coin.mint) });
  }
  return (
    <div className="feed-page">
      {/* One title: the wallet is in the header, the outlook says what feeding
          pays (the home explains it), and nothing decorative stands beside it. */}
      <header className="feed-head">
        <h1 tabIndex={-1} className={stagger}>
          {t("feed.titleNoWallet")}
        </h1>
      </header>

      {done ? (
        <section className="feed-done" aria-live="polite">
          <p className="feed-done-line">{say(panel.flow.message)}</p>
          <div className="feed-done-actions">
            <button type="button" className="feed-oval" onClick={onRip}>
              <span>{copy.ripNext}</span>
              <b aria-hidden="true">→</b>
            </button>
          </div>
        </section>
      ) : (
        <section className="feed-panel" aria-label={t("nav.feed")}>
          {!panel.gate.open && panel.gate.reason && (
            <p className="feed-gate">{say(panel.gate.reason)}</p>
          )}
          <FeedOutlook
            soldNow={soldNow}
            whenPulled={whenPulled}
            upTo={outlookUpTo(fedValues)}
          />
          {feedableRows.length > 0 && (
            <div className="feed-group">
              <h2>{tr("feed.group.feed", { n: count(fedRows.length) })}</h2>
              <ul className={stagger}>
                {feedableRows.map((row) => (
                  <Row
                    key={row.coin.mint}
                    row={row}
                    panel={panel}
                    busy={busy}
                    marked={markSome && checkAtFeed(row)}
                  />
                ))}
              </ul>
              {checked.length > 0 && (
                <p className="feed-footnote">
                  {markSome && <span aria-hidden="true">* </span>}
                  {t("feed.row.checkAtFeed")}
                </p>
              )}
            </div>
          )}
          {otherRows.length > 0 && (
            <details className="feed-group feed-out">
              <summary>
                {tr("feed.group.out", { n: count(otherRows.length) })}
              </summary>
              {byReason(otherRows).map(([reason, rows]) => (
                <div key={reason}>
                  <p className="feed-footnote">{reason}</p>
                  <ul className="feed-chips">
                    {rows.map((row) => (
                      <li key={row.coin.mint}>
                        <CoinMark
                          ticker={row.coin.ticker}
                          logoUrl={row.coin.logoUrl}
                        />
                        <b>${row.coin.ticker}</b>
                        <span>{row.amountUi}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </details>
          )}
          {/* The empty accounts close in the same Feed transaction: one quiet
              line, no choice (the button names the bags only). */}
          {panel.rentBack.accounts > 0 && fedRows.length > 0 && (
            <p className="feed-rent">
              {t("feed.rentRefund", { sol: sol(rent) })}
            </p>
          )}
          <div className="feed-summary">
            <button
              type="button"
              className="feed-oval"
              disabled={!label || !panel.gate.open || busy}
              onClick={feed}
            >
              <span>
                {busy && panel.flow.message ? say(panel.flow.message) : label}
              </span>
              <b aria-hidden="true">→</b>
            </button>
            {!busy && panel.flow.message && (
              <p className="feed-flow" role="status">
                {say(panel.flow.message)}
              </p>
            )}
            {/* Under the button, only what the wallet will ask and show: the
                approvals, the refundable deposit, where the tokens go. */}
            <div className="feed-lines">
              {plan && (
                <p>
                  {t("feed.plan", {
                    transactions: plural(
                      "count.transactions",
                      plan.transactions,
                    ),
                    approvals: plural("count.approvals", plan.approvals),
                  })}
                  {panel.deposits.totalLamports > 0n &&
                    ` ✳ ${t("feed.deposits.total", {
                      sol: sol(panel.deposits.totalLamports),
                    })}`}
                </p>
              )}
              {panel.emptiedRentBackLamports > 0n && (
                <p>
                  {tr("feed.rentBack.emptied", {
                    n: count(fedRows.length),
                    sol: sol(panel.emptiedRentBackLamports),
                  })}
                </p>
              )}
              <p>{say(panel.explainer)}</p>
            </div>
          </div>
        </section>
      )}

      {/* In the machine: only once something is in it. */}
      {(machine.entries.length > 0 || machine.flow.message) && (
        <section className="feed-machine" aria-labelledby="machine-title">
          <h2 id="machine-title">{t("takeBack.title")}</h2>
          {machine.entries.length > 0 && (
            <ul className={stagger}>
              {machine.entries.map((entry) => (
                <li key={entry.entryId} className="machine-row">
                  <CoinMark
                    ticker={entry.coin.ticker}
                    logoUrl={entry.coin.logoUrl}
                  />
                  <div>
                    <p>
                      {t("takeBack.row", {
                        ticker: `$${entry.coin.ticker}`,
                        amount: entry.amountUi,
                      })}
                    </p>
                    {entry.refed && (
                      <p className="feed-note">{t("takeBack.refed")}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="feed-pill"
                    disabled={["signing", "sending"].includes(
                      machine.flow.phase,
                    )}
                    onClick={() => machine.onTakeBack([entry.entryId])}
                  >
                    {t("takeBack.button")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {machine.flow.message && (
            <p className="feed-flow" role="status">
              {say(machine.flow.message)}
            </p>
          )}
          <p className="feed-always">{t("takeBack.always")}</p>
        </section>
      )}
    </div>
  );
}
