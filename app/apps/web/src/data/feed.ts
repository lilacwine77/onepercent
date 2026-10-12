import { WEB } from "@onepercent/config/web";
import { XrayResultSchema } from "@onepercent/eligibility";
import { MachineResponse, MeResponse } from "@onepercent/sdk/api";
import { ValuesResponse, type ValuesOutput } from "@onepercent/web-api";
import type { Connection, PublicKey } from "@solana/web3.js";
import { api } from "./api";
import { readFeedCore, readFeedRent, readWalletInventory } from "./feed-chain";
import { readWalletDeck } from "./deck";

export async function readFeedWallet(rpc: Connection, wallet: PublicKey) {
  const core = await readFeedCore(rpc, wallet);
  const [inventory, rent] = await Promise.all([
    readWalletInventory(rpc, wallet, {
      minContextSlot: core?.slot,
      tokenMint: core?.config.token_mint,
    }),
    readFeedRent(rpc),
  ]);
  return { core, inventory, rent };
}
export type FeedWallet = Awaited<ReturnType<typeof readFeedWallet>>;
export async function readFeedDisplay(
  wallet: PublicKey,
  snapshot: FeedWallet,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const [xray, machine, me] = await Promise.allSettled([
    api(`/api/xray/${wallet.toBase58()}`, XrayResultSchema, { signal }),
    api("/api/machine", MachineResponse, { signal }),
    api(`/api/me/${wallet.toBase58()}`, MeResponse, { signal }),
  ]);
  signal?.throwIfAborted();
  const quotedAt = Date.now();
  const items: ValuesOutput["items"] = [];
  const bags = snapshot.inventory.bags.filter((bag) => bag.feedable);
  for (let start = 0; start < bags.length; start += WEB.valuesBatchMax) {
    signal?.throwIfAborted();
    const batch = bags.slice(start, start + WEB.valuesBatchMax);
    try {
      const response = await api("/api/values", ValuesResponse, {
        signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "now",
          items: batch.map((bag) => ({
            mint: bag.mint.toBase58(),
            amount: bag.amount.toString(),
          })),
        }),
      });
      for (const item of response.items) {
        if (
          batch.some(
            (bag) =>
              bag.mint.toBase58() === item.mint &&
              bag.amount === BigInt(item.amount),
          ) &&
          !items.some((existing) => existing.mint === item.mint)
        )
          items.push(item);
      }
    } catch {
      signal?.throwIfAborted();
      /* Missing quotes never become zero-valued quotes. */
    }
  }
  return {
    quotedAt,
    xray:
      xray.status === "fulfilled" && xray.value.address === wallet.toBase58()
        ? xray.value
        : null,
    machine: machine.status === "fulfilled" ? machine.value : null,
    me: me.status === "fulfilled" ? me.value : null,
    values: items,
  };
}
export type FeedDisplay = Awaited<ReturnType<typeof readFeedDisplay>>;
export const emptyFeedDisplay: FeedDisplay = {
  quotedAt: 0,
  xray: null,
  machine: null,
  me: null,
  values: [],
};
export { readWalletDeck };
