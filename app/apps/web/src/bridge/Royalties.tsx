import { dateUtc, t } from "@onepercent/copy";
import type { MeResponse } from "@onepercent/sdk/api";
import {
  royaltyDigest,
  royaltyRows,
  type RoyaltyHistory,
} from "../adapters/royalties";

export function Royalties({
  me,
  history,
}: {
  me: MeResponse | null;
  history: RoyaltyHistory | null;
}) {
  if (!me && history === null) return null;
  const digest = royaltyDigest(me?.royalties ?? null);
  const rows = royaltyRows(history);
  return (
    <section aria-label={t("royalty.title")}>
      <h2>{t("royalty.title")}</h2>
      {digest && <p>{digest}</p>}
      {rows.length > 0 && (
        <ul>
          {rows.map((row) => (
            <li key={row.id}>
              <a href={row.href}>{row.text}</a>{" "}
              <time dateTime={new Date(row.timestamp * 1_000).toISOString()}>
                {dateUtc(row.timestamp * 1_000)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
