import { useState, type ReactNode } from "react";
import { feedOutlook } from "@onepercent/config/feed-back";
import {
  amount,
  count,
  formatSolDisplay,
  solToLamports,
  t,
} from "@onepercent/copy/initial";
import { feedableLabel, xrayLine } from "@onepercent/eligibility/copy";
import type { XrayResult } from "@onepercent/eligibility/xray-result";
import { strings } from "./strings";
import { FeedOutlook, outlookUpTo } from "../app/FeedOutlook";

type Bag = XrayResult["bags"][number];
export interface XrayViewProps {
  result: XrayResult;
  onShareX: () => void;
  onCopyLink: () => void;
  /** What one fed Dust Card is expected to pay when it's pulled (lamports): the outlook's estimate. */
  feedBackEstimate: bigint;
  /** The next step (xray-page.tsx: Feed my bags, Connect, or X-ray yours), under the outlook. */
  next?: ReactNode;
}

/** A stat tile: its number large (found in the copy, never retyped), the rest under it. */
function Stat({
  text,
  value,
  note,
}: {
  text: string;
  value: string;
  note?: string;
}) {
  const at = text.indexOf(value);
  const rest =
    at < 0 ? "" : `${text.slice(0, at)}${text.slice(at + value.length)}`;
  return (
    <li>
      <b>{at < 0 ? text : value}</b>
      {rest.trim() && <span> {rest.trim()}</span>}
      {note && <span className="xray-stat-note"> {note}</span>}
    </li>
  );
}

/** The coin's mark: its monogram until the logo proxy's image has decoded. */
function Coin({ bag }: { bag: Bag }) {
  const [state, setState] = useState<"wait" | "ok" | "no">("wait");
  const letter = bag.symbol.replace(/^\$+/, "").slice(0, 1).toUpperCase();
  return (
    <span className="xray-coin" aria-hidden="true">
      {letter}
      {state !== "no" && (
        <img
          src={`/api/logo/${bag.mint}`}
          alt=""
          width={28}
          height={28}
          loading="lazy"
          decoding="async"
          className={state === "ok" ? "is-ready" : undefined}
          onLoad={() => setState("ok")}
          onError={() => setState("no")}
        />
      )}
    </span>
  );
}

/**
 * A chip's amount, short: "11,028,262" (no decimals from 1,000), "3.14" (up to 4
 * decimals below it), and a dust amount keeps its first two digits ("0.000001").
 */
function chipAmount(value: string): string {
  // The schema keeps amounts to /^\d+(\.\d+)?$/.
  const [whole = "0", fraction = ""] = value.split(".");
  const head = BigInt(whole);
  if (head >= 1000n) return amount(head);
  const first = fraction.search(/[1-9]/);
  const keep = head > 0n || first < 0 ? 4 : Math.max(4, first + 2);
  const tail = fraction.slice(0, keep).replace(/0+$/, "");
  return tail ? `${amount(head)}.${tail}` : amount(head);
}

/** One compact row of chips: the coin, its ticker and amount (and its estimate). */
function Chips({
  bags,
  showValue = false,
}: {
  bags: Bag[];
  showValue?: boolean;
}) {
  return (
    <ul className="xray-chips">
      {bags.map((bag) => (
        <li key={bag.mint}>
          <Coin bag={bag} />
          <b>${bag.symbol.replace(/^\$+/, "")}</b>
          <span>
            {bag.amountUi === null
              ? strings.amountUnavailable
              : chipAmount(bag.amountUi)}
          </span>
          {showValue &&
            (bag.valueSol === undefined ? (
              <span>{strings.noValue}</span>
            ) : (
              <span className="xray-gold-chip">
                {strings.estimatedValue(bag.valueSol)}
              </span>
            ))}
        </li>
      ))}
    </ul>
  );
}

/** Bags by their reason: each reason said once, its coins under it. */
function byReason(bags: Bag[]) {
  const groups = new Map<string, Bag[]>();
  for (const bag of bags) {
    const reason = bag.reason ?? "";
    groups.set(reason, [...(groups.get(reason) ?? []), bag]);
  }
  return [...groups];
}

function Group({
  title,
  note,
  bags,
  showValue,
}: {
  title: string;
  note?: string;
  bags: Bag[];
  showValue?: boolean;
}) {
  return (
    <section className="xray-group">
      <h3>
        {title}{" "}
        <span className="xray-count" aria-hidden="true">
          {count(bags.length)}
        </span>
      </h3>
      {note !== undefined ? (
        <>
          {note && <p className="xray-note">{note}</p>}
          <Chips bags={bags} showValue={showValue} />
        </>
      ) : (
        byReason(bags).map(([reason, group]) => (
          <div key={reason}>
            {reason && <p className="xray-note">{reason}</p>}
            <Chips bags={group} showValue={showValue} />
          </div>
        ))
      )}
    </section>
  );
}

export function XrayView({
  result,
  onShareX,
  onCopyLink,
  feedBackEstimate,
  next,
}: XrayViewProps) {
  const description = xrayLine(result).replace(/^X-ray: /, "");
  const feedable = result.bags.filter(
    (bag) =>
      bag.buckets.includes("feedable") && bag.reasonCode !== "snapshot_at_feed",
  );
  const checkAtFeed = result.bags.filter(
    (bag) =>
      bag.buckets.includes("feedable") && bag.reasonCode === "snapshot_at_feed",
  );
  const notFeedable = result.bags.filter((bag) =>
    bag.buckets.includes("not_feedable_season"),
  );
  // The outlook of feeding the bags that can go to Feed.
  const toFeed = [...feedable, ...checkAtFeed];
  const values = toFeed.map((bag) =>
    bag.valueSol === undefined ? null : solToLamports(bag.valueSol),
  );
  const outlook = feedOutlook(values, feedBackEstimate, 0n);
  const sellable = result.bags.filter((bag) => bag.buckets.includes("sell"));
  const notInSet = result.bags.filter((bag) =>
    bag.buckets.includes("not_in_set"),
  );
  const { counts, totals } = result;
  const refund = formatSolDisplay(totals.rentBackSol);
  const bid = formatSolDisplay(totals.sellValueSol);
  return (
    <div className="xray-result stagger">
      {/* The wallet is the page's title (xray-page.tsx), and the share card
          below carries the one personality element (its title). First, the few
          numbers that matter, instead of a line of segments. */}
      <ul className="xray-stats">
        {toFeed.length > 0 && (
          <Stat
            text={t(
              toFeed.length === 1
                ? "xray.stat.feed.one"
                : "xray.stat.feed.other",
              { n: count(toFeed.length) },
            )}
            value={count(toFeed.length)}
          />
        )}
        {counts.sellable > 0 && (
          <Stat
            text={strings.estimatedValue(totals.sellValueSol)}
            value={`≈${bid} SOL`}
            note={t(
              counts.sellable === 1
                ? "xray.stat.bid.one"
                : "xray.stat.bid.other",
              { n: count(counts.sellable) },
            )}
          />
        )}
        {counts.empty > 0 && (
          <Stat
            text={strings.rent(totals.rentBackSol)}
            value={`≈${refund} SOL`}
            note={strings.emptyCount(counts.empty)}
          />
        )}
      </ul>
      {/* What feeding them would pay, and the step to take: one screen. */}
      {toFeed.length > 0 && (
        <FeedOutlook
          soldNow={outlook.soldNow}
          whenPulled={outlook.whenPulled}
          upTo={outlookUpTo(values)}
          values="est"
        />
      )}
      {next}
      {/* The details: which bags, each reason once. */}
      <div className="xray-sections">
        {feedable.length > 0 && (
          <Group
            title={strings.feedable}
            note={feedableLabel()}
            bags={feedable}
          />
        )}
        {checkAtFeed.length > 0 && (
          // Its title says why ("To check at Feed"): no line under it.
          <Group title={strings.checkAtFeed} note="" bags={checkAtFeed} />
        )}
        {notFeedable.length > 0 && (
          <Group title={strings.notFeedable} bags={notFeedable} />
        )}
        {sellable.length > 0 && (
          <Group title={strings.sellable} note="" bags={sellable} showValue />
        )}
        {notInSet.length > 0 && (
          // Not eligible: out of the way behind its count, its reason said once.
          <details className="xray-group xray-out">
            <summary>
              {t(
                notInSet.length === 1
                  ? "xray.notInSet.one"
                  : "xray.notInSet.other",
                { n: count(notInSet.length) },
              )}
            </summary>
            {byReason(notInSet).map(([reason, group]) => (
              <div key={reason}>
                {reason && <p className="xray-note">{reason}</p>}
                <Chips bags={group} />
              </div>
            ))}
          </details>
        )}
      </div>
      {/* The share card ends the page: the thing to post, with its buttons. */}
      <div className="xray-share-frame">
        <img
          className="xray-share-card"
          src={result.share.landscapeUrl}
          alt={description}
          width={1200}
          height={630}
          loading="lazy"
          data-fade=""
        />
      </div>
      <div className="xray-actions">
        <button onClick={onShareX}>{strings.share}</button>
        <button onClick={onCopyLink}>{strings.copy}</button>
      </div>
    </div>
  );
}
