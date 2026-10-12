import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { MarketError } from "../errors.js";
import { BPS_DENOMINATOR, CHAIN_LAYOUT, MARKET } from "../params.js";
import {
  createChainRpc,
  integerAmountSchema,
  rpcContextSchema,
  type ChainClientOptions,
} from "./exit-cap.js";
import { deriveBondingCurve, deriveCanonicalPool } from "./pump-layouts.js";

const largestSchema = z
  .object({
    context: rpcContextSchema,
    value: z.array(
      z
        .object({ address: z.string(), amount: integerAmountSchema })
        .passthrough(),
    ),
  })
  .passthrough();
const ownersSchema = z
  .object({
    context: rpcContextSchema,
    value: z.array(
      z
        .object({
          data: z
            .object({
              parsed: z
                .object({
                  type: z.literal("account"),
                  info: z
                    .object({ owner: z.string(), mint: z.string() })
                    .passthrough(),
                })
                .passthrough(),
            })
            .passthrough(),
        })
        .passthrough()
        .nullable(),
    ),
  })
  .passthrough();
const supplySchema = z
  .object({
    context: rpcContextSchema,
    value: z.object({ amount: integerAmountSchema }).passthrough(),
  })
  .passthrough();
export interface HolderEntry {
  address: string;
  owner: string;
  amount: bigint;
}
export interface ExcludedHolder extends HolderEntry {
  reason: "canonical_pool" | "bonding_curve" | "incinerator" | "off_curve";
}
export interface TopHolders {
  top10Bps: number;
  supply: bigint;
  holders: HolderEntry[];
  excluded: ExcludedHolder[];
  slot: number;
}
export interface HoldersClient {
  getTopHolders(mint: string): Promise<TopHolders>;
}
export function createHoldersClient(opts: ChainClientOptions): HoldersClient {
  const rpc = createChainRpc(opts);
  return {
    async getTopHolders(mint) {
      const pool = deriveCanonicalPool(mint);
      const curve = deriveBondingCurve(mint);
      const [largest, supplyResult] = await Promise.all([
        rpc.call(largestSchema, "getTokenLargestAccounts", [
          mint,
          { commitment: "confirmed" },
        ]),
        rpc.call(supplySchema, "getTokenSupply", [
          mint,
          { commitment: "confirmed" },
        ]),
      ]);
      const accounts = largest.value.slice(
        0,
        MARKET.listing.largestAccountsScanned,
      );
      if (
        new Set(accounts.map(({ address }) => address)).size !== accounts.length
      )
        throw new MarketError("PROVIDER_SCHEMA", { provider: "solana" });
      const owners =
        accounts.length === 0
          ? undefined
          : await rpc.call(ownersSchema, "getMultipleAccounts", [
              accounts.map(({ address }) => address),
              { encoding: "jsonParsed", commitment: "confirmed" },
            ]);
      if (owners && owners.value.length !== accounts.length)
        throw new MarketError("PROVIDER_SCHEMA", { provider: "solana" });
      const excluded: ExcludedHolder[] = [];
      const holders: HolderEntry[] = [];
      for (const [index, account] of accounts.entries()) {
        const info = owners?.value[index]?.data.parsed.info;
        if (!info || info.mint !== mint)
          throw new MarketError("PROVIDER_SCHEMA", { provider: "solana" });
        let key: PublicKey;
        try {
          key = new PublicKey(info.owner);
        } catch {
          throw new MarketError("PROVIDER_SCHEMA", { provider: "solana" });
        }
        const entry = {
          address: account.address,
          owner: info.owner,
          amount: BigInt(account.amount),
        };
        const reason =
          info.owner === pool
            ? "canonical_pool"
            : info.owner === curve
              ? "bonding_curve"
              : info.owner === CHAIN_LAYOUT.incinerator
                ? "incinerator"
                : !PublicKey.isOnCurve(key.toBytes())
                  ? "off_curve"
                  : undefined;
        if (reason) excluded.push({ ...entry, reason });
        else holders.push(entry);
      }
      holders.sort((a, b) =>
        a.amount > b.amount
          ? -1
          : a.amount < b.amount
            ? 1
            : a.address.localeCompare(b.address),
      );
      const supply = BigInt(supplyResult.value.amount);
      if (supply <= 0n)
        throw new MarketError("PROVIDER_SCHEMA", { provider: "solana" });
      const top = holders
        .slice(0, CHAIN_LAYOUT.topHolderCount)
        .reduce((sum, holder) => sum + holder.amount, 0n);
      if (top > supply)
        throw new MarketError("PROVIDER_SCHEMA", { provider: "solana" });
      const top10Bps = Number(
        (top * BigInt(BPS_DENOMINATOR) + supply - 1n) / supply,
      );
      return {
        top10Bps,
        supply,
        holders,
        excluded,
        slot: Math.min(
          largest.context.slot,
          supplyResult.context.slot,
          owners?.context.slot ?? largest.context.slot,
        ),
      };
    },
  };
}
