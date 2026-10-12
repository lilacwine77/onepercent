import { webDeployment } from "./deployment";
import { ACCOUNT_SIZES, COVERAGE, SERVICES } from "@onepercent/config";
import { MILLISECONDS_PER_MINUTE } from "@onepercent/config/web";
import {
  DECK_FLAGS,
  deckEntryLayout,
  deckHeaderLayout,
  deckPda,
  type DeckEntry,
} from "@onepercent/sdk/browser";
import type { DeckEntry as ApiDeckEntry } from "@onepercent/sdk/api";
import { PublicKey, type Connection } from "@solana/web3.js";
import { rpcLamports } from "./feed-chain";

export type DeckRpc = Pick<Connection, "getAccountInfoAndContext">;
export interface ChainDeckEntry extends DeckEntry {
  deckIndex: number;
  id: string;
}

export function deckEntryId(entry: DeckEntry, deckIndex: number) {
  return [
    entry.mint.toBase58(),
    entry.amount,
    entry.flags,
    entry.deposit,
    deckIndex,
  ].join(":");
}
export function sameDeckEntry(a: DeckEntry, b: DeckEntry) {
  return (
    a.depositor.equals(b.depositor) &&
    a.mint.equals(b.mint) &&
    a.amount === b.amount &&
    a.flags === b.flags &&
    a.deposit === b.deposit
  );
}

async function readHeader(rpc: DeckRpc, minContextSlot?: number) {
  const result = await rpc.getAccountInfoAndContext(
    deckPda(webDeployment().programId)[0],
    {
      commitment: "confirmed",
      minContextSlot,
      dataSlice: { offset: 0, length: ACCOUNT_SIZES.deckHeader },
    },
  );
  if (result.context.slot < (minContextSlot ?? 0))
    throw new Error("Stale Deck read");
  const account = result.value;
  if (!account) return null;
  if (
    !account.owner.equals(webDeployment().programId) ||
    account.executable ||
    account.data.length !== ACCOUNT_SIZES.deckHeader
  )
    throw new Error("Unexpected Deck account");
  const header = deckHeaderLayout.decode(account.data);
  if (
    header.version !== 1 ||
    header.bump !== deckPda(webDeployment().programId)[1] ||
    header.len > header.cap ||
    header.cap > COVERAGE.deckMax
  )
    throw new Error("Invalid Deck header");
  return {
    header,
    slot: result.context.slot,
    lamports: rpcLamports(account.lamports),
  };
}

export type DeckSnapshot = {
  entries: ChainDeckEntry[];
  slot: number;
  header: ReturnType<typeof deckHeaderLayout.decode> | null;
  lamports: bigint;
  /** Only true proves that an omitted entry was absent. Positive entries are
   * independently verified even when unrelated activity prevents a full view. */
  complete?: boolean;
};

function unchanged(
  a: ReturnType<typeof deckHeaderLayout.decode>,
  b: ReturnType<typeof deckHeaderLayout.decode>,
) {
  return (
    a.len === b.len &&
    a.cap === b.cap &&
    a.total_fed === b.total_fed &&
    a.total_pulled === b.total_pulled &&
    a.total_taken_back === b.total_taken_back
  );
}

// Share fallback discovery across polling, preparation and reconciliation.
const scans = new WeakMap<DeckRpc, Map<string, Promise<DeckSnapshot>>>();
const snapshots = new WeakMap<DeckRpc, Map<string, DeckSnapshot>>();
const nextRange = new WeakMap<DeckRpc, number>();
export type DeckHints = { deck: readonly ApiDeckEntry[]; asOfSlot: number };
export type LoadDeckHints = () => Promise<DeckHints>;

function cache(rpc: DeckRpc) {
  let values = snapshots.get(rpc);
  if (!values) snapshots.set(rpc, (values = new Map()));
  return values;
}
function hintsFor(
  entries: readonly ChainDeckEntry[],
  slot: number,
): ApiDeckEntry[] {
  return entries.map((entry) => ({
    asOfSlot: slot,
    deckIndex: entry.deckIndex,
    mint: entry.mint.toBase58(),
    amount: entry.amount.toString(),
    deposit: entry.deposit.toString(),
    fresh: Boolean(entry.flags & DECK_FLAGS.fresh),
    refed: Boolean(entry.flags & DECK_FLAGS.refed),
  }));
}
// Reserve at least half the RPC allowance for transaction and other app reads.
// Even a maximum-sized fallback is spread over time, including concurrent callers.
async function paceRange(rpc: DeckRpc) {
  const now = Date.now();
  const start = Math.max(now, nextRange.get(rpc) ?? now);
  nextRange.set(
    rpc,
    start +
      Math.ceil((2 * MILLISECONDS_PER_MINUTE) / SERVICES.api.rpcPerMinutePerIp),
  );
  if (start > now)
    await new Promise((resolve) => setTimeout(resolve, start - now));
}

async function hintedSnapshot(
  rpc: DeckRpc,
  wallet: PublicKey,
  hints: readonly ApiDeckEntry[],
  minimum?: number,
  listing = false,
): Promise<DeckSnapshot | null> {
  const before = await readHeader(rpc, minimum);
  if (!before)
    return hints.length
      ? null
      : {
          entries: [],
          slot: minimum ?? 0,
          header: null,
          lamports: 0n,
          complete: true,
        };
  // An empty mirror is not evidence that this owner has no exits.
  if (listing && !hints.length && before.header.len) return null;
  if (hints.some((hint) => hint.deckIndex >= before.header.len)) return null;
  const verified = await verifyDeckHints(rpc, wallet, hints, before.slot);
  if (!verified) return null;
  const after = await readHeader(rpc, verified.slot);
  if (
    !after ||
    (listing && !verified.entries.length && after.header.len > 0) ||
    verified.entries.some((entry) => entry.deckIndex >= after.header.len)
  )
    return null;
  return {
    entries: verified.entries,
    slot: after.slot,
    header: after.header,
    lamports: after.lamports,
    complete: after.header.len === 0,
  };
}

/** Mirror indices are hints only; every displayed entry is checked on chain. */
export async function readWalletDeck(
  rpc: DeckRpc,
  wallet: PublicKey,
  options: {
    minContextSlot?: number;
    loadHints?: LoadDeckHints;
    forceScan?: boolean;
  } = {},
): Promise<DeckSnapshot> {
  const key = wallet.toBase58();
  const running = scans.get(rpc)?.get(key);
  if (running) {
    const result = await running;
    if (result.slot >= (options.minContextSlot ?? 0)) return result;
  }
  if (!options.forceScan && options.loadHints) {
    try {
      const hints = await options.loadHints();
      const result = await hintedSnapshot(
        rpc,
        wallet,
        hints.deck,
        Math.max(options.minContextSlot ?? 0, hints.asOfSlot),
        true,
      );
      if (result) {
        cache(rpc).set(key, result);
        return result;
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      /* The API never gates the on-chain exit fallback. */
    }
  }
  const saved = cache(rpc).get(key);
  if (saved) {
    const header = await readHeader(
      rpc,
      Math.max(options.minContextSlot ?? 0, saved.slot),
    );
    if (
      header &&
      saved.header &&
      unchanged(saved.header, header.header) &&
      saved.complete === true
    ) {
      const result = { ...saved, ...header };
      scannedSnapshots.add(result);
      cache(rpc).set(key, result);
      return result;
    }
    if (!options.forceScan && header && scannedSnapshots.has(saved)) {
      const verified = await revalidateEntries(
        rpc,
        wallet,
        saved.entries,
        header,
      );
      if (verified.entries.length) {
        scannedSnapshots.add(verified);
        cache(rpc).set(key, verified);
        return verified;
      }
    }
  }
  // Explicit fallback for unavailable/stale hints, coalesced across all consumers.
  let active = scans.get(rpc);
  if (!active) scans.set(rpc, (active = new Map()));
  const existing = active.get(key);
  if (existing) {
    const result = await existing;
    if (result.slot >= (options.minContextSlot ?? 0)) return result;
    // The scan may have started while this request awaited the API or cache.
    // Retire only that completed promise before retrying at this caller's bound.
    if (active.get(key) === existing) active.delete(key);
    return readWalletDeck(rpc, wallet, { ...options, forceScan: true });
  }
  const scan = scanWalletDeck(rpc, wallet, options).then((result) => {
    scannedSnapshots.add(result);
    cache(rpc).set(key, result);
    return result;
  });
  active.set(key, scan);
  try {
    return await scan;
  } finally {
    if (active.get(key) === scan) active.delete(key);
  }
}
const scannedSnapshots = new WeakSet<DeckSnapshot>();

/** Preparation rereads only the selected indices. A moved entry triggers discovery once. */
export async function readDeckSelection(
  rpc: DeckRpc,
  wallet: PublicKey,
  wanted: readonly ChainDeckEntry[],
  loadHints?: LoadDeckHints,
): Promise<DeckSnapshot> {
  const direct = await hintedSnapshot(rpc, wallet, hintsFor(wanted, 0));
  if (direct) return direct;
  const discovered = await readWalletDeck(rpc, wallet, { loadHints });
  if (
    !resolveDeckEntries(wanted, discovered.entries).missing.length ||
    discovered.complete === true
  )
    return discovered;
  // Incomplete mirror hints can never prove an entry absent.
  const scanned = await readWalletDeck(rpc, wallet, {
    forceScan: true,
    minContextSlot: discovered.slot,
  });
  if (
    resolveDeckEntries(wanted, scanned.entries).missing.length &&
    scanned.complete !== true
  )
    throw new Error("Deck entry absence unavailable");
  return scanned;
}

/** A mixed discovery is useful for presence only. Never retain a stale index. */
async function revalidateEntries(
  rpc: DeckRpc,
  wallet: PublicKey,
  candidates: readonly ChainDeckEntry[],
  header: NonNullable<Awaited<ReturnType<typeof readHeader>>>,
): Promise<DeckSnapshot> {
  let slot = header.slot;
  const entries: ChainDeckEntry[] = [];
  const seen = new Set<number>();
  for (const candidate of candidates) {
    if (
      candidate.deckIndex >= header.header.len ||
      seen.has(candidate.deckIndex)
    )
      continue;
    seen.add(candidate.deckIndex);
    const verified = await verifyDeckHints(
      rpc,
      wallet,
      hintsFor([candidate], slot),
      slot,
    );
    if (!verified) continue;
    entries.push(...verified.entries);
    slot = verified.slot;
  }
  const after = await readHeader(rpc, slot);
  if (!after) throw new Error("Deck disappeared during read");
  return {
    entries: entries.filter((entry) => entry.deckIndex < after.header.len),
    slot: after.slot,
    header: after.header,
    lamports: after.lamports,
    complete: after.header.len === 0,
  };
}

/** Bounded fallback only, never called for every preparation. */
async function scanWalletDeck(
  rpc: DeckRpc,
  wallet: PublicKey,
  options: { minContextSlot?: number } = {},
): Promise<DeckSnapshot> {
  let minimum = options.minContextSlot;
  // One retry may discover an owner entry moved behind the scan cursor.
  // Unrelated activity never invalidates a positively rechecked owner entry.
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await readHeader(rpc, minimum);
    if (!before)
      return {
        entries: [],
        slot: minimum ?? 0,
        header: null,
        lamports: 0n,
        complete: true,
      };
    let slot = before.slot;
    let complete = true;
    const entries: ChainDeckEntry[] = [];
    const chunkCount = Math.floor(
      SERVICES.api.rpcMaxDataSliceBytes / ACCOUNT_SIZES.deckEntry,
    );
    for (let start = 0; start < before.header.len; start += chunkCount) {
      const count = Math.min(chunkCount, before.header.len - start);
      await paceRange(rpc);
      const result = await rpc.getAccountInfoAndContext(
        deckPda(webDeployment().programId)[0],
        {
          commitment: "confirmed",
          minContextSlot: slot,
          dataSlice: {
            offset: ACCOUNT_SIZES.deckHeader + start * ACCOUNT_SIZES.deckEntry,
            length: count * ACCOUNT_SIZES.deckEntry,
          },
        },
      );
      const info = result.value;
      if (
        result.context.slot < slot ||
        !info ||
        !info.owner.equals(webDeployment().programId) ||
        info.executable
      )
        throw new Error("Invalid Deck range");
      slot = result.context.slot;
      if (
        info.data.length > count * ACCOUNT_SIZES.deckEntry ||
        info.data.length % ACCOUNT_SIZES.deckEntry !== 0
      )
        throw new Error("Invalid Deck range length");
      const available = info.data.length / ACCOUNT_SIZES.deckEntry;
      if (available !== count) complete = false;
      for (let index = 0; index < available; index++) {
        const entry = deckEntryLayout.read(
          info.data,
          index * ACCOUNT_SIZES.deckEntry,
        );
        if (!entry.depositor.equals(wallet)) continue;
        const deckIndex = start + index;
        entries.push({
          ...entry,
          deckIndex,
          id: deckEntryId(entry, deckIndex),
        });
      }
      if (available !== count) break;
    }
    const after = await readHeader(rpc, slot);
    if (complete && after && unchanged(before.header, after.header))
      return {
        entries,
        slot: after.slot,
        header: after.header,
        lamports: after.lamports,
        complete: true,
      };
    if (after && entries.length) {
      const verified = await revalidateEntries(rpc, wallet, entries, after);
      if (verified.entries.length || verified.complete) return verified;
    }
    minimum = after?.slot ?? slot;
  }
  throw new Error("Deck changed during read");
}

/** Verify each mirror hint against its exact current index; false requests a full scan. */
export async function verifyDeckHints(
  rpc: DeckRpc,
  wallet: PublicKey,
  hints: readonly ApiDeckEntry[],
  minimum = 0,
): Promise<{ entries: ChainDeckEntry[]; slot: number } | null> {
  const entries: ChainDeckEntry[] = [];
  const seen = new Set<number>();
  for (const hint of hints) {
    if (seen.has(hint.deckIndex)) return null;
    seen.add(hint.deckIndex);
    await paceRange(rpc);
    const result = await rpc.getAccountInfoAndContext(
      deckPda(webDeployment().programId)[0],
      {
        commitment: "confirmed",
        minContextSlot: Math.max(minimum, hint.asOfSlot),
        dataSlice: {
          offset:
            ACCOUNT_SIZES.deckHeader + hint.deckIndex * ACCOUNT_SIZES.deckEntry,
          length: ACCOUNT_SIZES.deckEntry,
        },
      },
    );
    const info = result.value;
    if (
      result.context.slot < Math.max(minimum, hint.asOfSlot) ||
      !info ||
      info.executable ||
      !info.owner.equals(webDeployment().programId) ||
      info.data.length !== ACCOUNT_SIZES.deckEntry
    )
      return null;
    minimum = result.context.slot;
    const entry = deckEntryLayout.read(info.data, 0);
    if (
      !entry.depositor.equals(wallet) ||
      entry.mint.toBase58() !== hint.mint ||
      entry.amount !== BigInt(hint.amount) ||
      BigInt(entry.deposit) !== BigInt(hint.deposit) ||
      Boolean(entry.flags & DECK_FLAGS.fresh) !== hint.fresh ||
      Boolean(entry.flags & DECK_FLAGS.refed) !== hint.refed
    )
      return null;
    entries.push({
      ...entry,
      deckIndex: hint.deckIndex,
      id: deckEntryId(entry, hint.deckIndex),
    });
  }
  return { entries, slot: minimum };
}

/** Identical entries remain interchangeable, but an entry can be selected only once. */
export function resolveDeckEntries(
  wanted: readonly ChainDeckEntry[],
  current: readonly ChainDeckEntry[],
) {
  const used = new Set<number>();
  const entries: ChainDeckEntry[] = [];
  const missing: ChainDeckEntry[] = [];
  for (const entry of wanted) {
    const available = current.filter(
      (candidate) =>
        !used.has(candidate.deckIndex) && sameDeckEntry(entry, candidate),
    );
    const found =
      available.find((candidate) => candidate.deckIndex === entry.deckIndex) ??
      available[0];
    if (found) {
      entries.push(found);
      used.add(found.deckIndex);
    } else missing.push(entry);
  }
  return { entries, missing };
}
