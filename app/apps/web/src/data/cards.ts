import { webDeployment } from "./deployment";
import { ACCOUNT_SIZES, COVERAGE, SERVICES } from "@onepercent/config";
import {
  deckPda,
  deckHeaderLayout,
  deckEntryLayout,
} from "@onepercent/sdk/browser";
import { MeResponse } from "@onepercent/sdk/api";
import {
  findOwnPulls,
  readPull,
  readVaultDeposit,
  type RescueDeckEntry,
} from "@onepercent/sdk/rescue";
import { PublicKey, type Connection } from "@solana/web3.js";
import { api } from "./api";

// Public RPC proxy byte limit. The service SDK's larger private-RPC slices do not fit it.
const PUBLIC_RPC_SLICE_BYTES = SERVICES.api.rpcMaxDataSliceBytes;

export const readMeHints = (owner: PublicKey) =>
  api(`/api/me/${owner.toBase58()}`, MeResponse);

/** Indexer addresses are hints only. Every pending/revealed Pull is read and decoded on chain. */
export async function readWalletPulls(
  rpc: Connection,
  owner: PublicKey,
  nonce: number,
) {
  const own = await findOwnPulls(rpc, webDeployment().programId, owner, nonce);
  const hints = await readMeHints(owner).catch(() => null);
  const others = hints
    ? await Promise.all(
        hints.pulls.settleable.map((hint) =>
          readPull(rpc, webDeployment().programId, new PublicKey(hint.pull)),
        ),
      )
    : [];
  const paying = others.filter(
    (pull) =>
      pull !== null &&
      (pull.buyer.equals(owner) ||
        pull.referrer.equals(owner) ||
        pull.packs.some((pack) =>
          pack.royalties.some(
            (royalty, index) =>
              !(pack.house_mask & (1 << index)) &&
              royalty.depositor.equals(owner),
          ),
        )),
  );
  return [
    ...new Map(
      [...own, ...paying.filter((pull) => pull !== null)].map((pull) => [
        pull.address.toBase58(),
        pull,
      ]),
    ).values(),
  ];
}

export async function readWalletVaults(rpc: Connection, owner: PublicKey) {
  const hints = await readMeHints(owner);
  const rows = await Promise.all(
    hints.vaultDeposits
      .filter((hint) => hint.payerIsWallet)
      .map((hint) =>
        readVaultDeposit(
          rpc,
          webDeployment().programId,
          new PublicKey(hint.mint),
        ),
      ),
  );
  return rows.filter(
    (row): row is NonNullable<typeof row> =>
      row !== null && row.payer.equals(owner),
  );
}

/** A complete direct scan remains usable when /api/me or the indexer is unavailable. */
export async function readWalletDeck(
  rpc: Connection,
  owner: PublicKey,
): Promise<RescueDeckEntry[]> {
  const [address, bump] = deckPda(webDeployment().programId);
  const headerRead = await rpc.getAccountInfoAndContext(address, {
    commitment: "confirmed",
    dataSlice: { offset: 0, length: ACCOUNT_SIZES.deckHeader },
  });
  const info = headerRead.value;
  if (!info || info.executable || !info.owner.equals(webDeployment().programId))
    throw new Error("Invalid Deck account");
  const header = deckHeaderLayout.decode(info.data);
  if (
    header.bump !== bump ||
    header.version !== 1 ||
    header.len > header.cap ||
    header.cap > COVERAGE.deckMax
  )
    throw new Error("Invalid Deck header");
  const perChunk = Math.floor(PUBLIC_RPC_SLICE_BYTES / ACCOUNT_SIZES.deckEntry);
  const rows: RescueDeckEntry[] = [];
  let slot = headerRead.context.slot;
  for (let start = 0; start < header.len; start += perChunk) {
    const count = Math.min(perChunk, header.len - start);
    const read = await rpc.getAccountInfoAndContext(address, {
      commitment: "confirmed",
      minContextSlot: slot,
      dataSlice: {
        offset: ACCOUNT_SIZES.deckHeader + start * ACCOUNT_SIZES.deckEntry,
        length: count * ACCOUNT_SIZES.deckEntry,
      },
    });
    const data = read.value;
    if (
      !data ||
      data.executable ||
      !data.owner.equals(webDeployment().programId) ||
      data.data.length !== count * ACCOUNT_SIZES.deckEntry
    )
      throw new Error("Invalid Deck slice");
    slot = read.context.slot;
    for (let index = 0; index < count; index++) {
      const entry = deckEntryLayout.read(
        data.data,
        index * ACCOUNT_SIZES.deckEntry,
      );
      if (entry.amount === 0n || (entry.flags & ~(1 | 2)) !== 0)
        throw new Error("Invalid Deck entry");
      if (entry.depositor.equals(owner))
        rows.push({ ...entry, deckIndex: start + index, slot });
    }
  }
  const final = await rpc.getAccountInfoAndContext(address, {
    commitment: "confirmed",
    minContextSlot: slot,
    dataSlice: { offset: 0, length: ACCOUNT_SIZES.deckHeader },
  });
  if (
    !final.value ||
    final.value.executable ||
    !final.value.owner.equals(webDeployment().programId) ||
    !final.value.data.equals(info.data)
  )
    throw new Error("Deck changed during discovery");
  return rows;
}
