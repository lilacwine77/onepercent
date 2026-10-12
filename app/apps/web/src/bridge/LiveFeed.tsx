import { deploymentChain, webDeployment } from "../data/deployment";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { TX_LIMITS } from "@onepercent/config";
import { FEED_BACK_RANGE } from "@onepercent/config/feed-back";
import { WEB } from "@onepercent/config/web";
import { amount, count, sol, solCost, t, type CopyKey } from "@onepercent/copy";
import { MeResponse } from "@onepercent/sdk/api";
import { DECK_FLAGS } from "@onepercent/sdk/browser";
import { RoyaltiesResponse } from "@onepercent/web-api";
import { PublicKey, type AddressLookupTableAccount } from "@solana/web3.js";
import { useWallet } from "../wallet/WalletProvider";
import { capabilities } from "../wallet/capabilities";
import { api, ApiError } from "../data/api";
import { createRpc } from "../data/rpc";
import {
  FeedReads,
  isReadCancelled,
  readMintDecimals,
} from "../data/feed-reads";
import { useWebConfig } from "../data/config";
import { useFlag } from "../data/flags";
import { useFeedBackEstimate } from "../data/feed-back";
import {
  emptyFeedDisplay,
  readFeedDisplay,
  readFeedWallet,
  type FeedDisplay,
  type FeedWallet,
} from "../data/feed";
import { readVaultDeposits, type VaultDeposit } from "../data/vault-deposits";
import { readPulledRoyalty } from "../data/take-back-outcome";
import { readWalletDeck, type ChainDeckEntry } from "../data/deck";
import {
  bagCoin,
  depositLines,
  feedGate,
  feedRows,
  refusalMessage,
  type FeedMessage,
} from "../adapters/feed-panel";
import type { RoyaltyHistory } from "../adapters/royalties";
import { readProtocolLut } from "../tx/feed/plan";
import { FeedInterrupted, previewFeed, runFeed } from "../tx/feed/run";
import { errorCopy } from "../tx/engine/errors";
import { priorityFee } from "../tx/engine/solana";
import { prepareTakeBack } from "../tx/take-back";
import { runTakeBack } from "../tx/run-take-back";
import { RescueLink } from "../app/OfflineBanner";
import { motionPref, soundPref, useStore } from "../app/prefs";
import { preloadModule } from "../app/lazy-module";
import { navigate } from "../routes/router";
import { FeedShape, loadFeed, type FeedViewProps } from "../experience/index";
import { ExperienceSlot } from "./ExperienceSlot";
import { Royalties } from "./Royalties";

type Flow = FeedViewProps["panel"]["flow"];
const consentCancelled = new Error("Feed confirmation cancelled");
const idle: Flow = {
  phase: "idle",
  confirmed: 0,
  total: 0,
  approvals: 0,
  message: null,
};
const say = t as unknown as (
  key: CopyKey,
  vars?: Record<string, string>,
) => string;
const plural = (
  kind:
    "bags" | "dustCards" | "transactions" | "approvals" | "newTokenAccounts",
  n: number,
) => say(`count.${kind}` as CopyKey, { n: count(n) });
export const ready = () => preloadModule(loadFeed);

function Consent({
  title,
  children,
  yes,
  no,
  accept,
  cancel,
}: {
  title: string;
  children: ReactNode;
  yes: string;
  no: string;
  accept(): void;
  cancel(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog ref={ref} aria-labelledby="feed-consent-heading" onCancel={cancel}>
      <h2 id="feed-consent-heading">{title}</h2>
      {children}
      <button type="button" onClick={accept}>
        {yes}
      </button>
      <button type="button" onClick={cancel}>
        {no}
      </button>
    </dialog>
  );
}

export default function LiveFeed() {
  try {
    webDeployment();
  } catch {
    return (
      <section>
        <h1 tabIndex={-1}>{t("nav.feed")}</h1>
        <p role="status">{t("public.chainUnavailable")}</p>
      </section>
    );
  }
  return <ConfiguredFeed />;
}

function ConfiguredFeed() {
  const wallet = useWallet();
  if (!wallet.account || !wallet.wallet)
    return (
      <section>
        <h1 tabIndex={-1}>{t("feed.titleNoWallet")}</h1>
        <button type="button" onClick={wallet.open}>
          {t("wallet.connect")}
        </button>
        <p>{t("takeBack.always")}</p>
        <RescueLink />
      </section>
    );
  return (
    <ConnectedFeed key={`${wallet.generation}:${wallet.account.address}`} />
  );
}

function ConnectedFeed() {
  const session = useWallet();
  const wallet = session.wallet!;
  const account = session.account!;
  const owner = useMemo(
    () => new PublicKey(account.address),
    [account.address],
  );
  const rpc = useMemo(() => createRpc(), []);
  const reads = useMemo(() => new FeedReads(), []);
  const scales = useRef<Record<string, number>>({});
  const webConfig = useWebConfig();
  const enabled = useFlag("FEED");
  const flag = useRef(enabled);
  flag.current = enabled;
  const generation = session.generation;
  const mounted = useRef(true);
  const busy = useRef(false);
  const current = useCallback(
    () =>
      mounted.current && session.session.snapshot().generation === generation,
    [session.session, generation],
  );
  const chain = deploymentChain();
  const [snapshot, setSnapshot] = useState<FeedWallet | null>(null);
  const [display, setDisplay] = useState<FeedDisplay>(emptyFeedDisplay);
  const deckSlot = useRef(0);
  const [deck, setDeck] = useState<ChainDeckEntry[] | null>(null);
  const [decimals, setDecimals] = useState<Record<string, number>>({});
  const [vaultDeposits, setVaultDeposits] = useState<VaultDeposit[]>([]);
  const vaultCache = useRef<VaultDeposit[]>([]);
  const [history, setHistory] = useState<RoyaltyHistory | null>(null);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [refused, setRefused] = useState<Map<string, FeedMessage>>(new Map());
  const [flow, setFlow] = useState<Flow>(idle);
  const [machineFlow, setMachineFlow] = useState<Flow>(idle);
  const [loadError, setLoadError] = useState(false);
  const [lut, setLut] = useState<AddressLookupTableAccount>();
  const [plan, setPlan] = useState<FeedViewProps["panel"]["plan"]>(null);
  const consentResult = useRef<((accepted: boolean) => void) | null>(null);
  const exitRetryResult = useRef<((accepted: boolean) => void) | null>(null);
  const lastSelection = useRef<string[]>([]);
  const approvedValues = useRef(new Map<string, bigint>());
  const quoteCache = useRef(emptyFeedDisplay);
  const [consent, setConsent] = useState<{
    rows: FeedViewProps["panel"]["rows"];
    selection: string[];
  } | null>(null);
  const [exitConsent, setExitConsent] = useState<{
    entries: ChainDeckEntry[];
    prepared: Awaited<ReturnType<typeof prepareTakeBack>>;
    price: bigint;
    observedSlot: number;
  } | null>(null);
  const estimate = useFeedBackEstimate();
  const soundOn = useStore(soundPref);
  const reducedMotion = useStore(motionPref);

  const loadDeckHints = useCallback(
    (signal?: AbortSignal) =>
      api(`/api/me/${owner.toBase58()}`, MeResponse, { signal }),
    [owner],
  );
  const updateDeck = useCallback(
    async (signal: AbortSignal, forceScan = false) => {
      try {
        const value = await readWalletDeck(reads.rpc, owner, {
          loadHints: async () => {
            try {
              return await loadDeckHints(signal);
            } catch (error) {
              reads.degraded();
              throw error;
            }
          },
          forceScan,
        });
        if (!current() || signal.aborted) return;
        deckSlot.current = value.slot;
        setDeck(value.entries);
        const next = await readMintDecimals(
          reads.rpc,
          value.entries.map((entry) => entry.mint),
          scales.current,
        );
        if (current() && !signal.aborted) setDecimals(next);
      } catch (error) {
        if (isReadCancelled(error) || signal.aborted) return;
        reads.degraded();
        if (current())
          setMachineFlow((state) => ({
            ...state,
            message: { key: "common.networkError" },
          }));
      }
    },
    [reads, owner, current, loadDeckHints],
  );
  const refreshDeck = useCallback(
    (forceScan = false) =>
      reads.poll((signal) => updateDeck(signal, forceScan), true),
    [reads, updateDeck],
  );
  const refresh = useCallback(
    (force = false) =>
      reads.poll(async (signal) => {
        await updateDeck(signal);
        if (!current() || signal.aborted) return;
        try {
          const value = await readFeedWallet(reads.rpc, owner);
          if (!current() || signal.aborted) return;
          setSnapshot(value);
          setLoadError(false);
          const next = await readFeedDisplay(owner, value, signal);
          if (!current() || signal.aborted) return;
          setDisplay(next);
          if (next.me) reads.healthy();
          else reads.degraded();
          try {
            const deposits = await readVaultDeposits(
              reads.rpc,
              owner,
              value.inventory.bags.map((bag) => bag.mint),
              next.me,
              vaultCache.current,
            );
            if (current() && !signal.aborted) {
              vaultCache.current = deposits;
              setVaultDeposits(deposits);
            }
          } catch (error) {
            if (!isReadCancelled(error)) reads.degraded();
            /* Preserve the last measured deposits until the next successful read. */
          }
          if (!current() || signal.aborted) return;
          const lookup = await readProtocolLut(
            reads.rpc,
            webConfig.data?.lookupTable ?? null,
          );
          if (current() && !signal.aborted) setLut(lookup);
        } catch (error) {
          if (isReadCancelled(error) || signal.aborted) return;
          reads.degraded();
          if (current()) setLoadError(true);
        }
        if (!current() || signal.aborted) return;
        try {
          const rows = await api(
            `/api/royalties/${owner.toBase58()}`,
            RoyaltiesResponse,
            { signal },
          );
          if (current() && !signal.aborted) setHistory(rows);
        } catch {
          /* Keep the last successful history while offline. */
        }
      }, force),
    [reads, owner, current, updateDeck, webConfig.data?.lookupTable],
  );
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden && !busy.current) void refresh();
    }, WEB.machinePollMs);
    return () => {
      mounted.current = false;
      reads.cancel();
      clearInterval(timer);
      consentResult.current?.(false);
      exitRetryResult.current?.(false);
    };
  }, [refresh, reads]);
  const rows = useMemo(
    () =>
      snapshot
        ? feedRows({
            snapshot,
            display,
            unchecked,
            refused,
            confirmed: new Set(),
          })
        : [],
    [snapshot, display, unchecked, refused],
  );
  const selection = rows
    .filter((row) => row.feed && row.canFeed.open)
    .map((row) => row.coin.mint);
  const selectionKey = selection.join(":");
  useEffect(() => {
    let active = true;
    setPlan(null);
    if (snapshot)
      void previewFeed({
        wallet: owner,
        snapshot,
        selection: selectionKey ? selectionKey.split(":") : [],
        batchSize: capabilities(wallet, 0, TX_LIMITS.txPerSignAll).batchSize,
        lut,
        price: 0n,
        blockhash: PublicKey.default.toBase58(),
      })
        .then((value) => {
          if (active)
            setPlan(
              value.transactions
                ? {
                    bags: value.bags.length,
                    transactions: value.transactions,
                    approvals: value.approvals,
                  }
                : null,
            );
        })
        .catch(() => {
          if (active) setLoadError(true);
        });
    return () => {
      active = false;
    };
  }, [snapshot, owner, selectionKey, wallet, lut]);

  async function approve(rows: FeedViewProps["panel"]["rows"]) {
    const needs = rows.filter(
      (row) =>
        row.needsConfirm &&
        row.value.kind === "now" &&
        (approvedValues.current.get(row.coin.mint) ?? 0n) < row.value.lamports,
    );
    if (!needs.length) return;
    const accepted = await new Promise<boolean>((resolve) => {
      consentResult.current = resolve;
      setConsent({ rows: needs, selection: [] });
    });
    consentResult.current = null;
    setConsent(null);
    if (!accepted || !current()) throw consentCancelled;
    for (const row of needs)
      if (row.value.kind === "now")
        approvedValues.current.set(row.coin.mint, row.value.lamports);
  }
  async function beforeAttest(mints: readonly string[]) {
    const fresh = await readFeedWallet(rpc, owner);
    let quotes = quoteCache.current;
    if (
      Date.now() - quotes.quotedAt > WEB.configRefreshMs ||
      fresh.inventory.bags.some(
        (bag) =>
          mints.includes(bag.mint.toBase58()) &&
          !quotes.values.some(
            (quote) =>
              quote.mint === bag.mint.toBase58() &&
              BigInt(quote.amount) === bag.amount,
          ),
      )
    ) {
      quotes = await readFeedDisplay(owner, fresh);
      quoteCache.current = quotes;
      if (current()) setDisplay(quotes);
    }
    if (!current()) throw consentCancelled;
    await approve(
      feedRows({
        snapshot: fresh,
        display: quotes,
        unchecked: new Set(),
        refused: new Map(),
        confirmed: new Set(),
      }).filter((row) => mints.includes(row.coin.mint)),
    );
  }
  async function executeFeed(mints: string[]) {
    try {
      await runFeed({
        rpc,
        owner,
        wallet,
        account,
        chain,
        selection: mints,
        lut,
        price: await priorityFee(rpc),
        current,
        enabled: () => flag.current,
        beforeAttest,
        progress: (state) => {
          if (current()) setFlow(state);
        },
        refused: (mint, message) => {
          if (current()) setRefused((old) => new Map(old).set(mint, message));
        },
      });
    } catch (error) {
      if (current() && error === consentCancelled) setFlow(idle);
      else if (current()) {
        const message =
          error instanceof ApiError
            ? refusalMessage(error.code)
            : { key: errorCopy(error) };
        setFlow((state) =>
          error instanceof FeedInterrupted && error.flow
            ? error.flow
            : {
                ...state,
                phase:
                  error instanceof FeedInterrupted
                    ? (error.result.phase as Flow["phase"])
                    : message.key === "errors.walletNo"
                      ? "rejected"
                      : "failed",
                message,
              },
        );
      }
    } finally {
      if (current()) setConsent(null);
    }
  }
  async function feed(requested: string[], retry = false) {
    if (busy.current) return;
    busy.current = true;
    reads.beginAction();
    lastSelection.current = requested;
    approvedValues.current.clear();
    setFlow((state) => ({
      ...state,
      phase: "quoting",
      message: { key: "common.loading" },
    }));
    try {
      const fresh = await readFeedWallet(rpc, owner);
      const quotes = await readFeedDisplay(owner, fresh);
      if (!current()) return;
      // A retry keeps its journal, but only still-owned bags need a new Feed.
      // New selections must fail if any requested bag changed while loading.
      const mints = retry
        ? requested.filter((mint) =>
            fresh.inventory.bags.some((bag) => bag.mint.toBase58() === mint),
          )
        : requested;
      setSnapshot(fresh);
      setDisplay(quotes);
      quoteCache.current = quotes;
      const latest = feedRows({
        snapshot: fresh,
        display: quotes,
        unchecked: new Set(
          fresh.inventory.bags
            .filter((bag) => !mints.includes(bag.mint.toBase58()))
            .map((bag) => bag.mint.toBase58()),
        ),
        refused: new Map(),
        confirmed: new Set(),
      });
      if (
        mints.some(
          (mint) =>
            !latest.some((row) => row.coin.mint === mint && row.canFeed.open),
        )
      )
        throw new Error("Selection changed");
      const confirmations = latest.filter(
        (row) => mints.includes(row.coin.mint) && row.needsConfirm,
      );
      await approve(confirmations);
      await executeFeed(mints);
    } catch (error) {
      if (current())
        setFlow(
          error === consentCancelled
            ? idle
            : { ...idle, phase: "failed", message: { key: errorCopy(error) } },
        );
    } finally {
      busy.current = false;
      reads.endAction();
      if (current()) await refresh(true);
    }
  }
  function retryFeed() {
    setRefused(new Map());
    void feed(lastSelection.current, true);
  }
  async function takeBack(ids: string[]) {
    if (busy.current) return;
    busy.current = true;
    reads.beginAction();
    setMachineFlow({
      ...idle,
      phase: "planning",
      message: { key: "common.loading" },
    });
    try {
      const observedSlot = deckSlot.current;
      const entries = (deck ?? []).filter((entry) => ids.includes(entry.id));
      const price = await priorityFee(rpc);
      const prepared = await prepareTakeBack(rpc, {
        loadDeckHints,
        wallet: owner,
        entries,
        priorityFeeMicroLamports: price,
        blockhash: (await rpc.getLatestBlockhash("confirmed")).blockhash,
      });
      if (!current()) return;
      if (!prepared.batches.length) {
        const royalty = await readPulledRoyalty(
          rpc,
          owner,
          prepared.missing,
          observedSlot,
        );
        if (current())
          setMachineFlow({
            ...idle,
            message:
              royalty === null
                ? { key: "errors.cardMoved" }
                : { key: "takeBack.pulled", vars: { sol: sol(royalty) } },
          });
        busy.current = false;
        reads.endAction();
        await refreshDeck();
      } else
        setExitConsent({
          entries: prepared.batches.flatMap((batch) => batch.entries),
          prepared,
          price,
          observedSlot,
        });
    } catch (error) {
      busy.current = false;
      reads.endAction();
      if (current())
        setMachineFlow({
          ...idle,
          phase: "failed",
          message: { key: errorCopy(error) },
        });
    }
  }
  async function executeTakeBack() {
    if (!exitConsent) return;
    const request = exitConsent;
    setExitConsent(null);
    try {
      const outcome = await runTakeBack({
        loadDeckHints,
        rpc,
        owner,
        wallet,
        account,
        chain,
        entries: request.entries,
        price: request.price,
        current,
        maxTransactions: request.prepared.batches.length,
        maxAtaRentLamports: request.prepared.batches.reduce(
          (sum, batch) => sum + batch.ataRentLamports,
          0n,
        ),
        approveRetry: async (prepared) => {
          if (!current()) return false;
          const accepted = await new Promise<boolean>((resolve) => {
            exitRetryResult.current = resolve;
            setExitConsent({
              ...request,
              entries: prepared.batches.flatMap((batch) => batch.entries),
              prepared,
            });
          });
          exitRetryResult.current = null;
          setExitConsent(null);
          return accepted && current();
        },
        progress: (state) => {
          if (current())
            setMachineFlow({
              ...state,
              phase:
                state.phase === "building" || state.phase === "simulating"
                  ? "planning"
                  : state.phase,
              approvals: capabilities(
                wallet,
                state.total,
                TX_LIMITS.txPerSignAll,
              ).approvals,
              message: { key: "wallet.check" },
            });
        },
      });
      const royalty = outcome.missing.length
        ? await readPulledRoyalty(
            rpc,
            owner,
            outcome.missing,
            request.observedSlot,
          )
        : null;
      if (current() && outcome.landed > 0)
        setFlow((state) => (state.phase === "done" ? idle : state));
      if (current())
        setMachineFlow((state): Flow => ({
          ...state,
          phase: outcome.result.phase as Flow["phase"],
          message:
            outcome.result.phase !== "done"
              ? { key: outcome.result.copyKey ?? "errors.generic" }
              : outcome.missing.length
                ? royalty === null
                  ? { key: "errors.cardMoved" }
                  : { key: "takeBack.pulled", vars: { sol: sol(royalty) } }
                : {
                    key:
                      outcome.landed === 1
                        ? "takeBack.done.one"
                        : "takeBack.done.other",
                    vars: { n: count(outcome.landed) },
                  },
        }));
    } catch (error) {
      if (current())
        setMachineFlow((state) => ({
          ...state,
          phase: "failed",
          message: { key: errorCopy(error) },
        }));
    } finally {
      busy.current = false;
      reads.endAction();
      if (current()) await refresh(true);
    }
  }
  const cancel = () => {
    if (exitRetryResult.current) {
      exitRetryResult.current(false);
      return;
    }
    consentResult.current?.(false);
    busy.current = false;
    reads.endAction();
    setConsent(null);
    setExitConsent(null);
    setFlow(idle);
    setMachineFlow(idle);
  };
  const selected =
    snapshot?.inventory.bags.filter((bag) =>
      selection.includes(bag.mint.toBase58()),
    ) ?? [];
  const selectedAccounts = new Set(
    selected.flatMap((bag) =>
      bag.accounts.map((entry) => entry.address.toBase58()),
    ),
  );
  const empties =
    snapshot?.inventory.emptyAccounts.filter(
      (entry) => !selectedAccounts.has(entry.address.toBase58()),
    ) ?? [];
  const props: FeedViewProps = {
    soundOn,
    reducedMotion,
    onRip: () => navigate("/rip"),
    panel: {
      wallet: owner.toBase58(),
      rows,
      estimateLamports: estimate,
      rentBack: {
        accounts: empties.length,
        lamports: empties.reduce((sum, entry) => sum + entry.lamports, 0n),
      },
      deposits: snapshot
        ? depositLines(snapshot, selected)
        : { totalLamports: 0n, lines: [] },
      emptiedRentBackLamports: selected
        .flatMap((bag) => bag.accounts)
        .reduce((sum, entry) => sum + entry.lamports, 0n),
      machineToday: null,
      plan,
      explainer: {
        key: "feed.explainer",
        vars: { program: webDeployment().programId.toBase58() },
      },
      trust: { key: "feed.trust" },
      flow,
      gate:
        loadError || !snapshot
          ? { open: false, reason: { key: "common.networkError" } }
          : !selection.length && empties.length
            ? { open: true, reason: null }
            : feedGate(snapshot, enabled),
      onToggle: (mint, on) => {
        if (!busy.current) {
          setFlow(idle);
          setUnchecked((old) => {
            const next = new Set(old);
            if (on) next.delete(mint);
            else next.add(mint);
            return next;
          });
        }
      },
      onConfirmBag: (mint) => void feed([mint]),
      onFeed: ({ feed: mints }) => void feed(mints),
      onFeedOneFirst: () => void feed(selection.slice(0, 1)),
      onRefreshQuotes: () => void refresh(true),
      onRetry: retryFeed,
    },
    machine: {
      entries: (deck ?? []).map((entry) => ({
        entryId: entry.id,
        coin: bagCoin(entry, display),
        amountUi:
          decimals[entry.mint.toBase58()] === undefined
            ? t("xray.amountUnavailable")
            : amount(entry.amount, decimals[entry.mint.toBase58()]!),
        depositLamports: BigInt(entry.deposit),
        refed: Boolean(entry.flags & DECK_FLAGS.refed),
      })),
      vaultDeposits: vaultDeposits.map((entry) => ({
        ...entry,
        coin: bagCoin(entry, display),
      })),
      flow: machineFlow,
      onTakeBack: (ids) => void takeBack(ids),
    },
  };
  const exitTransactions = exitConsent?.prepared.batches.length ?? 0;
  const exitRent =
    exitConsent?.prepared.batches.reduce(
      (sum, batch) => sum + batch.ataRentLamports,
      0n,
    ) ?? 0n;
  const exitDeposit =
    exitConsent?.prepared.batches.reduce(
      (sum, batch) => sum + batch.refundLamports,
      0n,
    ) ?? 0n;
  if (deck === null)
    return (
      <section>
        <h1 tabIndex={-1}>{t("feed.titleNoWallet")}</h1>
        <p role="status">
          {machineFlow.message
            ? say(machineFlow.message.key, machineFlow.message.vars)
            : t("common.loading")}
        </p>
        <button type="button" onClick={() => void refreshDeck(true)}>
          {t("takeBack.findCards")}
        </button>
        <p>{t("takeBack.always")}</p>
        <RescueLink />
      </section>
    );
  return (
    <>
      <ExperienceSlot
        component="feed"
        load={loadFeed}
        props={props}
        poster={<FeedShape />}
        placeholder={<RescueLink />}
      />
      <button
        type="button"
        disabled={busy.current}
        onClick={() => void refreshDeck(true)}
      >
        {t("takeBack.findCards")}
      </button>
      {loadError && (
        <button type="button" onClick={() => void refresh(true)}>
          {t("common.retry")}
        </button>
      )}
      {(["failed", "partial", "expired", "rejected"].includes(flow.phase) ||
        refused.size > 0) && (
        <button type="button" disabled={busy.current} onClick={retryFeed}>
          {t("feed.retry")}
        </button>
      )}
      {props.machine.vaultDeposits.length > 0 && (
        <section aria-label={t("vault.title")}>
          <h2>{t("vault.title")}</h2>
          {props.machine.vaultDeposits.map((entry) => (
            <p key={entry.coin.mint}>
              {t(entry.state === "held" ? "vault.held" : "vault.returned", {
                ticker: entry.coin.ticker,
                sol: sol(entry.lamports),
              })}
            </p>
          ))}
        </section>
      )}
      <Royalties me={display.me} history={history} />
      <RescueLink />
      {consent && (
        <Consent
          title={t("feed.confirm.title")}
          yes={t("feed.confirm.yes")}
          no={t("feed.confirm.no")}
          accept={() => consentResult.current?.(true)}
          cancel={cancel}
        >
          {consent.rows.map((row) => (
            <p key={row.coin.mint}>
              {row.coin.ticker}{" "}
              {t("feed.confirm.body", {
                min: sol(FEED_BACK_RANGE.min),
                max: sol(FEED_BACK_RANGE.max),
                sol: sol(row.value.kind === "none" ? 0n : row.value.lamports),
              })}
            </p>
          ))}
        </Consent>
      )}
      {exitConsent && (
        <Consent
          title={t("takeBack.button")}
          yes={t("takeBack.buttonMany", {
            cards: plural("dustCards", exitConsent.entries.length),
            transactions: plural("transactions", exitTransactions),
            approvals: plural(
              "approvals",
              capabilities(wallet, exitTransactions, TX_LIMITS.txPerSignAll)
                .approvals,
            ),
          })}
          no={t("common.close")}
          accept={() =>
            exitRetryResult.current
              ? exitRetryResult.current(true)
              : void executeTakeBack()
          }
          cancel={cancel}
        >
          <p>
            {t("takeBack.presign.other", {
              cards: plural("dustCards", exitConsent.entries.length),
              deposit: sol(exitDeposit),
            })}
          </p>
          {exitRent > 0n && (
            <p>
              {t("takeBack.ata", {
                accounts: plural(
                  "newTokenAccounts",
                  exitConsent.prepared.batches.reduce(
                    (sum, batch) => sum + batch.ataAccounts,
                    0,
                  ),
                ),
                sol: solCost(exitRent),
              })}
            </p>
          )}
        </Consent>
      )}
    </>
  );
}
