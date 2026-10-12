import { TX_LIMITS } from "@onepercent/config";
import { count, sol, t } from "@onepercent/copy";
import { feedNonces, type BuiltTransaction } from "@onepercent/sdk/browser";
import {
  decodeCloseAccountInstruction,
  TokenInstruction,
  unpackAccount,
} from "@solana/spl-token";
import {
  Transaction,
  type AddressLookupTableAccount,
  type Connection,
  type PublicKey,
} from "@solana/web3.js";
import type { WalletAccount } from "@wallet-standard/base";
import type { FeedViewProps } from "../../experience/index";
import type { SupportedWallet } from "../../wallet/capabilities";
import { capabilities } from "../../wallet/capabilities";
import { readFeedWallet, type FeedWallet } from "../../data/feed";
import { readWalletDeck } from "../../data/deck";
import { feedIsOpen, freshFeedRoom } from "../../data/feed-chain";
import { refusalMessage, type FeedMessage } from "../../adapters/feed-panel";
import { EngineError, errorCopy } from "../engine/errors";
import { executePlan } from "../engine/engine";
import { accountIdentity, withAccountLock } from "../engine/account-lock";
import { clearSubmission, reconcileSubmission } from "../submission-guard";
import { resolvePending } from "../engine/pending";
import { measuredBudget, solanaPort } from "../engine/solana";
import type { PendingItem, PlanItem, Progress } from "../engine/progress";
import { requestAttest, validateAttest } from "./attest";
import {
  approvalCount,
  buildAttested,
  closePlan,
  feedChunks,
  mergePlan,
  plannedBags,
} from "./plan";

type Flow = FeedViewProps["panel"]["flow"];
export interface FeedRunInput {
  rpc: Connection;
  owner: PublicKey;
  wallet: SupportedWallet;
  account: WalletAccount;
  chain: "solana:devnet" | "solana:mainnet";
  selection: readonly string[];
  lut?: AddressLookupTableAccount;
  price: bigint;
  current(): boolean;
  enabled(): boolean;
  progress(flow: Flow): void;
  refused(mint: string, message: FeedMessage): void;
  beforeAttest?(mints: string[]): Promise<void>;
}
export async function previewFeed(input: {
  wallet: PublicKey;
  snapshot: FeedWallet;
  selection: readonly string[];
  batchSize: number;
  lut?: AddressLookupTableAccount;
  price: bigint;
  blockhash: string;
}) {
  const bags = input.snapshot.inventory.bags.filter((bag) =>
    input.selection.includes(bag.mint.toBase58()),
  );
  const selectedAccounts = new Set(
    bags.flatMap((bag) =>
      bag.accounts.map((account) => account.address.toBase58()),
    ),
  );
  const emptyAccounts = input.snapshot.inventory.emptyAccounts.filter(
    (account) => !selectedAccounts.has(account.address.toBase58()),
  );
  const merges = mergePlan(input.wallet, bags);
  const feeds = await feedChunks({
    wallet: input.wallet,
    bags: plannedBags(bags),
    signer: input.snapshot.core?.config.intake_signer ?? input.wallet,
    nonceBase: input.snapshot.core?.binder?.feed_nonce_base ?? 0,
    nonceBits: input.snapshot.core?.binder?.feed_nonce_bits ?? 0,
    lut: input.lut,
    price: input.price,
    blockhash: input.blockhash,
  });
  const closes = closePlan(input.wallet, emptyAccounts, input.blockhash);
  // Phase boundaries each need their own approval batch.
  return {
    bags,
    merges,
    feeds,
    closes,
    emptyAccounts,
    transactions: merges.length + feeds.length + closes.length,
    approvals:
      approvalCount(merges.length, input.batchSize) +
      approvalCount(feeds.length, input.batchSize) +
      approvalCount(closes.length, input.batchSize),
  };
}
export class FeedInterrupted extends EngineError {
  constructor(
    public readonly result: Awaited<
      ReturnType<typeof executePlan<BuiltTransaction>>
    >,
    public readonly flow?: Flow,
  ) {
    super(result.copyKey ?? "errors.generic");
  }
}
interface FeedRecovery {
  pending: PendingItem<BuiltTransaction>[];
  completed: Set<string>;
  mintsByItem: Map<string, string[]>;
  lastResult?: Awaited<ReturnType<typeof executePlan<BuiltTransaction>>>;
  lastFlow?: Flow;
}
// These records survive route changes and preserve the original wallet identity.
// A second tap resolves every ambiguous submission before requesting a new proof.
const recoveries = new Map<string, FeedRecovery>();
export async function reconcileFeedRetry(
  rpc: Connection,
  wallet: PublicKey,
  chain: FeedRunInput["chain"],
) {
  const key = accountIdentity(chain, wallet.toBase58());
  const recovery = recoveries.get(key) ?? {
    pending: [],
    completed: new Set<string>(),
    mintsByItem: new Map<string, string[]>(),
  };
  recoveries.set(key, recovery);
  const resolved = await resolvePending(recovery.pending, rpc);
  resolved.landed.forEach((id) =>
    recovery.mintsByItem
      .get(id)
      ?.forEach((mint) => recovery.completed.add(mint)),
  );
  recovery.pending = resolved.pending;
  if (resolved.pending.length) {
    if (recovery.lastResult)
      throw new FeedInterrupted(
        {
          ...recovery.lastResult,
          pending: resolved.pending,
          unknown: new Set(resolved.pending.map((record) => record.item.id)),
          retry: [],
        },
        recovery.lastFlow,
      );
    throw new EngineError("common.networkError");
  }
  return recovery;
}
const fragment = (
  kind: "bags" | "dustCards" | "transactions" | "approvals",
  n: number,
) =>
  (t as unknown as (key: string, vars: Record<string, string>) => string)(
    `count.${kind}`,
    { n: count(n) },
  );

export async function runFeed(input: FeedRunInput) {
  return withAccountLock(
    input.chain,
    input.owner.toBase58(),
    () => runFeedLocked(input),
    () => input.rpc.getBlockHeight("finalized"),
  );
}
async function runFeedLocked(input: FeedRunInput) {
  const recovery = await reconcileFeedRetry(
    input.rpc,
    input.owner,
    input.chain,
  );
  const batchSize = capabilities(
    input.wallet,
    0,
    TX_LIMITS.txPerSignAll,
  ).batchSize;
  const snapshot = await readFeedWallet(input.rpc, input.owner);
  // A returned or newly acquired whole bag is a new user selection. A previously
  // completed Feed with no wallet balance is omitted from this retry.
  const selection = input.selection.filter(
    (mint) =>
      !recovery.completed.has(mint) ||
      snapshot.inventory.bags.some((bag) => bag.mint.toBase58() === mint),
  );
  if (
    selection.length &&
    (!input.enabled() || !snapshot.core || !feedIsOpen(snapshot.core))
  )
    throw new EngineError("feed.refusal.feed_closed");
  if (
    new Set(input.selection).size !== input.selection.length ||
    selection.length > (snapshot.core ? freshFeedRoom(snapshot.core) : 0)
  )
    throw new EngineError("errors.freshCap");
  const plan = await previewFeed({
    wallet: input.owner,
    snapshot,
    selection,
    batchSize,
    lut: input.lut,
    price: input.price,
    blockhash: (await input.rpc.getLatestBlockhash("confirmed")).blockhash,
  });
  if (plan.bags.length !== selection.length)
    throw new EngineError("feed.refusal.not_whole_bag");
  let total = plan.transactions;
  let approvals = plan.approvals;
  let confirmed = 0;
  let rentBack = 0n;
  const fed = new Set<string>();
  const refusedMints = new Set<string>();
  const partialMessage = (): FeedMessage => ({
    key:
      selection.length - fed.size === 1
        ? "feed.state.partial.one"
        : "feed.state.partial.other",
    vars: {
      ok: count(fed.size),
      t: count(selection.length),
      n: count(selection.length - fed.size),
    },
  });
  const originalAccounts = new Map(
    plan.bags
      .flatMap((bag) => bag.accounts)
      .map((account) => [account.address.toBase58(), account]),
  );
  const returnedAccounts = new Set<string>();
  const rentByItem = new Map<string, readonly string[]>();
  const recordLanded = (ids: ReadonlySet<string>) => {
    for (const id of ids) {
      recovery.mintsByItem.get(id)?.forEach((mint) => {
        fed.add(mint);
        recovery.completed.add(mint);
      });
      for (const address of rentByItem.get(id) ?? []) {
        if (returnedAccounts.has(address)) continue;
        rentBack += originalAccounts.get(address)?.lamports ?? 0n;
        returnedAccounts.add(address);
      }
    }
  };
  const publish = (phase: Flow["phase"], message: FeedMessage | null) =>
    input.progress({ phase, total, confirmed, approvals, message });
  const execute = async (
    items: PlanItem<BuiltTransaction>[],
    kind: "merge" | "feed" | "close",
    beforePrompt?: () => Promise<void>,
  ) => {
    const result = await executePlan(
      items,
      solanaPort({ ...input, kind, beforePrompt }),
      {
        batchSize,
        current: input.current,
        progress: (state: Progress) => {
          const phase =
            state.phase === "building" || state.phase === "simulating"
              ? "planning"
              : ["done", "partial", "expired", "rejected", "failed"].includes(
                    state.phase,
                  )
                ? "sending"
                : state.phase;
          input.progress({
            phase,
            total,
            confirmed: confirmed + state.confirmed,
            approvals,
            message:
              state.phase === "signing"
                ? {
                    key: "feed.state.signing",
                    vars: {
                      transactions: fragment("transactions", items.length),
                      approvals: fragment(
                        "approvals",
                        approvalCount(items.length, batchSize),
                      ),
                    },
                  }
                : {
                    key:
                      kind === "merge"
                        ? "feed.state.merging"
                        : "feed.state.sending",
                    vars: {
                      c: count(confirmed + state.confirmed),
                      t: count(total),
                    },
                  },
          });
        },
      },
    );
    confirmed += result.landed.size;
    recordLanded(result.landed);
    recovery.pending = result.pending;
    if (result.pending.length)
      reconcileSubmission(
        accountIdentity(input.chain, input.owner.toBase58()),
        async () => {
          await reconcileFeedRetry(input.rpc, input.owner, input.chain);
          return true;
        },
      );
    else clearSubmission(accountIdentity(input.chain, input.owner.toBase58()));
    recovery.lastResult = result;
    if (result.phase !== "done") {
      const phase = confirmed ? "partial" : result.phase;
      const flow: Flow = {
        phase,
        total,
        confirmed,
        approvals,
        message:
          confirmed && fed.size < selection.length && !result.unknown.size
            ? partialMessage()
            : { key: result.copyKey ?? "errors.generic" },
      };
      recovery.lastFlow = flow;
      input.progress(flow);
      throw new FeedInterrupted({ ...result, phase }, flow);
    }
  };
  try {
    // Each merge chunk's transfers and closures are atomic; earlier chunks are confirmed first.
    const mergeItems: PlanItem<BuiltTransaction>[] = [];
    const mergedAmounts = new Map<string, bigint>();
    for (const merge of plan.merges) {
      merge.transaction.recentBlockhash = (
        await input.rpc.getLatestBlockhash("confirmed")
      ).blockhash;
      const budget = await measuredBudget(
        input.rpc,
        merge.transaction,
        input.price,
      );
      const instructions = [...budget, ...merge.transaction.instructions];
      const sources = merge.transaction.instructions
        .filter(
          (ix) =>
            ix.programId.equals(merge.bag.tokenProgram) &&
            ix.data[0] === TokenInstruction.CloseAccount,
        )
        .map(
          (ix) =>
            decodeCloseAccountInstruction(ix, merge.bag.tokenProgram).keys
              .account.pubkey,
        );
      const moved = merge.bag.accounts
        .filter((account) =>
          sources.some((source) => source.equals(account.address)),
        )
        .reduce((sum, account) => sum + account.amount, 0n);
      const mint = merge.bag.mint.toBase58();
      const baseline =
        (merge.bag.accounts.find((account) =>
          account.address.equals(merge.bag.source),
        )?.amount ?? 0n) + (mergedAmounts.get(mint) ?? 0n);
      mergedAmounts.set(mint, (mergedAmounts.get(mint) ?? 0n) + moved);
      rentByItem.set(
        merge.id,
        sources.map((source) => source.toBase58()),
      );
      mergeItems.push({
        id: merge.id,
        phase: 0,
        build: (validity) =>
          new Transaction({ feePayer: input.owner, ...validity }).add(
            ...instructions,
          ),
        landed: async () => {
          const infos = await input.rpc.getMultipleAccountsInfo(
            [...sources, merge.bag.source],
            "confirmed",
          );
          const primary = infos.at(-1);
          return (
            infos.slice(0, -1).every((info) => !info) &&
            Boolean(
              primary &&
              unpackAccount(merge.bag.source, primary, merge.bag.tokenProgram)
                .amount >=
                baseline + moved,
            )
          );
        },
      });
    }
    if (mergeItems.length) await execute(mergeItems, "merge");

    let pending = [...selection];
    while (pending.length) {
      if (!input.current()) throw new EngineError("errors.cardMoved");
      const live = await readFeedWallet(input.rpc, input.owner);
      if (!input.enabled() || !live.core || !feedIsOpen(live.core))
        throw new EngineError("feed.refusal.feed_closed");
      const bags = live.inventory.bags.filter((bag) =>
        pending.includes(bag.mint.toBase58()),
      );
      if (bags.length !== pending.length || mergePlan(input.owner, bags).length)
        throw new EngineError("feed.refusal.not_whole_bag");
      const available = await feedChunks({
        wallet: input.owner,
        bags: plannedBags(bags),
        signer: live.core.config.intake_signer,
        nonceBase: live.core.binder?.feed_nonce_base ?? 0,
        nonceBits: live.core.binder?.feed_nonce_bits ?? 0,
        price: input.price,
        lut: input.lut,
        blockhash: (await input.rpc.getLatestBlockhash("confirmed")).blockhash,
      });
      let count = Math.min(batchSize, available.length);
      while (count > 0) {
        try {
          feedNonces(
            live.core.binder?.feed_nonce_base ?? 0,
            live.core.binder?.feed_nonce_bits ?? 0,
            count,
          );
          break;
        } catch {
          count--;
        }
      }
      if (!count) throw new EngineError("errors.tooLong");
      const chunks = available.slice(0, count).map((chunk) => chunk.bags);
      await input.beforeAttest?.(
        chunks.flatMap((chunk) => chunk.map((bag) => bag.mint.toBase58())),
      );
      if (!input.current()) throw new EngineError("errors.cardMoved");
      publish("quoting", { key: "feed.state.attesting" });
      const response = await requestAttest(input.owner, chunks);
      const checkedCore = await readFeedWallet(input.rpc, input.owner);
      if (!checkedCore.core) throw new EngineError("feed.refusal.feed_closed");
      const attestations = validateAttest({
        response,
        wallet: input.owner,
        signer: checkedCore.core.config.intake_signer,
        snapshotSlot: checkedCore.core.config.snapshot_slot,
        minSlot: live.inventory.slot,
        now: BigInt(checkedCore.core.blockTime),
        nonceBase: checkedCore.core.binder?.feed_nonce_base ?? 0,
        nonceBits: checkedCore.core.binder?.feed_nonce_bits ?? 0,
        chunks,
      });
      response.refused.forEach((bag) => {
        refusedMints.add(bag.mint);
        input.refused(bag.mint, refusalMessage(bag.reason, bag.date));
      });
      total -= chunks.length - attestations.length;
      if (!attestations.length)
        approvals -= approvalCount(chunks.length, batchSize);
      const accepted = attestations.flatMap((att) => att.bags);
      for (const attestation of attestations) {
        const id = `feed:${attestation.nonce}`;
        recovery.mintsByItem.set(
          id,
          attestation.bags.map((bag) => bag.mint.toBase58()),
        );
        rentByItem.set(
          id,
          attestation.bags.map((bag) => bag.source.toBase58()),
        );
      }
      const items: PlanItem<BuiltTransaction>[] = attestations.map(
        (attestation) => ({
          id: `feed:${attestation.nonce}`,
          phase: 0,
          build: (validity) =>
            buildAttested({
              wallet: input.owner,
              signer: checkedCore.core!.config.intake_signer,
              attestation,
              lut: input.lut,
              price: input.price,
              blockhash: validity.blockhash,
            }),
          landed: async () => {
            const deck = await readWalletDeck(input.rpc, input.owner);
            const infos = await input.rpc.getMultipleAccountsInfo(
              attestation.bags.map((bag) => bag.source),
              "confirmed",
            );
            return attestation.bags.every(
              (bag, index) =>
                (!infos[index] ||
                  unpackAccount(bag.source, infos[index]!, bag.tokenProgram)
                    .amount === 0n) &&
                deck.entries.some(
                  (entry) =>
                    entry.mint.equals(bag.mint) && entry.amount === bag.amount,
                ),
            );
          },
        }),
      );
      if (items.length) {
        await execute(items, "feed", async () => {
          const last = await readFeedWallet(input.rpc, input.owner);
          if (
            !input.current() ||
            !input.enabled() ||
            !last.core ||
            !feedIsOpen(last.core)
          )
            throw new EngineError("feed.refusal.feed_closed");
          if (
            attestations.some(
              (att) => att.expiry <= BigInt(last.core!.blockTime),
            )
          )
            throw new EngineError("errors.tooLong");
          for (const bag of accepted) {
            const current = last.inventory.bags.find((item) =>
              item.mint.equals(bag.mint),
            );
            if (
              !current ||
              !current.feedable ||
              current.amount !== bag.amount ||
              mergePlan(input.owner, [current]).length ||
              !current.source.equals(bag.source)
            )
              throw new EngineError("feed.refusal.not_whole_bag");
          }
        });
      }
      const processed = new Set(
        chunks.flatMap((chunk) => chunk.map((bag) => bag.mint.toBase58())),
      );
      pending = pending.filter((mint) => !processed.has(mint));
    }
    // Empty accounts are re-read after merges/Feeds, and only the original empties are closed.
    const after = await readFeedWallet(input.rpc, input.owner);
    const empties = after.inventory.emptyAccounts.filter((account) =>
      plan.emptyAccounts.some((original) =>
        original.address.equals(account.address),
      ),
    );
    const closeTxs = closePlan(
      input.owner,
      empties,
      (await input.rpc.getLatestBlockhash("confirmed")).blockhash,
    );
    total += closeTxs.length - plan.closes.length;
    approvals +=
      approvalCount(closeTxs.length, batchSize) -
      approvalCount(plan.closes.length, batchSize);
    const closeItems: PlanItem<BuiltTransaction>[] = [];
    for (const [index, tx] of closeTxs.entries()) {
      const body = tx.instructions.slice(2);
      const probe = new Transaction({
        feePayer: input.owner,
        recentBlockhash: tx.recentBlockhash,
      }).add(...body);
      const budget = await measuredBudget(input.rpc, probe, input.price);
      const addresses = body.map((ix) => ix.keys[0]!.pubkey);
      const id = `close:${index}`;
      for (const account of empties)
        originalAccounts.set(account.address.toBase58(), account);
      rentByItem.set(
        id,
        addresses.map((address) => address.toBase58()),
      );
      closeItems.push({
        id,
        phase: 0,
        build: (validity) =>
          new Transaction({ feePayer: input.owner, ...validity }).add(
            ...budget,
            ...body,
          ),
        landed: async () =>
          (
            await input.rpc.getMultipleAccountsInfo(addresses, "confirmed")
          ).every((info) => info === null),
      });
    }
    if (closeItems.length) await execute(closeItems, "close");
    const message: FeedMessage = fed.size
      ? {
          key: "feed.state.done",
          vars: {
            cards: fragment("dustCards", fed.size),
            rent: sol(rentBack),
          },
        }
      : {
          key: confirmed ? "common.solGain" : "feed.state.nothing",
          vars: { sol: sol(rentBack) },
        };
    publish(
      refusedMints.size ? (fed.size ? "partial" : "idle") : "done",
      refusedMints.size && fed.size ? partialMessage() : message,
    );
    recoveries.delete(accountIdentity(input.chain, input.owner.toBase58()));
    return { fed, confirmed, total };
  } catch (error) {
    if (error instanceof FeedInterrupted || !confirmed || !recovery.lastResult)
      throw error;
    const flow: Flow = {
      phase: "partial",
      total,
      confirmed,
      approvals,
      message:
        fed.size < selection.length && !recovery.pending.length
          ? partialMessage()
          : { key: errorCopy(error) },
    };
    recovery.lastFlow = flow;
    input.progress(flow);
    throw new FeedInterrupted(
      { ...recovery.lastResult, phase: "partial", copyKey: errorCopy(error) },
      flow,
    );
  }
}
