import { FEED_BACK_RANGE } from "@onepercent/config/feed-back";
import { count, sol, t } from "@onepercent/copy/initial";

/** Splits a copy line around its amount: the amount is shown large, never retyped. */
function around(text: string, amount: string) {
  const at = text.indexOf(amount);
  return at < 0
    ? { amount: text, caption: "" }
    : {
        amount,
        caption: `${text.slice(0, at)}${text.slice(at + amount.length)}`.trim(),
      };
}

/**
 * The outlook's hero, "up to N×" for the bags together: the most their Dust Cards
 * can pay when pulled (FEED_BACK_RANGE.max each) over what they fetch now, rounded
 * down. Like each row's badge (feedUpTo), it counts the bags with a sold-now value
 * and shows from 2×; null otherwise.
 */
export function outlookUpTo(soldNow: readonly (bigint | null)[]) {
  const valued = soldNow.filter(
    (value): value is bigint => value !== null && value > 0n,
  );
  const total = valued.reduce((sum, value) => sum + value, 0n);
  if (total === 0n) return null;
  const times = (BigInt(valued.length) * FEED_BACK_RANGE.max) / total;
  return times >= 2n ? Number(times) : null;
}

/**
 * The outlook of feeding bags, at the top of the Feed page and the end of an X-ray
 * result (styles.css .feed-outlook), in two stats: the hero, gold, is the multiple
 * when packs pull the bags' Dust Cards ("up to N×", outlookUpTo) with what those
 * cards are expected to pay beside it; then, small and muted, what the bags fetch
 * if sold now. Without a multiple, the expected amount is the hero's number. Amounts in
 * lamports (@onepercent/config feedOutlook). `values`: the Feed page sums
 * executable quotes ("if sold now"); the X-ray sums estimates ("est.", COPY §0.4).
 * The rent of the empty accounts is not an outlook stat: the Feed page names it in
 * one quiet line under the list.
 */
export function FeedOutlook({
  soldNow,
  whenPulled,
  upTo,
  values = "now",
}: {
  soldNow: bigint;
  whenPulled: bigint;
  upTo: number | null;
  values?: "now" | "est";
}) {
  const expected = t("feed.outlook.expected", { sol: sol(whenPulled) });
  const pulled = t("feed.outlook.whenPulled");
  const multiple =
    upTo === null
      ? null
      : around(t("feed.outlook.upTo", { n: count(upTo) }), `${count(upTo)}×`);
  const hero = multiple ?? around(expected, `≈${sol(whenPulled)} SOL`);
  const lines = multiple ? [pulled, expected] : [hero.caption, pulled];
  const sold = around(
    t(values === "est" ? "feed.outlook.soldEst" : "feed.outlook.soldNow", {
      sol: sol(soldNow),
    }),
    `≈${sol(soldNow)} SOL`,
  );
  return (
    <div className="feed-outlook">
      <div className="feed-tiles">
        <p className="feed-tile is-hero">
          {multiple ? (
            <b>
              <small>{multiple.caption}</small> {multiple.amount}
            </b>
          ) : (
            <b>{hero.amount}</b>
          )}{" "}
          <span className="feed-tile-lines">
            {lines.map((line, index) => (
              <span key={index}>
                {index > 0 && " "}
                {line}
              </span>
            ))}
          </span>
        </p>
        <p className="feed-tile is-sold">
          <b>{sold.amount}</b> <span>{sold.caption}</span>
        </p>
      </div>
      <p className="feed-outlook-note">{t("feed.outlook.note")}</p>
    </div>
  );
}
