import { useState, type ReactNode } from "react";
import {
  CARDS_PER_PACK,
  HIT_ODDS,
  METEORA_BY_CLUSTER,
  ONEPERCENT_PROGRAM_IDS,
  PACK_EDITIONS,
  PACK_SPLIT_BPS,
  PPB_DENOMINATOR,
  SEASON,
  SELL_BACK,
  STOCK,
  TOKEN_1PCT,
  VRF,
} from "@onepercent/config";
import {
  amount,
  count,
  packPrice,
  pctBps,
  shortAddress,
  sol,
  t,
} from "@onepercent/copy";
import "./docs.css";

const percent = (bps: number) => pctBps(bps).replace(".0%", "%");
const addresses = {
  program: ONEPERCENT_PROGRAM_IDS.mainnet,
  dbc: METEORA_BY_CLUSTER.mainnet.dbcConfig,
  feeIn: "AtRkb16chRvFRokhpwefiNkAQCeGyb1jNe1jfnnQLexN",
  lut: "9oKigMfhYcYjX2vHzMwQZoU5JLPQuvK75JfomdnXwfs9",
} as const;
type AddressName = keyof typeof addresses;

function Address({
  name,
  full = false,
}: {
  name: AddressName;
  full?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const address = addresses[name];
  if (!address || address === "PENDING") return null;
  const label = t(`docs.addresses.${name}`);
  return (
    <div className={`docs-address${full ? " docs-address-full" : ""}`}>
      <span className="docs-address-label">{label}</span>
      <code>{full ? address : shortAddress(address)}</code>
      <button
        type="button"
        aria-label={t("docs.addresses.copyLabel", { name: label })}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(address);
            setStatus("copied");
          } catch {
            setStatus("failed");
          }
        }}
      >
        {t("docs.addresses.copy")}
      </button>
      <a
        href={`https://solscan.io/account/${address}`}
        aria-label={t("docs.addresses.solscanLabel", { name: label })}
        rel="external noopener noreferrer"
        target="_blank"
      >
        {t("docs.addresses.solscan")}
      </a>
      <span className="docs-copy-status" role="status">
        {status === "copied"
          ? t("docs.addresses.copied")
          : status === "failed"
            ? t("docs.addresses.copyFailed")
            : ""}
      </span>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="docs-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <div className="docs-section-body">{children}</div>
    </section>
  );
}

const oddsByEdition = PACK_EDITIONS.map((edition) => {
  const odds = {
    blue: HIT_ODDS.bluePpb[edition.id],
    holo: HIT_ODDS.holoPpb,
    black: HIT_ODDS.blackPpb,
    jackpot: Number(edition.priceLamports) / HIT_ODDS.jackpotPriceDivisor,
    onePct: Number(edition.priceLamports) / HIT_ODDS.onePctPriceDivisor,
  };
  return {
    silver: PPB_DENOMINATOR - Object.values(odds).reduce((a, b) => a + b, 0),
    ...odds,
  };
});

function Editions() {
  return (
    <div
      className="docs-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={t("docs.packs.odds")}
    >
      <table className="docs-odds">
        <caption className="sr-only">{t("docs.packs.odds")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("docs.packs.odds")}</th>
            {PACK_EDITIONS.map((edition) => (
              <th
                scope="col"
                key={edition.id}
                className={`docs-edition-${edition.id}`}
              >
                {edition.name}
                <span>
                  {t("docs.packs.price", {
                    sol: packPrice(edition.priceLamports),
                  })}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(
            ["silver", "blue", "holo", "black", "jackpot", "onePct"] as const
          ).map((tier) => (
            <tr key={tier}>
              <th scope="row">{t(`public.${tier}`)}</th>
              {PACK_EDITIONS.map((edition, index) => (
                <td key={edition.id}>
                  {t("docs.packs.probability", {
                    pct: amount(BigInt(oddsByEdition[index]![tier]), 7),
                  })}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Screenshot({ kind }: { kind: "rip" | "cards" }) {
  return (
    <figure className="docs-screenshot">
      <img
        src={`/assets/docs/${kind}.webp`}
        width={960}
        height={720}
        loading="lazy"
        decoding="async"
        alt={t(`docs.images.${kind}Alt`)}
      />
      <figcaption>{t(`docs.images.${kind}Caption`)}</figcaption>
    </figure>
  );
}

export default function Docs() {
  return (
    <article className="docs-page">
      <header className="docs-header">
        <h1 tabIndex={-1}>{t("docs.heading")}</h1>
        <p>
          {t("docs.intro")}
          <br />
          {t("docs.introDetail")}
        </p>
      </header>
      <Section id="how" title={t("docs.how.title")}>
        <p>{t("docs.how.feed")}</p>
        <p>
          {t("docs.how.rip", {
            d: count(CARDS_PER_PACK.dust),
            n: count(CARDS_PER_PACK.hit),
          })}{" "}
          {t("docs.how.empty")}
        </p>
        <p>
          {t("docs.how.royalty", {
            pct: percent(PACK_SPLIT_BPS.royaltyPerDustCard),
          })}
        </p>
        <p>{t("docs.how.takeBack")}</p>
        <Screenshot kind="rip" />
      </Section>
      <Section id="packs" title={t("docs.packs.title")}>
        <Editions />
        <p className="docs-table-hint docs-note">{t("docs.packs.scroll")}</p>
        <p>{t("docs.packs.oddsNote")}</p>
        <p>{t("docs.packs.fees", { sol: sol(VRF.feeLamports) })}</p>
        <p>
          {t("docs.packs.fairness")}{" "}
          <a href="/fairness">{t("docs.packs.fairnessLink")}</a>
        </p>
      </Section>
      <Section id="cards" title={t("docs.cards.title")}>
        <p>{t("docs.cards.redeem")}</p>
        <p>{t("docs.cards.sell", { pct: percent(SELL_BACK.payoutBps) })}</p>
        <p>
          {t("docs.cards.sellLimits")} {t("docs.cards.specials")}
        </p>
        <Screenshot kind="cards" />
      </Section>
      <Section id="token" title={t("docs.token.title")}>
        <p>
          {t("docs.token.specials", {
            n: count(TOKEN_1PCT.onePctCardCount),
            amount: amount(TOKEN_1PCT.onePctCardAmount, TOKEN_1PCT.decimals),
          })}
        </p>
        <p>{t("docs.token.curve")}</p>
        <div className="docs-fee-example">
          <p>{t("docs.token.example")}</p>
          <p>
            {t("docs.token.split", { sol: sol(STOCK.creatorFeeFloorLamports) })}
          </p>
        </div>
        <p>{t("docs.token.exceptions")}</p>
        <p className="docs-note">
          {t("docs.token.book")} {t("docs.token.feeControl")}
        </p>
        <Address name="dbc" />
        <Address name="feeIn" />
      </Section>
      <Section id="season" title={t("docs.season.title")}>
        <p>
          {t("docs.season.duration", {
            n: count(SEASON.durationSeconds / 3_600),
          })}{" "}
          {t("docs.season.final")}
        </p>
        <p className="docs-note">{t("docs.season.pending")}</p>
      </Section>
      <Section id="safety" title={t("docs.team.title")}>
        <ul className="docs-rules">
          <li>{t("docs.team.sign")}</li>
          <li>{t("docs.team.guardian")}</li>
          <li>{t("docs.team.exits")}</li>
          <li>{t("docs.team.upgrade")}</li>
        </ul>
        <Address name="program" />
      </Section>
      <footer className="docs-addresses" aria-label={t("docs.addresses.title")}>
        <details>
          <summary>{t("docs.addresses.title")}</summary>
          {(Object.keys(addresses) as AddressName[]).map((name) => (
            <Address key={name} name={name} full />
          ))}
        </details>
      </footer>
    </article>
  );
}
