import { TX_LIMITS } from "@onepercent/config";
import type { BuiltTransaction } from "@onepercent/sdk/browser";
import {
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type PublicKey,
} from "@solana/web3.js";
import type { WalletAccount } from "@wallet-standard/base";
import { capabilities, type SupportedWallet } from "../wallet/capabilities";
import {
  resolveDeckEntries,
  readDeckSelection,
  type LoadDeckHints,
  type ChainDeckEntry,
} from "../data/deck";
import { prepareTakeBack } from "./take-back";
import { executePlan } from "./engine/engine";
import { EngineError } from "./engine/errors";
import type { PendingItem, PlanItem, Progress } from "./engine/progress";
import { solanaPort } from "./engine/solana";
import { resolvePending } from "./engine/pending";
import {
  accountIdentity,
  cardIdentity,
  withAccountLock,
} from "./engine/account-lock";
import {
  clearSubmission,
  reconcileSubmission,
  rememberSubmission,
} from "./submission-guard";
import { takeBackConsent } from "./take-back-consent";

// Pending submissions survive a route change. Absence is never proof of receipt.
type PendingTakeBack = PendingItem<BuiltTransaction> & {
  cards: readonly string[];
};
const pending = new Map<string, PendingTakeBack[]>();
const overlaps = (entry: PendingTakeBack, scope: readonly string[]) =>
  entry.cards.some((card) => scope.includes(card));
function replacePending(
  key: string,
  scope: readonly string[],
  next: PendingTakeBack[],
) {
  const records = [
    ...(pending.get(key) ?? []).filter((entry) => !overlaps(entry, scope)),
    ...next,
  ];
  if (records.length) pending.set(key, records);
  else pending.delete(key);
}
type TakeBackRunInput = {
  rpc: Connection;
  owner: PublicKey;
  wallet: SupportedWallet;
  account: WalletAccount;
  chain: "solana:devnet" | "solana:mainnet";
  entries: readonly ChainDeckEntry[];
  price: bigint;
  current(): boolean;
  progress(state: Progress): void;
  maxAtaRentLamports?: bigint;
  maxTransactions?: number;
  loadDeckHints?: LoadDeckHints;
  approveRetry?(
    prepared: Awaited<ReturnType<typeof prepareTakeBack>>,
  ): Promise<boolean>;
};
export function runTakeBack(input: TakeBackRunInput) {
  return withAccountLock(
    input.chain,
    input.owner.toBase58(),
    () => runTakeBackLocked(input),
    () => input.rpc.getBlockHeight("finalized"),
    input.entries.map(cardIdentity),
  );
}
async function runTakeBackLocked(input: TakeBackRunInput) {
  const key = accountIdentity(input.chain, input.owner.toBase58());
  const scope = input.entries.map(cardIdentity);
  const records = (pending.get(key) ?? []).filter((entry) =>
    overlaps(entry, scope),
  );
  const recovery = await resolvePending(records, input.rpc);
  replacePending(
    key,
    scope,
    records.filter((entry) => recovery.pending.includes(entry)),
  );
  if (recovery.pending.length) {
    throw new EngineError("errors.generic");
  }
  const recovered = new Set(
    records
      .filter((entry) => recovery.landed.has(entry.item.id))
      .flatMap((entry) => entry.cards),
  );
  if (recovered.size) {
    const present = resolveDeckEntries(
      input.entries.filter((entry) => recovered.has(cardIdentity(entry))),
      (
        await readDeckSelection(
          input.rpc,
          input.owner,
          input.entries.filter((entry) => recovered.has(cardIdentity(entry))),
          input.loadDeckHints,
        )
      ).entries,
    ).entries;
    // A same-shaped entry can be fed again. A receipt for an older entry must
    // never turn a currently present card into an already-completed exit.
    if (present.length) throw new EngineError("errors.cardMoved");
  }
  let wanted = input.entries.filter(
    (entry) => !recovered.has(cardIdentity(entry)),
  );
  let landed = input.entries.length - wanted.length;
  const missing: ChainDeckEntry[] = [];
  // Compatibility count only; these are absent entries, not proven Pulls.
  let pulled = 0;
  let consent = takeBackConsent(input);
  const checkConsent = (
    prepared: Awaited<ReturnType<typeof prepareTakeBack>>,
  ) =>
    consent.check(
      prepared.batches.reduce((sum, batch) => sum + batch.ataRentLamports, 0n),
      prepared.batches.length,
    );
  for (let attempt = 0; attempt < 2; attempt++) {
    const prepared = await prepareTakeBack(input.rpc, {
      wallet: input.owner,
      loadDeckHints: input.loadDeckHints,
      entries: wanted,
      priorityFeeMicroLamports: input.price,
      blockhash: (await input.rpc.getLatestBlockhash("confirmed")).blockhash,
    });
    try {
      checkConsent(prepared);
    } catch (error) {
      if (
        attempt !== 1 ||
        !input.current() ||
        !(await input.approveRetry?.(prepared))
      )
        throw error;
      if (!input.current()) throw new EngineError("errors.cardMoved");
      // The new approval covers only the rebuilt remainder. Already prompted
      // costs belonged to the previous approval and are never silently reset.
      consent = takeBackConsent({
        maxTransactions: prepared.batches.length,
        maxAtaRentLamports: prepared.batches.reduce(
          (sum, batch) => sum + batch.ataRentLamports,
          0n,
        ),
      });
      checkConsent(prepared);
    }
    pulled += prepared.missing.length;
    missing.push(...prepared.missing);
    const items: PlanItem<BuiltTransaction>[] = prepared.batches.map(
      (batch) => ({
        id: batch.entries.map((entry) => entry.id).join("/"),
        phase: 0,
        build: (validity) => {
          const tx = batch.transaction;
          if (tx instanceof Transaction)
            return new Transaction({ feePayer: input.owner, ...validity }).add(
              ...tx.instructions,
            );
          const message = TransactionMessage.decompile(tx.message);
          message.recentBlockhash = validity.blockhash;
          return new VersionedTransaction(message.compileToV0Message());
        },
        // Only this submission's receipt proves its outcome. Another card of
        // the same mint can be withdrawn while this signature is unresolved.
        landed: async () => false,
      }),
    );
    let nextBatch = 0;
    const result = await executePlan(
      items,
      solanaPort({
        ...input,
        kind: "takeBack",
        submissionScope: scope,
        beforePrompt: async (transactions) => {
          const batches = prepared.batches.slice(
            nextBatch,
            nextBatch + transactions.length,
          );
          const live = await prepareTakeBack(input.rpc, {
            wallet: input.owner,
            loadDeckHints: input.loadDeckHints,
            entries: batches.flatMap((batch) => batch.entries),
            priorityFeeMicroLamports: input.price,
            blockhash: (await input.rpc.getLatestBlockhash("confirmed"))
              .blockhash,
          });
          if (!input.current()) throw new EngineError("errors.cardMoved");
          const ids = new Set(
            batches.flatMap((batch) => batch.entries.map((entry) => entry.id)),
          );
          if (
            live.missing.length ||
            live.batches.some((batch) =>
              batch.entries.some((entry) => !ids.has(entry.id)),
            )
          )
            throw new EngineError("errors.cardMoved");
          consent.reserve(
            live.batches.reduce(
              (sum, batch) => sum + batch.ataRentLamports,
              0n,
            ),
            transactions.length,
          );
          nextBatch += transactions.length;
        },
      }),
      {
        batchSize: capabilities(
          input.wallet,
          items.length,
          TX_LIMITS.txPerSignAll,
        ).batchSize,
        current: input.current,
        progress: input.progress,
      },
    );
    landed += prepared.batches
      .filter((_, index) => result.landed.has(items[index]!.id))
      .reduce((sum, batch) => sum + batch.entries.length, 0);
    const next = result.pending.map((entry) => ({
      ...entry,
      cards:
        prepared.batches[
          items.findIndex((item) => item.id === entry.item.id)
        ]!.entries.map(cardIdentity),
    }));
    replacePending(key, scope, next);
    clearSubmission(key, scope);
    for (const card of new Set(next.flatMap((entry) => entry.cards))) {
      const related = next.filter((entry) => entry.cards.includes(card));
      rememberSubmission(
        key,
        Math.max(
          ...related.map((entry) => entry.validity.lastValidBlockHeight),
        ),
        [card],
      );
      reconcileSubmission(
        key,
        async () => !(await resolvePending(related, input.rpc)).pending.length,
        [card],
      );
    }
    if (result.phase === "done") return { result, landed, pulled, missing };
    if (
      result.copyKey !== "errors.cardMoved" ||
      result.unknown.size ||
      attempt !== 0
    )
      return { result, landed, pulled, missing };
    // A swap-remove changes indices. Resolve identities once; never sign stale indices.
    wanted = prepared.batches
      .filter((_, index) => !result.landed.has(items[index]!.id))
      .flatMap((batch) => batch.entries);
    let snapshot;
    try {
      snapshot = await readDeckSelection(
        input.rpc,
        input.owner,
        wanted,
        input.loadDeckHints,
      );
    } catch {
      // The failed receipt is definitive even when a busy Deck cannot prove
      // whether the card still exists. Keep it failed, with no invented absence.
      return { result, landed, pulled, missing };
    }
    const fresh = resolveDeckEntries(wanted, snapshot.entries);
    pulled += fresh.missing.length;
    missing.push(...fresh.missing);
    wanted = fresh.entries;
    if (!wanted.length) return { result, landed, pulled, missing };
  }
  throw new EngineError("errors.cardMoved");
}
