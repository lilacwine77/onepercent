/** PREVIEW builds only: a demo draw on /verify/:pull (real draws are checked on chain). */
import { HIT_TIERS } from "@onepercent/config/web";
import { countUngrouped } from "@onepercent/copy";
import { DEMO_COPY } from "../copy";
import type { DemoCard } from "../store";
import { useDemo } from "./shared";

const label = (kind: DemoCard["kind"]) =>
  kind === "dust"
    ? DEMO_COPY.dustCard
    : kind === "jackpot"
      ? DEMO_COPY.jackpot
      : kind === "one_pct"
        ? DEMO_COPY.onePct
        : (HIT_TIERS.find((tier) => tier.id === kind)?.label ?? kind);

/** Nothing else to load first. */
export const ready = () => undefined;

export default function DemoVerify({ pull }: { pull: string }) {
  const state = useDemo();
  const draw = state.history.find((entry) => entry.seq === pull);
  const seq = /^\d+$/.test(pull) ? countUngrouped(BigInt(pull)) : pull;
  return (
    <section className="demo-state demo-verify">
      <h1 tabIndex={-1}>{DEMO_COPY.verifyTitle(seq)}</h1>
      <p>{DEMO_COPY.verifyLine}</p>
      {draw ? (
        <>
          <h2>{DEMO_COPY.verifyCards}</h2>
          <ol className="demo-draw">
            {draw.cards.map((card) => (
              <li key={`${card.kind}:${card.mint}`}>
                <img
                  src={`/api/logo/${card.mint}`}
                  alt=""
                  width={28}
                  height={28}
                  onError={(event) => (event.currentTarget.hidden = true)}
                />
                <b>{DEMO_COPY.ticker(card.symbol)}</b>
                <span>{label(card.kind)}</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p>{DEMO_COPY.verifyUnknown}</p>
      )}
      <a className="oval" href="/rip">
        {DEMO_COPY.ripAgain}
      </a>
    </section>
  );
}
