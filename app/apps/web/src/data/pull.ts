import { webDeployment } from "./deployment";
import { WEB } from "@onepercent/config/web";
import { PULL_STATUS, type Pull } from "@onepercent/sdk/browser";
import { VerifyResponse } from "@onepercent/sdk/api";
import {
  parseOnepercentLogs,
  type PackRevealed,
  type PullOpened,
} from "@onepercent/sdk/events";
import type { VerifyPullHeader } from "@onepercent/sdk/verify";
import {
  PublicKey,
  type Connection,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { api } from "./api";

export interface PullEvidence {
  header: VerifyPullHeader;
  opened: PullOpened | null;
  packs: PackRevealed[];
  refunded: boolean;
  requestSignature: string | null;
  callbackSignature: string | null;
  settleSignatures: string[];
  source: "rpc" | "indexer";
  transactions: Map<string, VersionedTransactionResponse>;
}

function headerFromAccount(pull: Pull): VerifyPullHeader {
  return {
    seq: pull.seq,
    buyer: pull.buyer.toBase58(),
    edition: pull.edition,
    qty: pull.qty,
    liveFlags: pull.live_flags,
    holder: pull.holder !== 0,
    randomness: pull.randomness,
  };
}

/** Events are accepted only from successful confirmed program invocation frames. */
export async function loadPullEvidence(
  rpc: Connection,
  address: PublicKey,
  seq?: bigint,
  observedPull?: Pull,
  programId = webDeployment().programId,
): Promise<PullEvidence | null> {
  const transactions = new Map<string, VersionedTransactionResponse>();
  const events: {
    signature: string;
    event: ReturnType<typeof parseOnepercentLogs>["events"][number];
  }[] = [];
  let before: string | undefined;
  // Pull history is finite; page size honors the public RPC limit. Pagination
  // also handles settle transactions arriving before the callback is inspected.
  for (;;) {
    const signatures = await rpc
      .getSignaturesForAddress(
        address,
        { limit: WEB.rpcSignaturePageSize, ...(before ? { before } : {}) },
        "confirmed",
      )
      .catch(() => []);
    if (!signatures.length) break;
    for (const entry of signatures) {
      if (entry.err !== null) continue;
      const tx = await rpc
        .getTransaction(entry.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        })
        .catch(() => null);
      if (!tx || tx.meta?.err !== null) continue;
      transactions.set(entry.signature, tx);
      const parsed = parseOnepercentLogs({
        logs: tx.meta.logMessages ?? null,
        err: tx.meta.err,
        programId: programId.toBase58(),
      });
      if (parsed.malformed || parsed.truncated) continue;
      events.push(
        ...parsed.events.map((event) => ({
          signature: entry.signature,
          event,
        })),
      );
    }
    const last = signatures.at(-1)!.signature;
    if (last === before || signatures.length < WEB.rpcSignaturePageSize) break;
    before = last;
  }
  const requestedSeq = observedPull?.seq ?? seq;
  const openedEntry = events.find(
    ({ event }) =>
      event.name === "PullOpened" &&
      event.data.pull === address.toBase58() &&
      (requestedSeq === undefined || event.data.seq === requestedSeq),
  );
  const opened =
    openedEntry?.event.name === "PullOpened" ? openedEntry.event.data : null;
  const anyReveal = events.find(
    ({ event }) =>
      event.name === "PullRevealed" && event.data.pull === address.toBase58(),
  );
  const expectedSeq =
    observedPull?.seq ??
    seq ??
    opened?.seq ??
    (anyReveal?.event.name === "PullRevealed"
      ? anyReveal.event.data.seq
      : undefined);
  const revealEntry = events.find(
    ({ event }) =>
      event.name === "PullRevealed" &&
      event.data.pull === address.toBase58() &&
      event.data.seq === expectedSeq,
  );
  const reveal =
    revealEntry?.event.name === "PullRevealed" ? revealEntry.event.data : null;
  if (
    observedPull &&
    opened &&
    (opened.seq !== observedPull.seq ||
      opened.buyer !== observedPull.buyer.toBase58() ||
      opened.edition !== observedPull.edition ||
      opened.qty !== observedPull.qty ||
      opened.holder !== (observedPull.holder !== 0))
  )
    throw new Error("Pull request disagrees with its account");
  if (
    reveal &&
    (observedPull || opened) &&
    (reveal.buyer !== (observedPull?.buyer.toBase58() ?? opened?.buyer) ||
      reveal.qty !== (observedPull?.qty ?? opened?.qty))
  )
    throw new Error("Pull callback disagrees with its request");
  const refunded = events.some(
    ({ event }) =>
      event.name === "PullRefunded" &&
      event.data.pull === address.toBase58() &&
      event.data.seq === expectedSeq &&
      event.data.buyer === (observedPull?.buyer.toBase58() ?? opened?.buyer),
  );
  if (
    expectedSeq !== undefined &&
    (reveal || refunded) &&
    (opened || observedPull || reveal)
  ) {
    const packs = events.flatMap(({ signature, event }) =>
      event.name === "PackRevealed" &&
      event.data.seq === expectedSeq &&
      signature === revealEntry?.signature
        ? [event.data]
        : [],
    );
    if (!observedPull && !opened && !packs[0]) return null;
    const header: VerifyPullHeader = observedPull
      ? {
          ...headerFromAccount(observedPull),
          liveFlags:
            observedPull.status === PULL_STATUS.revealed
              ? observedPull.live_flags
              : packs.reduce((flags, pack) => flags | pack.live_flags, 0),
        }
      : {
          seq: expectedSeq,
          buyer: opened?.buyer ?? reveal!.buyer,
          edition: opened?.edition ?? packs[0]!.edition,
          qty: opened?.qty ?? reveal!.qty,
          liveFlags: packs.reduce((flags, pack) => flags | pack.live_flags, 0),
          holder: opened?.holder ?? packs[0]!.holder,
          randomness: reveal
            ? Uint8Array.from(reveal.randomness)
            : new Uint8Array(PublicKey.default.toBytes().length),
        };
    if (reveal) header.randomness = Uint8Array.from(reveal.randomness);
    return {
      header,
      opened,
      packs,
      refunded,
      requestSignature: openedEntry?.signature ?? null,
      callbackSignature: revealEntry?.signature ?? null,
      settleSignatures: [
        ...new Set(
          events.flatMap(({ signature, event }) =>
            event.name === "PackSettled" &&
            event.data.pull === address.toBase58() &&
            event.data.seq === expectedSeq
              ? [signature]
              : [],
          ),
        ),
      ],
      source: "rpc",
      transactions,
    };
  }
  if (expectedSeq === undefined) return null;
  const response = await api(
    `/api/verify/${expectedSeq}`,
    VerifyResponse,
  ).catch(() => null);
  if (
    !response ||
    response.pull !== address.toBase58() ||
    BigInt(response.seq) !== expectedSeq ||
    (!response.randomness && response.status !== "refunded")
  )
    return null;
  const packs: PackRevealed[] = response.packs.map((pack) => ({
    seq: expectedSeq,
    pack: pack.pack,
    edition: response.edition,
    live_flags: pack.liveFlags ?? response.liveFlags,
    holder: response.holder,
    t: pack.t,
    widths: pack.widths,
    tier: pack.tier,
    hit_bucket: pack.hitBucket,
    house_mask: pack.houseMask,
    hit_mint: pack.hitMint,
    hit_amount: BigInt(pack.hitAmount),
    hit_value: BigInt(pack.hitValue),
    dust: pack.dust.map((pick) => ({
      deck_len_before: pick.deckLenBefore,
      index: pick.index,
      moved_from: pick.movedFrom,
      mint: pick.mint,
      amount: BigInt(pick.amount),
      depositor: pick.depositor,
      refund: BigInt(pick.refund),
    })) as unknown as PackRevealed["dust"],
  }));
  return {
    header: {
      seq: response.seq,
      buyer: response.buyer,
      edition: response.edition,
      qty: response.qty,
      liveFlags: response.liveFlags,
      holder: response.holder,
      randomness:
        response.randomness ??
        new Uint8Array(PublicKey.default.toBytes().length),
    },
    opened,
    packs,
    refunded: response.status === "refunded",
    requestSignature: response.openedSig,
    callbackSignature: response.revealedSig,
    settleSignatures: [],
    source: "indexer",
    transactions,
  };
}
