import { replaceRipSelection } from "./rip-selection";
import { DeploymentGate } from "./DeploymentGate";
import { webDeployment, deploymentChain } from "../data/deployment";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  HIT_TIERS,
  PACK_EDITIONS,
  WEB,
  UI,
  VRF,
  type EditionId,
} from "@onepercent/config";
import { sol, solCost, t, type CopyKey, type CopyVars } from "@onepercent/copy";
import {
  buildRefundTransaction,
  fetchPull,
  PULL_STATUS,
  type Pull,
} from "@onepercent/sdk/browser";
import { MachineResponse } from "@onepercent/sdk/api";
import type { PackRevealed } from "@onepercent/sdk/events";
import { ValuesResponse } from "@onepercent/web-api";
import { PublicKey, Transaction } from "@solana/web3.js";
import { readClock } from "@onepercent/sdk/rescue";
import { RipShape, loadRip, type RipViewProps } from "../experience/index";
import { createRpc } from "../data/rpc";
import { api } from "../data/api";
import { useConfig } from "../data/config";
import { readBinder, readBinderAccount, readMachine } from "../data/chain";
import { loadPullEvidence, type PullEvidence } from "../data/pull";
import { storedReferral } from "../data/referral";
import { liveStream, useLive } from "../data/use-live";
import { useWallet } from "../wallet/WalletProvider";
import { clampQuantity, editionModels } from "../adapters/edition";
import { identifyCards } from "../adapters/cards";
import { planRip, type RipSnapshot } from "../tx/rip";
import { prepareSettles, runSettles, type PreparedSettles } from "../tx/settle";
import { ripSimulationError } from "../tx/rip-errors";
import { watchPull } from "../tx/watch-pull";
import { executeTransactions } from "../tx/runtime";
import { createCardActions } from "../tx/card-actions";
import { EngineError, errorCopy } from "../tx/engine/errors";
import { motionPref, soundPref, useStore } from "../app/prefs";
import { ripPreview } from "../adapters/rip-preview";
import { navigate } from "../routes/router";
import { ExperienceSlot } from "./ExperienceSlot";
import { preloadModule } from "../app/lazy-module";
import { decodeImage } from "../app/decode-image";
import { machinePoster } from "../experience/index";

// Adapter messages carry preformatted variables; the translator validates each placeholder.
const messageText = (key: CopyKey, vars: Record<string, string> = {}) =>
  t(key, vars as CopyVars<CopyKey>);

export const ready = () =>
  Promise.all([
    preloadModule(loadRip),
    decodeImage(machinePoster("/experience/rip/")),
  ]);

export default function RipLive() {
  return (
    <DeploymentGate flow="rip">
      <ConfiguredRipLive />
    </DeploymentGate>
  );
}

function ConfiguredRipLive() {
  const wallet = useWallet();
  const config = useConfig();
  const rpc = useMemo(() => createRpc(), []);
  const [snapshot, setSnapshot] = useState<RipSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [message, setMessage] = useState<CopyKey | null>(null);
  const [refunding, setRefunding] = useState(false);
  const pendingAddress = useRef<PublicKey | null>(null);
  const prepared = useRef<{
    plan: Awaited<ReturnType<typeof planRip>>;
    generation: number;
    settles: PreparedSettles;
  } | null>(null);
  const quantity = useRef(
    clampQuantity(
      new URLSearchParams(window.location.search).get("n"),
      Math.max(...PACK_EDITIONS.map((edition) => edition.maxPerRip)),
    ),
  );
  const [pending, setPending] = useState<Pull | null>(null);
  const [evidence, setEvidence] = useState<PullEvidence | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const active = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const selected = useRef<EditionId>(
    (
      PACK_EDITIONS.find(
        (edition) =>
          edition.id ===
          new URLSearchParams(window.location.search).get("edition"),
      ) ?? PACK_EDITIONS[0]
    ).id,
  );
  const last = useRef<PullEvidence | null>(null);
  const sellOffers = useRef(new Map<number, { payout: bigint }>());
  const currentFlags = useRef(config.data?.flags);
  currentFlags.current = config.error ? undefined : config.data?.flags;
  const chain = deploymentChain();
  const actions = useMemo(
    () =>
      createCardActions({
        rpc,
        session: wallet.session,
        chain,
        flags: () => ({
          sell: !!currentFlags.current?.SELL_BACK,
          feed: !!currentFlags.current?.FEED,
        }),
      }),
    [rpc, wallet.session, chain],
  );
  useLive();

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const [machine, apiMachine] = await Promise.all([
          readMachine(rpc),
          api("/api/machine", MachineResponse).catch(() => null),
        ]);
        if (!live) return;
        setSnapshot({
          ...machine,
          deckLen: machine.deck.len,
          binder: null,
          binderLamports: 0n,
          vrf: apiMachine?.vrf ?? null,
        });
        setSnapshotError(false);
        if (wallet.account) {
          const lamports = await rpc.getBalance(
            new PublicKey(wallet.account.address),
            "confirmed",
          );
          if (live && Number.isSafeInteger(lamports))
            setBalance(BigInt(lamports));
        } else setBalance(null);
      } catch {
        if (live) {
          setSnapshot(null);
          setSnapshotError(true);
        }
      }
      if (live)
        timer = setTimeout(
          () => void poll(),
          document.hidden ? WEB.machinePollHiddenMs : WEB.machinePollMs,
        );
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [rpc, wallet.account?.address]);
  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );
  useEffect(() => {
    abort.current?.abort();
    active.current = false;
    setPending(null);
    setEvidence(null);
    last.current = null;
    sellOffers.current.clear();
    prepared.current = null;
    pendingAddress.current = null;
    setSubmitted(false);
  }, [wallet.generation]);

  async function hitId(
    pack: PackRevealed | undefined = last.current?.packs[0],
  ) {
    const owner = wallet.session.snapshot().account;
    if (!owner || !pack) throw new EngineError("errors.cardMoved");
    const binder = await readBinder(rpc, new PublicKey(owner.address));
    const card = identifyCards(binder?.cards ?? []).find(
      (card) =>
        card.kind === pack.tier &&
        card.mint.toBase58() === pack.hit_mint &&
        card.amount === pack.hit_amount &&
        card.value === pack.hit_value &&
        card.edition === pack.edition &&
        BigInt(card.seq_lo) === BigInt.asUintN(32, pack.seq),
    );
    if (!card) throw new EngineError("errors.cardMoved");
    return card.cardId;
  }

  async function makePlan(edition: EditionId, qty: number) {
    const state = wallet.session.snapshot();
    if (!state.account) throw new EngineError("wallet.noAccount");
    const owner = new PublicKey(state.account.address);
    const read = async (): Promise<RipSnapshot> => {
      const [machine, binder, apiMachine] = await Promise.all([
        readMachine(rpc),
        readBinderAccount(rpc, owner),
        api("/api/machine", MachineResponse).catch(() => null),
      ]);
      return {
        ...machine,
        deckLen: machine.deck.len,
        binder: binder?.binder ?? null,
        binderLamports: binder?.lamports ?? 0n,
        vrf: apiMachine?.vrf ?? null,
      };
    };
    return planRip({
      wallet: owner,
      edition,
      qty,
      packsEnabled: () => !!currentFlags.current?.PACKS,
      referral: storedReferral() ?? undefined,
      read,
      rent: async (size) =>
        BigInt(await rpc.getMinimumBalanceForRentExemption(size, "confirmed")),
      exists: async (address) =>
        (await fetchPull(webDeployment().programId, rpc, address)) !== null,
    });
  }
  async function refund() {
    const address = pendingAddress.current;
    const state = wallet.session.snapshot();
    if (!address || !state.account || refunding) return;
    setRefunding(true);
    try {
      const owner = new PublicKey(state.account.address);
      const item = {
        id: `refund:${address.toBase58()}`,
        phase: 1,
        async build(blockhash: { blockhash: string }) {
          const [pull, clock, buyer] = await Promise.all([
            fetchPull(webDeployment().programId, rpc, address),
            readClock(rpc),
            rpc.getAccountInfo(owner, "confirmed"),
          ]);
          if (
            !pull ||
            !pull.buyer.equals(owner) ||
            pull.status !== PULL_STATUS.pending ||
            clock.unixTimestamp < pull.created_ts + BigInt(VRF.timeoutSeconds)
          )
            throw new EngineError("rip.timeout");
          return buildRefundTransaction(webDeployment().programId, {
            wallet: owner,
            blockhash: blockhash.blockhash,
            pull: address,
            seq: pull.seq,
            buyer: { address: owner, executable: !!buyer?.executable },
          });
        },
        landed: async () => {
          if (await fetchPull(webDeployment().programId, rpc, address))
            return false;
          return (
            (
              await loadPullEvidence(
                rpc,
                address,
                pending?.seq,
                pending ?? undefined,
              )
            )?.refunded === true
          );
        },
      };
      const result = await executeTransactions({
        rpc,
        session: wallet.session,
        chain,
        items: [item],
      });
      if (result.phase !== "done")
        throw new EngineError(result.copyKey ?? "errors.generic");
      const evidence = await loadPullEvidence(
        rpc,
        address,
        pending?.seq,
        pending ?? undefined,
      );
      if (!evidence?.refunded) throw new EngineError("errors.generic");
      setPending(null);
      setMessage("rip.refunded");
      pendingAddress.current = null;
    } catch (error) {
      setMessage(errorCopy(error));
    } finally {
      setRefunding(false);
    }
  }

  const props: RipViewProps = {
    edition: selected.current,
    quantity: quantity.current,
    available: !!config.data?.flags.PACKS,
    maxQty: (edition) =>
      snapshot
        ? editionModels(snapshot).find((model) => model.id === edition)!.maxQty
        : 0,
    onQty: (qty) => {
      quantity.current = qty;
      prepared.current = null;
      replaceRipSelection(selected.current, qty);
    },
    onPrepare: async (edition, qty, signal) => {
      const state = wallet.session.snapshot();
      prepared.current = null;
      signal?.throwIfAborted();
      const [plan, blockhash] = await Promise.all([
        makePlan(edition, qty),
        rpc.getLatestBlockhash("confirmed"),
      ]);
      signal?.throwIfAborted();
      if (wallet.session.snapshot().generation !== state.generation)
        throw new EngineError("errors.cardMoved");
      const costs = plan.costs;
      const [settles, transaction] = await Promise.all([
        prepareSettles({
          rpc,
          owner: new PublicKey(state.account!.address),
          blockhash: blockhash.blockhash,
        }),
        plan.item.build(blockhash),
      ]);
      signal?.throwIfAborted();
      const [fee, currentBalance] = await Promise.all([
        rpc.getFeeForMessage(
          transaction instanceof Transaction
            ? transaction.compileMessage()
            : transaction.message,
          "confirmed",
        ),
        rpc.getBalance(new PublicKey(state.account!.address), "confirmed"),
      ]);
      if (
        fee.value === null ||
        !Number.isSafeInteger(fee.value) ||
        fee.value < 0 ||
        !Number.isSafeInteger(currentBalance) ||
        currentBalance < 0
      )
        throw new EngineError("errors.simulation");
      if (wallet.session.snapshot().generation !== state.generation)
        throw new EngineError("errors.cardMoved");
      const total =
        costs.price +
        costs.drawFee +
        costs.pullDeposit +
        costs.binderDeposit +
        BigInt(fee.value) +
        settles.feeLamports;
      signal?.throwIfAborted();
      prepared.current = { plan, settles, generation: state.generation };
      return {
        ...ripPreview({
          quantity: qty,
          priceEach: plan.edition.priceLamports,
          costs,
          networkFee: BigInt(fee.value),
          program: webDeployment().programId.toBase58(),
          referrer: plan.referrer?.toBase58(),
          settleCount: settles.groups.length,
          settleFee: settles.feeLamports,
        }),
        pullId: plan.address.toBase58(),
        ...(BigInt(currentBalance) - total < UI.keepBalanceWarningLamports
          ? {
              warning: t("rip.preview.keepBalance", {
                sol: solCost(UI.keepBalanceWarningLamports),
              }),
            }
          : {}),
      };
    },
    balanceUi: balance === null ? null : sol(balance),
    soundOn: useStore(soundPref),
    reducedMotion: useStore(motionPref),
    gate: (edition) => {
      if (config.loading && !config.data)
        return { open: false, reason: t("common.loading") };
      if (snapshot && !config.data?.flags.PACKS) {
        const state = editionModels(snapshot).find(
          (model) => model.id === edition,
        )!;
        return {
          open: false,
          reason:
            state.state === "covered"
              ? t("errors.paused")
              : messageText(state.stateLine.key, state.stateLine.vars),
        };
      }
      if (!wallet.account) return { open: false, reason: t("wallet.connect") };
      if (config.error || !config.data?.flags.PACKS || snapshotError)
        return { open: false, reason: t("common.networkError") };
      if (!snapshot) return { open: false, reason: t("common.loading") };
      if (active.current) return { open: false, reason: t("common.loading") };
      const model = editionModels({ ...snapshot, qty: quantity.current }).find(
        (item) => item.id === edition,
      )!;
      return {
        open: model.state === "covered",
        reason:
          model.state === "covered"
            ? null
            : messageText(model.stateLine.key, model.stateLine.vars),
      };
    },
    onRip: async (edition, qty) => {
      const state = wallet.session.snapshot();
      if (!state.account || active.current)
        throw new EngineError("wallet.noAccount");
      if (config.error) throw new EngineError("common.networkError");
      active.current = true;
      setMessage("common.loading");
      setPending(null);
      setEvidence(null);
      sellOffers.current.clear();
      pendingAddress.current = null;
      setSubmitted(false);
      const owner = new PublicKey(state.account.address);
      const controller = new AbortController();
      abort.current = controller;
      try {
        const approved = prepared.current;
        prepared.current = null;
        if (
          !approved ||
          approved.generation !== state.generation ||
          approved.plan.edition.id !== edition ||
          approved.plan.qty !== qty
        )
          throw new EngineError("errors.simulation");
        const plan = approved.plan;
        pendingAddress.current = plan.address;
        await runSettles({
          rpc,
          session: wallet.session,
          chain,
          prepared: approved.settles,
        });
        const sent = await executeTransactions({
          rpc,
          session: wallet.session,
          chain,
          items: [plan.item],
          simulationError: ripSimulationError,
          onSignature: () => setSubmitted(true),
        });
        if (sent.phase !== "done" && sent.unknown.size === 0)
          throw new EngineError(sent.copyKey ?? "errors.generic");
        const result = await watchPull(
          {
            read: () => fetchPull(webDeployment().programId, rpc, plan.address),
            evidence: (seq, current) =>
              loadPullEvidence(rpc, plan.address, seq, current),
            chainNow: async () => (await readClock(rpc)).unixTimestamp,
            display: (items) =>
              api("/api/values", ValuesResponse, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "now", items }),
              }),
            sell: async (packs) => {
              const offers = new Map<number, { payout: bigint }>();
              for (const pack of packs) {
                if (pack.tier < 1 || pack.tier > HIT_TIERS.length) continue;
                if (wallet.session.snapshot().generation !== state.generation)
                  break;
                const id = await hitId(pack);
                const quote = await actions.preview("sell_back", [id]);
                if (wallet.session.snapshot().generation !== state.generation)
                  break;
                if (
                  quote?.gate?.open !== false &&
                  quote?.receive?.kind === "now"
                )
                  offers.set(pack.pack, { payout: quote.receive.lamports });
              }
              return offers;
            },
            subscribeHint: (listener) => liveStream.subscribe(listener),
          },
          {
            buyer: owner.toBase58(),
            edition: plan.edition.index,
            qty: plan.qty,
          },
          { signal: controller.signal },
        );
        if (wallet.session.snapshot().generation !== state.generation)
          throw new EngineError("errors.cardMoved");
        if (result.state !== "revealed") {
          if (result.state === "refundable") {
            setPending(result.pull);
            throw new EngineError("rip.timeout");
          }
          throw new EngineError("rip.refunded");
        }
        if (wallet.session.snapshot().generation !== state.generation)
          throw new EngineError("errors.cardMoved");
        last.current = result.evidence;
        sellOffers.current = result.sell;
        setEvidence(result.evidence);
        setMessage(null);
        return {
          pullId: plan.address.toBase58(),
          result: result.results[0]!,
          results: result.results,
        };
      } catch (error) {
        if (wallet.session.snapshot().generation === state.generation)
          setMessage(errorCopy(error));
        throw error;
      } finally {
        if (wallet.session.snapshot().generation === state.generation)
          active.current = false;
      }
    },
    failureMessage: (error) => messageText(errorCopy(error)),
    onAction: async (_index, _action, packIndex = 0) => {
      const offered = sellOffers.current.get(packIndex)?.payout;
      if (offered === undefined)
        throw new EngineError("cards.sell.refusal.closed");
      const id = await hitId(
        last.current?.packs.find((pack) => pack.pack === packIndex),
      );
      const preview = await actions.preview("sell_back", [id]);
      if (
        !preview ||
        preview.gate?.open === false ||
        preview.receive?.kind !== "now" ||
        preview.receive.lamports < offered
      )
        throw new EngineError("cards.sell.refusal.closed");
      const result = await actions.execute("sell_back", [id]);
      return {
        solUi:
          result.receivedLamports === undefined
            ? undefined
            : sol(result.receivedLamports),
      };
    },
    onMyCards: (_index, packIndex = 0) => {
      void hitId(
        last.current?.packs.find((pack) => pack.pack === packIndex),
      ).then(
        (id) => navigate(`/cards?card=${encodeURIComponent(id)}`),
        () => navigate("/cards"),
      );
    },
    onVerify: () => {
      if (last.current) navigate(`/verify/${last.current.header.seq}`);
    },
    onShare: (text) => {
      const url = last.current
        ? `${window.location.origin}/verify/${last.current.header.seq}`
        : window.location.href;
      if (navigator.share)
        void navigator.share({ text, url }).catch(() => undefined);
      else
        void navigator.clipboard
          ?.writeText(`${text} ${url}`)
          .catch(() => undefined);
    },
    onEdition: (edition) => {
      selected.current = edition;
      prepared.current = null;
      replaceRipSelection(edition, quantity.current);
    },
  };
  return (
    <>
      <ExperienceSlot
        key={wallet.generation}
        component="rip"
        load={loadRip}
        props={props}
        poster={<RipShape assets="/experience/rip/" />}
        placeholder={null}
      />
      <aside aria-live="polite">
        {message && <p role="status">{messageText(message)}</p>}
        {pending && (
          <button
            type="button"
            disabled={refunding}
            onClick={() => void refund()}
          >
            {t(refunding ? "common.loading" : "rip.refund")}
          </button>
        )}
        {(pending || submitted) && <a href="/cards">{t("nav.cards")}</a>}
        {evidence && (
          <a href={`/verify/${evidence.header.seq}`}>{t("common.verify")}</a>
        )}
      </aside>
    </>
  );
}
