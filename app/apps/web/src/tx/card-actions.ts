import { webDeployment } from "../data/deployment";
import { ACCOUNT_SIZES, PACK_EDITIONS, VRF, WEB } from "@onepercent/config";
import { count, solCost, t, type CopyKey } from "@onepercent/copy";
import {
  userAta,
  buildTakeBackTransactions,
  type BuiltTransaction,
} from "@onepercent/sdk/browser";
import { SellBackQuoteResponse } from "@onepercent/sdk/api";
import { parseOnepercentLogs } from "@onepercent/sdk/events";
import {
  planRefund,
  planSettle,
  readMints,
  type RescuePlan,
  type RescuePull,
} from "@onepercent/sdk/rescue";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
  type Connection,
} from "@solana/web3.js";
import type { ActionPreview, CardsAction } from "../experience";
import type { WalletSession } from "../wallet/session";
import {
  actionGates,
  cardBatches,
  identifyCards,
  resolveCards,
  type SelectedCard,
} from "../adapters/cards";
import { api } from "../data/api";
import { readBinder, readBinderAccount, readMachine } from "../data/chain";
import { readWalletDeck, readWalletPulls } from "../data/cards";
import {
  buildCardFeeds,
  buildCardRedeems,
  buildCardSell,
  buildCardsExit,
  checkedSellQuote,
  type CardToken,
  type CheckedSellQuote,
} from "./cards";
import { EngineError, errorCopy } from "./engine/errors";
import { executeTransactions } from "./runtime";
import { prepareSettles, runSettles, type PreparedSettles } from "./settle";
import type { Progress } from "./engine/progress";
import { feedBackValues } from "./feed-back-values";

type Options = {
  rpc: Connection;
  session: WalletSession;
  chain: "solana:devnet" | "solana:mainnet";
  flags(): { sell: boolean; feed: boolean };
  changed?(): void;
};
type Prepared = {
  generation: number;
  sellBatches: { cards: SelectedCard[]; payout: bigint }[];
  expiry: bigint | null;
  settles: PreparedSettles;
  transactionCount: number;
};
const quoteQueues = new Map<string, Promise<unknown>>();

/** All mounted controllers share the one-in-flight rule for a Binder. */
export function serialSellQuote<T>(binder: string, request: () => Promise<T>) {
  const next = (quoteQueues.get(binder) ?? Promise.resolve())
    .catch(() => {})
    .then(request);
  quoteQueues.set(binder, next);
  const clear = () => {
    if (quoteQueues.get(binder) === next) quoteQueues.delete(binder);
  };
  void next.then(clear, clear);
  return next;
}
const selectionKey = (ids: readonly string[]) => [...ids].sort().join("|");
const requestKey = (action: CardsAction, ids: readonly string[]) =>
  `${action}:${selectionKey(ids)}`;
const line = (key: CopyKey, vars?: Record<string, string>) => ({ key, vars });
const cardIdentity = (card: SelectedCard) =>
  `${card.seq_lo}:${card.kind}:${card.mint}:${card.amount}:${card.value}:${card.edition}:${card.flags}`;

/** Re-resolve remaining cards after each confirmed swap-remove, including identical copies. */
export function rebindCards(
  current: readonly SelectedCard[],
  selected: readonly SelectedCard[],
) {
  const available = [...current];
  return selected
    .map((expected) => {
      const index = available.findIndex(
        (card) => cardIdentity(card) === cardIdentity(expected),
      );
      if (index < 0) throw new EngineError("errors.cardMoved");
      return available.splice(index, 1)[0]!;
    })
    .sort((a, b) => b.cardIndex - a.cardIndex);
}

export const walletPulls = readWalletPulls;

export function pendingPullRows(pulls: readonly RescuePull[], nowTs: bigint) {
  return pulls.flatMap((pull) => {
    const edition = PACK_EDITIONS[pull.edition];
    if (!edition) return [];
    return [
      {
        seq: `${pull.seq}`,
        edition: edition.id,
        qty: pull.qty,
        state:
          pull.status === 1
            ? nowTs >= pull.created_ts + BigInt(VRF.timeoutSeconds)
              ? ("refundable" as const)
              : ("drawing" as const)
            : ("settling" as const),
        refundLamports: pull.price * BigInt(pull.qty),
        createdMs: Number(pull.created_ts) * WEB.millisecondsPerSecond,
      },
    ];
  });
}

/** One active quote request and action per wallet controller. No service is needed for exits. */
export function createCardActions(options: Options) {
  const { rpc, session } = options;
  const prepared = new Map<string, Prepared>();
  let active = false;
  const ownerState = () => {
    const state = session.snapshot();
    if (!state.account || !state.wallet)
      throw new EngineError("wallet.noAccount");
    return {
      owner: new PublicKey(state.account.address),
      generation: state.generation,
    };
  };
  const tokens = async (
    cards: readonly SelectedCard[],
  ): Promise<CardToken[]> => {
    const mints = await readMints(rpc, [
      ...new Map(
        cards.map((card) => [card.mint.toBase58(), card.mint]),
      ).values(),
    ]);
    return cards.map((card) => ({
      ...card,
      tokenProgram: mints.find((mint) => mint.address.equals(card.mint))!
        .tokenProgram,
    }));
  };
  const quote = (
    owner: PublicKey,
    cards: readonly SelectedCard[],
  ): Promise<CheckedSellQuote> => {
    const generation = session.snapshot().generation;
    return serialSellQuote(`${options.chain}:${owner.toBase58()}`, async () => {
      if (session.snapshot().generation !== generation)
        throw new EngineError("errors.cardMoved");
      const [binder, machine] = await Promise.all([
        readBinder(rpc, owner),
        readMachine(rpc),
      ]);
      if (!binder) throw new EngineError("errors.cardMoved");
      const current = rebindCards(identifyCards(binder.cards), cards);
      if (!actionGates(1, { ...machine, ...options.flags() }).sellBack.open)
        throw new EngineError("cards.sell.refusal.closed");
      const response = await api("/api/sellback/quote", SellBackQuoteResponse, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: owner.toBase58(),
          cardIndices: current.map((card) => card.cardIndex),
        }),
      });
      const [freshBinder, freshMachine] = await Promise.all([
        readBinder(rpc, owner),
        readMachine(rpc),
      ]);
      if (!freshBinder || session.snapshot().generation !== generation)
        throw new EngineError("errors.cardMoved");
      if (
        !actionGates(1, { ...freshMachine, ...options.flags() }).sellBack.open
      )
        throw new EngineError("cards.sell.refusal.closed");
      return checkedSellQuote({
        response,
        wallet: owner,
        cards: rebindCards(identifyCards(freshBinder.cards), cards),
        binder: freshBinder,
        signer: freshMachine.config.quote_signer,
        nowTs: freshMachine.nowTs,
      });
    });
  };

  async function rescue(
    action: CardsAction,
    ids: readonly string[],
    owner: PublicKey,
    blockhash: string,
  ): Promise<RescuePlan> {
    const base = {
      rpc,
      programId: webDeployment().programId,
      wallet: owner,
      blockhash,
    };
    if (action === "take_back") {
      const entries = await readWalletDeck(rpc, owner);
      const selected = entries.filter((entry) =>
        ids.includes(`${entry.mint}:${entry.amount}:${entry.deckIndex}`),
      );
      if (selected.length !== ids.length)
        throw new EngineError("errors.cardMoved");
      const mints = await readMints(
        rpc,
        selected.map((entry) => entry.mint),
      );
      return {
        remaining: [],
        transactions: buildTakeBackTransactions(webDeployment().programId, {
          wallet: owner,
          blockhash,
          entries: selected.map((entry) => ({
            ...entry,
            tokenProgram: mints.find((mint) => mint.address.equals(entry.mint))!
              .tokenProgram,
          })),
        }).map((transaction) => ({
          transaction,
          action: "take-back" as const,
          addresses: selected.map((entry) => entry.mint.toBase58()),
        })),
      };
    }
    const binder = await readBinder(rpc, owner);
    const pulls = (
      await walletPulls(rpc, owner, binder?.pull_nonce ?? 0)
    ).filter((pull) => ids.includes(`${pull.seq}`));
    if (!pulls.length) return { transactions: [], remaining: [] };
    return action === "settle"
      ? planSettle({ ...base, pulls: pulls.map((pull) => pull.address) })
      : planRefund({ ...base, pulls: pulls.map((pull) => pull.address) });
  }

  async function preview(
    action: CardsAction,
    ids: string[],
  ): Promise<ActionPreview | null> {
    prepared.delete(requestKey(action, ids));
    try {
      const { owner, generation } = ownerState();
      const account = await readBinderAccount(rpc, owner);
      const binder = account?.binder ?? null;
      const blockhash = (await rpc.getLatestBlockhash("confirmed")).blockhash;
      let transactions: BuiltTransaction[] = [];
      const lines: ActionPreview["lines"] = [];
      const sellBatches: Prepared["sellBatches"] = [];
      let receive: bigint | null = null;
      let expiry: bigint | null = null;
      let ttlSeconds: number | undefined;
      let feedValues: ActionPreview["feedBackValues"];
      if (
        action === "redeem" ||
        action === "feed_back" ||
        action === "sell_back"
      ) {
        const cards = resolveCards(binder, ids);
        if (action === "redeem") {
          const withTokens = await tokens(cards);
          transactions = buildCardRedeems({
            wallet: owner,
            blockhash,
            cards: withTokens,
          });
          const unique = [
            ...new Map(
              withTokens.map((card) => [card.mint.toBase58(), card]),
            ).values(),
          ];
          const atas = await rpc.getMultipleAccountsInfo(
            unique.map((card) => userAta(owner, card.mint, card.tokenProgram)),
            "confirmed",
          );
          let rent = 0n,
            accounts = 0;
          for (const [i, ata] of atas.entries())
            if (!ata) {
              accounts++;
              rent += BigInt(
                await rpc.getMinimumBalanceForRentExemption(
                  unique[i]!.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)
                    ? ACCOUNT_SIZES.vaultToken2022
                    : ACCOUNT_SIZES.vaultSpl,
                  "confirmed",
                ),
              );
            }
          if (accounts)
            lines.push(
              line(
                accounts === 1
                  ? "cards.details.ata.one"
                  : "cards.details.ata.other",
                { n: count(accounts), sol: solCost(rent) },
              ),
            );
        } else if (action === "feed_back") {
          const machine = await readMachine(rpc);
          if (!actionGates(0, { ...machine, ...options.flags() }).feedBack.open)
            throw new EngineError("errors.paused");
          feedValues = await feedBackValues(cards);
          // A value request must not turn a changed selection into an approved one.
          const freshCards = resolveCards(await readBinder(rpc, owner), ids);
          if (
            selectionKey(freshCards.map(cardIdentity)) !==
            selectionKey(cards.map(cardIdentity))
          )
            throw new EngineError("errors.cardMoved");
          transactions = buildCardFeeds({
            wallet: owner,
            blockhash,
            cards: freshCards,
          });
          const entryRent =
            BigInt(
              await rpc.getMinimumBalanceForRentExemption(
                ACCOUNT_SIZES.deckHeader + ACCOUNT_SIZES.deckEntry,
                "confirmed",
              ),
            ) -
            BigInt(
              await rpc.getMinimumBalanceForRentExemption(
                ACCOUNT_SIZES.deckHeader,
                "confirmed",
              ),
            );
          lines.push(
            line(
              cards.length === 1
                ? "cards.details.deposit.one"
                : "cards.details.deposit.other",
              {
                n: count(cards.length),
                sol: solCost(entryRent * BigInt(cards.length)),
              },
            ),
          );
        } else {
          receive = 0n;
          for (const group of cardBatches(cards, true)) {
            const q = await quote(owner, group);
            receive += q.payoutLamports;
            sellBatches.push({ cards: group, payout: q.payoutLamports });
            expiry = expiry === null || q.expiry < expiry ? q.expiry : expiry;
            transactions.push(
              buildCardSell({
                wallet: owner,
                blockhash,
                cards: await tokens(group),
                quote: q,
              }),
            );
          }
          const now = await readMachine(rpc);
          ttlSeconds = Math.max(0, Number(expiry! - now.nowTs));
        }
      } else if (action === "withdraw_owed" || action === "close_my_cards") {
        if (!binder) throw new EngineError("errors.cardMoved");
        transactions = [
          buildCardsExit({ wallet: owner, blockhash, binder, action }),
        ];
        if (action === "withdraw_owed") {
          const rent = BigInt(
            await rpc.getMinimumBalanceForRentExemption(
              account!.dataLength,
              "confirmed",
            ),
          );
          const available =
            account!.lamports > rent ? account!.lamports - rent : 0n;
          receive = binder.sol_owed < available ? binder.sol_owed : available;
        } else receive = account!.lamports;
      } else
        transactions = (
          await rescue(action, ids, owner, blockhash)
        ).transactions.map((item) => item.transaction);
      let fee = 0n;
      for (const transaction of transactions) {
        const message =
          transaction instanceof Transaction
            ? transaction.compileMessage()
            : transaction.message;
        const result = await rpc.getFeeForMessage(message, "confirmed");
        if (result.value === null) throw new EngineError("errors.tooLong");
        fee += BigInt(result.value);
      }
      if (action === "close_my_cards") {
        const transaction = transactions[0]!;
        const result = await rpc.simulateTransaction(
          transaction instanceof Transaction
            ? new VersionedTransaction(transaction.compileMessage())
            : transaction,
          {
            sigVerify: false,
            replaceRecentBlockhash: true,
            commitment: "confirmed",
          },
        );
        if (result.value.err) throw new EngineError("errors.simulation");
      }
      lines.unshift(
        line("cards.details.batch", {
          transactions: t("count.transactions", {
            n: count(transactions.length),
          }),
          approvals: t("count.approvals", { n: count(transactions.length) }),
        }),
        line("cards.details.networkFee", { sol: solCost(fee) }),
      );
      const settles =
        action === "redeem" || action === "feed_back" || action === "sell_back"
          ? await prepareSettles({ rpc, owner, blockhash })
          : { groups: [], feeLamports: 0n };
      if (settles.groups.length)
        lines.push(
          line("settle.prepend", {
            transactions: t("count.transactions", {
              n: count(settles.groups.length),
            }),
          }),
          line("settle.fees", { sol: solCost(settles.feeLamports) }),
          line("settle.optional"),
        );
      if (session.snapshot().generation !== generation)
        throw new EngineError("errors.cardMoved");
      prepared.set(requestKey(action, ids), {
        generation,
        sellBatches,
        expiry,
        settles,
        transactionCount: transactions.length,
      });
      return {
        lines,
        ...(receive === null
          ? {}
          : { receive: { kind: "now", lamports: receive } as const }),
        ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
        ...(feedValues ? { feedBackValues: feedValues } : {}),
      };
    } catch (error) {
      return {
        lines: [],
        gate: { open: false, reason: line(errorCopy(error)) },
      };
    }
  }

  async function execute(
    action: CardsAction,
    ids: string[],
    progress?: (state: Progress) => void,
  ) {
    if (active) throw { message: line("errors.generic") };
    active = true;
    try {
      const { owner, generation } = ownerState();
      const approved = prepared.get(requestKey(action, ids));
      if (!approved || approved.generation !== generation)
        throw new EngineError("errors.cardMoved");
      prepared.delete(requestKey(action, ids));
      let completed = 0;
      if (action === "sell_back" && approved.expiry !== null) {
        const machine = await readMachine(rpc);
        if (machine.nowTs > approved.expiry)
          throw new EngineError("feed.state.quoteExpired");
      }
      await runSettles({
        rpc,
        session,
        chain: options.chain,
        prepared: approved.settles,
      });
      const run = async (
        id: string,
        build: (
          blockhash: string,
        ) => Promise<BuiltTransaction> | BuiltTransaction,
        landed: () => Promise<boolean>,
      ) => {
        const result = await executeTransactions({
          rpc,
          session,
          chain: options.chain,
          onProgress: (state) =>
            progress?.({
              ...state,
              confirmed: completed + state.confirmed,
              total: approved.transactionCount,
            }),
          items: [
            {
              id,
              phase: 0,
              build: ({ blockhash }) => build(blockhash),
              landed,
            },
          ],
        });
        if (result.phase !== "done")
          throw new EngineError(result.copyKey ?? "errors.generic");
        completed++;
        return result;
      };
      let receivedLamports = 0n;
      if (
        action === "redeem" ||
        action === "feed_back" ||
        action === "sell_back"
      ) {
        const remaining = resolveCards(await readBinder(rpc, owner), ids);
        const sellBatches = [...approved.sellBatches];
        while (remaining.length) {
          if (session.snapshot().generation !== generation)
            throw new EngineError("errors.cardMoved");
          const binder = await readBinder(rpc, owner);
          const rebound = rebindCards(
            identifyCards(binder?.cards ?? []),
            remaining,
          );
          const approvedSell =
            action === "sell_back" ? sellBatches.shift() : null;
          let selected = approvedSell
            ? rebindCards(
                identifyCards(binder?.cards ?? []),
                approvedSell.cards,
              )
            : cardBatches(rebound)[0]!;
          let q: CheckedSellQuote | undefined;
          if (action === "sell_back") {
            if (!approvedSell) throw new EngineError("errors.cardMoved");
            q = await quote(owner, selected);
            if (q.payoutLamports < approvedSell.payout)
              throw new EngineError("feed.state.quoteExpired");
          }
          const withTokens =
            action === "feed_back" ? null : await tokens(selected);
          if (action === "redeem") {
            const blockhash = (await rpc.getLatestBlockhash("confirmed"))
              .blockhash;
            while (
              buildCardRedeems({
                wallet: owner,
                blockhash,
                cards: withTokens!.slice(0, selected.length),
              }).length > 1
            )
              selected = selected.slice(0, -1);
          }
          const counts = new Map<string, number>();
          for (const card of identifyCards(binder!.cards))
            counts.set(
              cardIdentity(card),
              (counts.get(cardIdentity(card)) ?? 0) + 1,
            );
          const group = [...selected];
          const expected = new Map<string, number>();
          for (const card of group)
            expected.set(
              cardIdentity(card),
              (expected.get(cardIdentity(card)) ?? 0) + 1,
            );
          await run(
            `${action}:${group.map((card) => card.cardId).join(",")}`,
            async (blockhash) => {
              const fresh = await readBinder(rpc, owner);
              const cards = rebindCards(
                identifyCards(fresh?.cards ?? []),
                group,
              );
              if (action === "feed_back") {
                const machine = await readMachine(rpc);
                if (
                  !actionGates(0, { ...machine, ...options.flags() }).feedBack
                    .open
                )
                  throw new EngineError("errors.paused");
                return buildCardFeeds({ wallet: owner, blockhash, cards })[0]!;
              }
              const inputs = await tokens(cards);
              if (action === "redeem")
                return buildCardRedeems({
                  wallet: owner,
                  blockhash,
                  cards: inputs,
                })[0]!;
              if (
                cards.some(
                  (card, i) => card.cardIndex !== q!.cards[i]!.index,
                ) ||
                fresh!.sb_nonce !== q!.nonce
              )
                throw new EngineError("errors.cardMoved");
              if (!options.flags().sell)
                throw new EngineError("cards.sell.refusal.closed");
              return buildCardSell({
                wallet: owner,
                blockhash,
                cards: inputs,
                quote: q!,
              });
            },
            async () => {
              // A missing card alone cannot prove which action consumed it after an ambiguous send.
              // Known confirmed signatures settle in the engine; uncertain sends remain non-retryable.
              const after = identifyCards(
                (await readBinder(rpc, owner))?.cards ?? [],
              );
              const gone = [...expected].every(
                ([identity, n]) =>
                  after.filter((card) => cardIdentity(card) === identity)
                    .length <=
                  counts.get(identity)! - n,
              );
              if (gone)
                throw new Error(
                  "Card outcome requires signature reconciliation",
                );
              return false;
            },
          );
          if (q) receivedLamports += q.payoutLamports;
          for (const card of group) {
            const i = remaining.findIndex(
              (candidate) => cardIdentity(candidate) === cardIdentity(card),
            );
            remaining.splice(i, 1);
          }
          options.changed?.();
        }
      } else if (action === "withdraw_owed" || action === "close_my_cards") {
        const before = await readBinderAccount(rpc, owner);
        if (!before) throw new EngineError("errors.cardMoved");
        const result = await run(
          action,
          async (blockhash) => {
            const binder = await readBinder(rpc, owner);
            if (!binder) throw new EngineError("errors.cardMoved");
            return buildCardsExit({ wallet: owner, blockhash, binder, action });
          },
          async () => {
            const after = await readBinder(rpc, owner);
            return action === "close_my_cards"
              ? after === null
              : !!after && after.sol_owed < before.binder.sol_owed;
          },
        );
        // Concurrent royalty credits make a Binder delta ambiguous. Only this confirmed transaction's event names the payout.
        for (const signature of result.signatures) {
          const receipt = await rpc
            .getTransaction(signature, {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
            })
            .catch(() => null);
          if (!receipt?.meta || receipt.meta.err) continue;
          const parsed = parseOnepercentLogs({
            programId: webDeployment().programId.toBase58(),
            logs: receipt.meta.logMessages ?? [],
            err: receipt.meta.err,
          });
          if (parsed.malformed || parsed.truncated) continue;
          for (const event of parsed.events) {
            if (
              event.name === "OwedWithdrawn" &&
              action === "withdraw_owed" &&
              event.data.owner === owner.toBase58()
            )
              receivedLamports += event.data.amount;
            if (
              event.name === "BinderClosed" &&
              action === "close_my_cards" &&
              event.data.owner === owner.toBase58()
            )
              receivedLamports += event.data.lamports;
          }
        }
      } else {
        const ordered =
          action === "take_back"
            ? [...ids].sort(
                (a, b) =>
                  Number(b.split(":").at(-1)) - Number(a.split(":").at(-1)),
              )
            : ids;
        for (const id of ordered) {
          for (;;) {
            const plan = await rescue(
              action,
              [id],
              owner,
              (await rpc.getLatestBlockhash("confirmed")).blockhash,
            );
            if (plan.remaining.length)
              throw new EngineError("errors.cardMoved");
            if (!plan.transactions.length) break;
            await run(
              `${action}:${id}`,
              async (blockhash) => {
                const fresh = await rescue(action, [id], owner, blockhash);
                const built = fresh.transactions[0]?.transaction;
                if (!built) throw new EngineError("errors.cardMoved");
                return built;
              },
              async () => false,
            );
            if (action === "take_back" || action === "refund") break;
          }
        }
      }
      prepared.delete(requestKey(action, ids));
      options.changed?.();
      return receivedLamports > 0n ? { receivedLamports } : {};
    } catch (error) {
      options.changed?.();
      throw { message: line(errorCopy(error)) };
    } finally {
      active = false;
    }
  }
  return { preview, execute };
}
