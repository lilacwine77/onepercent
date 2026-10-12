import {
  EvidenceUnavailableError,
  type ConsumptionEvidence,
  type FeedProvenance,
  type InflowEvidence,
  type IntakeTokenBalance,
  type IntakeTransaction,
  type WalletHistoryEvidence,
} from "./types.js";

const total = (
  rows: readonly IntakeTokenBalance[],
  wallet: string,
  mint: string,
) =>
  rows.reduce(
    (sum, row) =>
      sum + (row.owner === wallet && row.mint === mint ? row.amount : 0n),
    0n,
  );

function dateAt(blockTime: number | null): string | null {
  if (blockTime === null) return null;
  const date = new Date(blockTime * 1000);
  if (
    !Number.isSafeInteger(blockTime) ||
    blockTime < 0 ||
    Number.isNaN(date.getTime())
  )
    throw new EvidenceUnavailableError();
  return date.toISOString();
}

export function classifyInflow(
  transaction: IntakeTransaction,
  wallet: string,
  mint: string,
): InflowEvidence | null {
  const { preTokenBalances: pre, postTokenBalances: post } = transaction;
  if (total(post, wallet, mint) <= total(pre, wallet, mint)) return null;
  const evidence = {
    slot: transaction.slot,
    signature: transaction.signature,
    date: dateAt(transaction.blockTime),
  };
  if (transaction.signers.includes(wallet)) {
    const otherMints = new Set(
      pre
        .filter((row) => row.owner === wallet && row.mint !== mint)
        .map((row) => row.mint),
    );
    const tokenSpent = [...otherMints].some(
      (other) => total(post, wallet, other) < total(pre, wallet, other),
    );
    if (tokenSpent) return { ...evidence, kind: "swap", sender: null };
    const native = transaction.lamports.get(wallet);
    if (!native) throw new EvidenceUnavailableError();
    const fee = transaction.feePayer === wallet ? transaction.fee : 0n;
    const creations = transaction.creationCosts.get(wallet) ?? {
      rent: 0n,
      unresolvedFunding: 0n,
    };
    const spent = native.pre - native.post;
    if (spent > fee + creations.rent + creations.unresolvedFunding)
      return { ...evidence, kind: "swap", sender: null };
    if (spent > fee + creations.rent) throw new EvidenceUnavailableError();
  }
  const falling = pre
    .filter((row) => row.mint === mint)
    .map((row) => ({
      row,
      decline:
        row.amount -
        (post.find(
          (item) =>
            item.accountIndex === row.accountIndex && item.mint === mint,
        )?.amount ?? 0n),
    }))
    .filter(({ decline }) => decline > 0n)
    .sort((a, b) =>
      a.decline === b.decline
        ? a.row.accountIndex - b.row.accountIndex
        : a.decline > b.decline
          ? -1
          : 1,
    );
  const sender = falling[0]?.row.owner;
  return {
    ...evidence,
    kind: sender ? "transfer" : "airdrop",
    sender: sender ?? null,
  };
}

export interface WalletHistorySnapshot {
  evidence: WalletHistoryEvidence;
  balances: ReadonlyMap<string, bigint>;
}
export interface AnalyzeWalletHistoryInput {
  wallet: string;
  mint: string;
  snapshotSlot: number;
  transactions: readonly IntakeTransaction[];
  complete: boolean;
  snapshot?: WalletHistorySnapshot;
}

function reconstruct(input: AnalyzeWalletHistoryInput): WalletHistorySnapshot {
  if (
    !input.complete ||
    !Number.isSafeInteger(input.snapshotSlot) ||
    input.snapshotSlot < 0
  )
    throw new EvidenceUnavailableError();
  const signatures = new Set<string>();
  const ordered = [...input.transactions].sort(
    (a, b) =>
      a.slot - b.slot || (a.transactionIndex ?? 0) - (b.transactionIndex ?? 0),
  );
  const saved = input.snapshot;
  if (
    saved &&
    (saved.evidence.balanceAtS < 0n ||
      [...saved.balances.values()].some((amount) => amount <= 0n) ||
      [...saved.balances.values()].reduce((sum, value) => sum + value, 0n) !==
        saved.evidence.balanceAtS ||
      (saved.evidence.first !== null &&
        saved.evidence.first.slot > input.snapshotSlot))
  )
    throw new EvidenceUnavailableError();
  if (
    saved &&
    (saved.evidence.wallet !== input.wallet ||
      saved.evidence.mint !== input.mint ||
      saved.evidence.snapshotSlot !== input.snapshotSlot ||
      input.transactions.some((tx) => tx.slot <= input.snapshotSlot))
  )
    throw new EvidenceUnavailableError();
  const accounts = new Map<string, bigint>(saved?.balances);
  let first: InflowEvidence | null = saved?.evidence.first ?? null;
  let balanceAtS = saved?.evidence.balanceAtS ?? 0n;
  let previous: IntakeTransaction | undefined;
  for (const tx of ordered) {
    if (
      signatures.has(tx.signature) ||
      (previous?.slot === tx.slot &&
        (previous.transactionIndex === null ||
          tx.transactionIndex === null ||
          previous.transactionIndex === tx.transactionIndex))
    )
      throw new EvidenceUnavailableError();
    signatures.add(tx.signature);
    previous = tx;
    const relevantPre = tx.preTokenBalances.filter(
      (row) => row.mint === input.mint && row.owner === input.wallet,
    );
    const relevantPost = tx.postTokenBalances.filter(
      (row) => row.mint === input.mint && row.owner === input.wallet,
    );
    const touched = new Set(
      [...relevantPre, ...relevantPost].map((row) => row.account),
    );
    for (const account of touched) {
      const pre =
        relevantPre.find((row) => row.account === account)?.amount ?? 0n;
      const post =
        relevantPost.find((row) => row.account === account)?.amount ?? 0n;
      if ((accounts.get(account) ?? 0n) !== pre)
        throw new EvidenceUnavailableError();
      if (post === 0n) accounts.delete(account);
      else accounts.set(account, post);
    }
    first ??= classifyInflow(tx, input.wallet, input.mint);
    if (tx.slot <= input.snapshotSlot)
      balanceAtS = [...accounts.values()].reduce(
        (sum, value) => sum + value,
        0n,
      );
  }
  return {
    balances: accounts,
    evidence: {
      wallet: input.wallet,
      mint: input.mint,
      snapshotSlot: input.snapshotSlot,
      balanceAtS,
      first,
    },
  };
}

/** Reconstruct every wallet-owned token account; untouched accounts retain their balance. */
export function analyzeWalletHistory(
  input: AnalyzeWalletHistoryInput,
): WalletHistoryEvidence {
  return reconstruct(input).evidence;
}

/** Only immutable, complete history at or before S may enter the evidence cache. */
export function createWalletHistorySnapshot(
  input: Omit<AnalyzeWalletHistoryInput, "snapshot">,
): WalletHistorySnapshot {
  if (input.transactions.some((tx) => tx.slot > input.snapshotSlot))
    throw new EvidenceUnavailableError();
  return reconstruct(input);
}

export interface FeedProvenanceInput {
  wallet: string;
  mint: string;
  snapshotSlot: number;
  snapshotDate: string | null;
  balanceNow: bigint;
  history: WalletHistoryEvidence;
  senderHistory?: WalletHistoryEvidence;
  teamWallets: readonly string[];
  consumption: readonly ConsumptionEvidence[];
  liveCard: { date: string | null } | null;
}

/** Pure S1-S5 verdict: it never consumes provenance or creates a live card. */
export function evaluateFeedProvenance(
  input: FeedProvenanceInput,
): FeedProvenance {
  const { wallet, mint, history, snapshotSlot } = input;
  const refusal = (
    reason: Extract<FeedProvenance, { eligible: false }>["reason"],
    date: string | null = null,
  ): FeedProvenance => ({ eligible: false, reason, date });
  if (
    history.wallet !== wallet ||
    history.mint !== mint ||
    history.snapshotSlot !== snapshotSlot ||
    input.balanceNow < 0n
  )
    throw new EvidenceUnavailableError();
  if (input.teamWallets.includes(wallet)) return refusal("team_wallet");
  if (input.balanceNow === 0n) return refusal("zero_balance");
  if (input.liveCard) return refusal("live_card", input.liveCard.date);
  const first = history.first;
  if (!first || first.kind === "airdrop")
    return refusal("not_bought", first?.date ?? null);
  const consumed = (holder: string) =>
    input.consumption.find(
      (row) =>
        row.holder === holder && row.mint === mint && row.usedBy !== wallet,
    );
  if (first.kind === "swap") {
    if (first.slot > snapshotSlot || history.balanceAtS <= 0n)
      return refusal("snapshot_not_held", input.snapshotDate);
    const prior = consumed(wallet);
    if (prior) return refusal("passed_on", prior.date);
    return { eligible: true, path: "self", via: null, holder: wallet };
  }
  const sender = first.sender;
  if (!sender || sender === wallet || input.teamWallets.includes(sender))
    return refusal("hop_sender_ineligible", first.date);
  const senderHistory = input.senderHistory;
  if (
    !senderHistory ||
    senderHistory.wallet !== sender ||
    senderHistory.mint !== mint ||
    senderHistory.snapshotSlot !== snapshotSlot
  )
    throw new EvidenceUnavailableError();
  if (
    senderHistory.balanceAtS <= 0n ||
    !senderHistory.first ||
    senderHistory.first.kind !== "swap" ||
    senderHistory.first.slot > snapshotSlot
  )
    return refusal(
      "hop_sender_ineligible",
      senderHistory.first?.kind === "transfer" ||
        senderHistory.first?.kind === "airdrop"
        ? senderHistory.first.date
        : input.snapshotDate,
    );
  const prior = consumed(sender);
  if (prior) return refusal("hop_used", prior.date);
  return { eligible: true, path: "hop", via: sender, holder: sender };
}
