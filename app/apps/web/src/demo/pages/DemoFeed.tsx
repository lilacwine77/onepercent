/** PREVIEW builds only: the Feed panel and In the machine on the demo store. */
import { useState, type ReactNode } from "react";
import { count, sol, t, type CopyKey } from "@onepercent/copy";
import { ExperienceSlot } from "../../bridge/ExperienceSlot";
import { preloadModule } from "../../app/lazy-module";
import {
  FeedShape,
  loadFeed,
  type FeedViewProps,
} from "../../experience/index";
import { motionPref, soundPref, useStore } from "../../app/prefs";
import { useFeedBackEstimate } from "../../data/feed-back";
import { navigate } from "../../routes/router";
import { DEMO_COPY } from "../copy";
import { ENTRY_DEPOSIT, feed, takeBack } from "../store";
import { formatUi, sleep, useDemo, useDemoWallet, useSeed } from "./shared";

type Flow = FeedViewProps["panel"]["flow"];
const idle: Flow = {
  phase: "ready",
  confirmed: 0,
  total: 1,
  approvals: 1,
  message: null,
};
const fragment = (
  key:
    "count.bags" | "count.dustCards" | "count.transactions" | "count.approvals",
  n: number,
) =>
  (t as unknown as (k: string, v: Record<string, string>) => string)(key, {
    n: count(n),
  });
/** Before the bags are known: connect, read the X-ray, or X-ray it first. */
function DemoState({ line, action }: { line: string; action?: ReactNode }) {
  return (
    <section className="demo-state">
      <h1 tabIndex={-1}>{t("feed.titleNoWallet")}</h1>
      <p>{line}</p>
      {action}
    </section>
  );
}

/** The Feed panel's chunk, preloaded by the route (1% transition, router.ts). */
export const ready = () => preloadModule(loadFeed);

export default function DemoFeed() {
  const { address, open } = useDemoWallet();
  const status = useSeed(address);
  const state = useDemo();
  // The demo machine's estimate: the documented default edition mix (data/feed-back.ts).
  const estimate = useFeedBackEstimate();
  // Every bag that can be fed starts checked; these are the ones unchecked.
  const [kept, setKept] = useState<Record<string, true>>({});
  const [flow, setFlow] = useState<Flow>(idle);
  const [machineFlow, setMachineFlow] = useState<Flow>({
    ...idle,
    phase: "idle",
  });
  const rows = state.bags.map((bag) => {
    const feedable = bag.kind === "feedable" || bag.kind === "checkAtFeed";
    return {
      coin: {
        mint: bag.mint,
        ticker: bag.symbol,
        name: bag.name,
        logoUrl: bag.logo,
      },
      amountUi: formatUi(bag.amountUi),
      drawdownPct: bag.drawdownPct,
      value:
        bag.valueLamports > 0n
          ? { kind: "now" as const, lamports: bag.valueLamports }
          : { kind: "none" as const },
      feed: feedable && !kept[bag.mint],
      canFeed: feedable
        ? { open: true, reason: null }
        : {
            open: false,
            reason: {
              key: (bag.reasonKey ??
                (bag.kind === "notInSet"
                  ? "xray.reason.not_pump_fun"
                  : "xray.reason.snapshot_not_held_undated")) as CopyKey,
            },
          },
      needsConfirm: false,
      confirmed: true,
      note:
        bag.kind === "checkAtFeed"
          ? { key: "feed.row.checkAtFeed" as const }
          : null,
    };
  });
  const fed = rows.filter((row) => row.canFeed.open && row.feed);
  const rent = state.empties.reduce((sum, e) => sum + e.lamports, 0n);
  const deposits = ENTRY_DEPOSIT * BigInt(fed.length);
  const nothing = fed.length === 0 && rent === 0n;
  const props: FeedViewProps = {
    soundOn: useStore(soundPref),
    reducedMotion: useStore(motionPref),
    onRip: () => navigate("/rip"),
    panel: {
      wallet: address ?? "",
      rentBack: { accounts: state.empties.length, lamports: rent },
      estimateLamports: estimate,
      rows,
      deposits: {
        totalLamports: deposits,
        lines: fed.length
          ? [
              {
                key:
                  fed.length === 1
                    ? "feed.deposits.entry.one"
                    : "feed.deposits.entry.other",
                vars: { n: count(fed.length), each: sol(ENTRY_DEPOSIT) },
              },
            ]
          : [],
      },
      emptiedRentBackLamports: 0n,
      machineToday: {
        key: "feed.machineToday",
        vars: {
          deck: count(18_406 + state.deck.length),
          pulls: count(2_913),
          cards: fragment("count.dustCards", Math.max(1, fed.length)),
          sol: sol(8_200_000n * BigInt(Math.max(1, fed.length))),
        },
      },
      plan: nothing
        ? null
        : { bags: fed.length, transactions: 1, approvals: 1 },
      explainer: {
        key: "feed.explainer",
        vars: { program: "1PCTxDemoProgram1111111111111111111111111" },
      },
      trust: { key: "feed.trust" },
      flow,
      gate: { open: true, reason: null },
      onToggle: (mint, on) =>
        setKept((current) => {
          const next = { ...current };
          if (on) delete next[mint];
          else next[mint] = true;
          return next;
        }),
      onConfirmBag: () => undefined,
      onFeed: async (selection) => {
        const plan = {
          transactions: fragment("count.transactions", 1),
          approvals: fragment("count.approvals", 1),
        };
        setFlow({
          phase: "signing",
          confirmed: 0,
          total: 1,
          approvals: 1,
          message: { key: "feed.state.signing", vars: plan },
        });
        await sleep(900);
        setFlow({
          phase: "sending",
          confirmed: 0,
          total: 1,
          approvals: 1,
          message: { key: "feed.state.sending", vars: { c: "0", t: "1" } },
        });
        await sleep(1000);
        const landed = feed(selection);
        setKept({});
        setFlow({
          phase: "done",
          confirmed: 1,
          total: 1,
          approvals: 1,
          message: {
            key: "feed.state.done",
            vars: {
              bags: fragment("count.bags", landed.bags),
              cards: fragment("count.dustCards", landed.bags),
              rent: sol(landed.rent),
              deposits: sol(landed.deposits),
            },
          },
        });
      },
      onFeedOneFirst: () => undefined,
      onRefreshQuotes: () => undefined,
      onRetry: () => setFlow(idle),
    },
    machine: {
      entries: state.deck.map((entry) => ({
        entryId: entry.entryId,
        coin: {
          mint: entry.mint,
          ticker: entry.symbol,
          name: entry.name,
          logoUrl: entry.logo,
        },
        amountUi: formatUi(entry.amountUi),
        depositLamports: entry.depositLamports,
        refed: entry.refed,
      })),
      vaultDeposits: [],
      flow: machineFlow,
      onTakeBack: async (ids) => {
        setMachineFlow({
          phase: "signing",
          confirmed: 0,
          total: 1,
          approvals: 1,
          message: { key: "wallet.check" },
        });
        await sleep(800);
        takeBack(ids);
        setMachineFlow({
          phase: "done",
          confirmed: 1,
          total: 1,
          approvals: 1,
          message: {
            key: ids.length === 1 ? "takeBack.done.one" : "takeBack.done.other",
            vars: { n: count(ids.length) },
          },
        });
      },
    },
  };
  if (!address)
    return (
      <DemoState
        line={DEMO_COPY.connect}
        action={
          <button className="oval" type="button" onClick={open}>
            {t("wallet.connect")}
          </button>
        }
      />
    );
  if (status === "loading")
    return (
      <div role="status">
        <span className="sr-only">{DEMO_COPY.loading}</span>
        <FeedShape />
      </div>
    );
  if (status === "needsXray")
    return (
      <DemoState
        line={DEMO_COPY.needsXray}
        action={
          <a className="oval" href={`/x/${address}`}>
            {DEMO_COPY.xrayIt}
          </a>
        }
      />
    );
  return (
    <>
      {status === "sample" && <p className="demo-note">{DEMO_COPY.sample}</p>}
      <ExperienceSlot
        component="feed"
        load={loadFeed}
        props={props}
        poster={<FeedShape />}
        placeholder={null}
      />
    </>
  );
}
