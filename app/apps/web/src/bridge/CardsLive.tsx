import { DeploymentGate } from "./DeploymentGate";
import { deploymentChain } from "../data/deployment";
import { useEffect, useMemo, useRef, useState } from "react";
import { PACK_SPLIT_BPS, UI, WEB } from "@onepercent/config";
import { amount, cardTicker, t } from "@onepercent/copy";
import { readClock, readMints } from "@onepercent/sdk/rescue";
import { ValuesResponse, type ValuesOutput } from "@onepercent/web-api";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { binderClosable, cardRows, type CardsGates } from "../adapters/cards";
import { motionPref, soundPref, useStore } from "../app/prefs";
import { preloadModule } from "../app/lazy-module";
import { api } from "../data/api";
import { readBinderAccount, readMachine } from "../data/chain";
import { readWalletDeck, readWalletVaults } from "../data/cards";
import { useConfig } from "../data/config";
import { useFeedBackEstimate } from "../data/feed-back";
import { createRpc } from "../data/rpc";
import {
  CardsShape,
  bulkOptions,
  loadCards,
  type CardsData,
  type CardsViewProps,
} from "../experience";
import { navigate } from "../routes/router";
import {
  createCardActions,
  pendingPullRows,
  walletPulls,
} from "../tx/card-actions";
import { buildCardsExit } from "../tx/cards";
import { useWallet } from "../wallet/WalletProvider";
import { ExperienceSlot } from "./ExperienceSlot";

const empty: CardsData = {
  status: "loading",
  cards: [],
  pending: [],
  owedLamports: 0n,
  closeMyCards: null,
};

export const ready = () => preloadModule(loadCards);

/** The architect's component receives only chain-derived rows and transaction callbacks. */
export default function CardsLive() {
  return (
    <DeploymentGate flow="cards">
      <ConfiguredCardsLive />
    </DeploymentGate>
  );
}

function ConfiguredCardsLive() {
  const wallet = useWallet();
  const config = useConfig();
  const estimate = useFeedBackEstimate();
  const rpc = useMemo(() => createRpc(), []);
  const [data, setData] = useState<CardsData>(empty);
  const current = useRef({ wallet, config });
  current.current = { wallet, config };
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const actions = useMemo(
    () =>
      createCardActions({
        rpc,
        session: wallet.session,
        chain: deploymentChain(),
        flags: () => ({
          sell:
            current.current.config.data?.flags.SELL_BACK === true &&
            !current.current.config.error,
          feed:
            current.current.config.data?.flags.FEED === true &&
            !current.current.config.error,
        }),
        changed: () => {
          void refreshRef.current();
        },
      }),
    [rpc, wallet.session],
  );
  useEffect(() => {
    let disposed = false;
    let reading = false;
    const generation = wallet.generation;
    let lastValues = "";
    let valuesAsOfMs = 0;
    let values: ValuesOutput["items"] = [];
    let decimals = new Map<string, number>();
    const refresh = async () => {
      if (reading || disposed) return;
      reading = true;
      try {
        const address = wallet.session.snapshot().account?.address;
        if (!address) {
          setData({ ...empty, status: "ready", wallet: null });
          return;
        }
        const owner = new PublicKey(address);
        const [account, machineRead, balanceRead, clockRead] =
          await Promise.all([
            readBinderAccount(rpc, owner),
            readMachine(rpc).catch(() => null),
            rpc.getBalance(owner, "confirmed").catch(() => null),
            readClock(rpc).catch(() => null),
          ]);
        const binder = account?.binder ?? null;
        const nowTs = machineRead?.nowTs ?? clockRead?.unixTimestamp ?? 0n;
        const params = current.current.config;
        const gates: CardsGates = {
          config: machineRead?.config ?? null,
          machine: machineRead?.machine ?? null,
          nowTs,
          sell: params.data?.flags.SELL_BACK === true && !params.error,
          feed: params.data?.flags.FEED === true && !params.error,
        };
        const [pullsRead, deckRead, vaultRead] = await Promise.allSettled([
          walletPulls(rpc, owner, binder?.pull_nonce ?? 0),
          readWalletDeck(rpc, owner),
          readWalletVaults(rpc, owner),
        ]);
        const deck = deckRead.status === "fulfilled" ? deckRead.value : [];
        const items = [...(binder?.cards ?? []), ...deck];
        const signature = items
          .map((card) => `${card.mint}:${card.amount}`)
          .sort()
          .join("|");
        if (
          signature !== lastValues ||
          Date.now() - valuesAsOfMs >= WEB.configRefreshMs
        ) {
          const unique = [
            ...new Map(
              items.map((card) => [card.mint.toBase58(), card.mint]),
            ).values(),
          ];
          const mints = await readMints(rpc, unique).catch(() => []);
          decimals = new Map(
            mints.map((mint) => [mint.address.toBase58(), mint.decimals]),
          );
          const display: ValuesOutput["items"] = [];
          for (
            let start = 0;
            start < items.length;
            start += WEB.valuesBatchMax
          ) {
            const result = await api("/api/values", ValuesResponse, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode: "est",
                items: items
                  .slice(start, start + WEB.valuesBatchMax)
                  .map((card) => ({
                    mint: card.mint.toBase58(),
                    amount: `${card.amount}`,
                  })),
              }),
            }).catch(() => null);
            if (result) display.push(...result.items);
          }
          values = display;
          lastValues = signature;
          valuesAsOfMs = Date.now();
        }
        let closeMyCards: CardsData["closeMyCards"] = null;
        if (account && binderClosable(binder)) {
          const blockhash = (await rpc.getLatestBlockhash("confirmed"))
            .blockhash;
          const tx = buildCardsExit({
            wallet: owner,
            blockhash,
            binder: account.binder,
            action: "close_my_cards",
          });
          const result = await rpc
            .simulateTransaction(
              tx instanceof Transaction
                ? new VersionedTransaction(tx.compileMessage())
                : tx,
              {
                sigVerify: false,
                replaceRecentBlockhash: true,
                commitment: "confirmed",
              },
            )
            .catch(() => null);
          if (result && !result.value.err)
            closeMyCards = { lamports: account.lamports };
        }
        const coin = (mint: string) => {
          const value = values.find((row) => row.mint === mint);
          return {
            mint,
            ticker: cardTicker(value?.symbol ?? "", mint),
            name: value?.name ?? mint,
            logoUrl: value?.logo ?? null,
          };
        };
        if (disposed || wallet.session.snapshot().generation !== generation)
          return;
        setData((previous) => ({
          status: "ready",
          notice:
            !machineRead ||
            deckRead.status === "rejected" ||
            vaultRead.status === "rejected" ||
            pullsRead.status === "rejected"
              ? { key: "common.rpcOffline" }
              : null,
          wallet: {
            address,
            lamports: balanceRead === null ? null : BigInt(balanceRead),
          },
          cards: cardRows({ ...gates, binder, values, decimals }),
          pending:
            pullsRead.status === "fulfilled"
              ? pendingPullRows(pullsRead.value, nowTs)
              : previous.pending,
          owedLamports: binder?.sol_owed ?? 0n,
          closeMyCards,
          inTheMachine: {
            entries:
              deckRead.status === "rejected"
                ? (previous.inTheMachine?.entries ?? [])
                : deck.map((entry) => ({
                    entryId: `${entry.mint}:${entry.amount}:${entry.deckIndex}`,
                    coin: coin(entry.mint.toBase58()),
                    amountUi: decimals.has(entry.mint.toBase58())
                      ? amount(
                          entry.amount,
                          decimals.get(entry.mint.toBase58())!,
                        )
                      : t("common.noValue"),
                    depositLamports: BigInt(entry.deposit),
                    refed: (entry.flags & 2) !== 0,
                  })),
            vaultDeposits:
              vaultRead.status === "fulfilled"
                ? vaultRead.value.map((vault) => ({
                    coin: coin(vault.mint.toBase58()),
                    lamports: vault.ledgerLamports + vault.vaultLamports,
                    state: "held" as const,
                  }))
                : (previous.inTheMachine?.vaultDeposits ?? []),
          },
          valuesAsOfMs,
          config: {
            feedBackEstimateLamports: estimate,
            royaltyPct: `${PACK_SPLIT_BPS.royaltyPerDustCard / 100}%`,
            stillCrankingAfterMs: UI.stillCrankingAfterSeconds * 1000,
          },
        }));
      } catch {
        if (!disposed && wallet.session.snapshot().generation === generation)
          setData((previous) => ({
            ...previous,
            status: previous.status === "ready" ? "ready" : "error",
            notice: { key: "common.rpcOffline" },
          }));
      } finally {
        reading = false;
      }
    };
    setData(empty);
    refreshRef.current = refresh;
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, WEB.machinePollMs);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [rpc, wallet.session, wallet.generation, estimate]);
  const props: CardsViewProps = {
    data,
    soundOn: useStore(soundPref),
    reducedMotion: useStore(motionPref),
    highlight: new URLSearchParams(window.location.search).get("card"),
    onPreview: actions.preview,
    onAction: actions.execute,
    onRip: () => navigate("/rip"),
    onVerify: (seq) => navigate(`/verify/${seq}`),
    onRefresh: () => {
      void refreshRef.current();
    },
  };
  return (
    <ExperienceSlot
      component="cards"
      load={loadCards}
      props={props}
      poster={
        <CardsShape
          empty={data.cards.length === 0}
          bulk={bulkOptions(data.cards, estimate).length}
        />
      }
      placeholder={null}
    />
  );
}
