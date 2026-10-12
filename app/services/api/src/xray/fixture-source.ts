import { warnCause } from "@onepercent/service-kit";
import { readFile } from "node:fs/promises";
import {
  decodeMint,
  estimateValueLamports,
  type RawAccount,
} from "@onepercent/eligibility";
import { z } from "zod";
import type {
  ChainSource,
  NameResolver,
  PriceSource,
  ExitCapSource,
} from "./provider-types.js";
const rawSchema = z.object({
  address: z.string(),
  owner: z.string(),
  lamports: z.string(),
  dataBase64: z.string(),
});
const priceSchema = z.object({
  usdPrice: z.number(),
  blockId: z.number(),
  ageSlots: z.number(),
});
const metadataSchema = z.object({
  symbol: z.string().optional(),
  name: z.string().optional(),
  image: z.string().optional(),
});
const walletSchema = z.object({
  name: z.string(),
  owner: z.string(),
  slot: z.number(),
  slotS: z.number(),
  solUsd: z.number(),
  tokenAccounts: z.array(rawSchema),
  mints: z.record(z.string(), z.string()),
  curves: z.record(z.string(), z.string()),
  prices: z.record(z.string(), priceSchema),
  exitCaps: z.record(z.string(), z.string().regex(/^\d+$/).nullable()),
  snapshot: z.record(
    z.string(),
    z.object({
      balanceAtS: z.string().nullable(),
      mintFirstSeenSlot: z.number().optional(),
    }),
  ),
  metadata: z.record(z.string(), metadataSchema),
});
const root = new URL(
  "../fixtures/",
  import.meta.resolve("@onepercent/eligibility"),
);
async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(path, root), "utf8")) as unknown;
}
function raw(value: z.infer<typeof rawSchema>): RawAccount {
  return {
    address: value.address,
    owner: value.owner,
    lamports: BigInt(value.lamports),
    data: Buffer.from(value.dataBase64, "base64"),
  };
}
export async function createFixtureSources(): Promise<{
  chain: ChainSource;
  prices: PriceSource;
  exitCaps: ExitCapSource;
  names: NameResolver;
  owners: Record<string, string>;
  slotS: number;
}> {
  const wallets = await Promise.all(
    ["trencher", "clean", "mixed"].map(async (name) =>
      walletSchema.parse(await json(`wallets/${name}.json`)),
    ),
  );
  const owners = Object.fromEntries(
    wallets.map((wallet) => [wallet.name, wallet.owner]),
  );
  const byOwner = new Map(wallets.map((wallet) => [wallet.owner, wallet]));
  const accounts = new Map<string, RawAccount>();
  for (const wallet of wallets)
    for (const path of [
      ...Object.values(wallet.mints),
      ...Object.values(wallet.curves),
    ]) {
      const record = raw(rawSchema.parse(await json(path)));
      accounts.set(record.address, record);
    }
  const prices = Object.assign(
    {},
    ...wallets.map((wallet) => wallet.prices),
  ) as Record<string, z.infer<typeof priceSchema>>;
  const caps = Object.assign(
    {},
    ...wallets.map((wallet) => wallet.exitCaps),
  ) as Record<string, string | null>;
  const metadata = Object.assign(
    {},
    ...wallets.map((wallet) => wallet.metadata),
  ) as Record<string, z.infer<typeof metadataSchema>>;
  const slotS = wallets[0]?.slotS ?? 0;
  const chain: ChainSource = {
    async getTokenAccounts(owner) {
      return byOwner.get(owner)?.tokenAccounts.map(raw) ?? [];
    },
    async getAccounts(addresses) {
      return new Map(
        addresses.map((address) => [address, accounts.get(address) ?? null]),
      );
    },
    async getMetadata(owner) {
      return new Map(Object.entries(byOwner.get(owner)?.metadata ?? {}));
    },
    async getSlot() {
      return wallets[0]?.slot ?? 0;
    },
    async getBlockTime() {
      return 1791453600;
    },
    async getSnapshotEvidence(owner, mints) {
      const wallet = byOwner.get(owner);
      return new Map(
        mints.map((mint) => {
          const evidence = wallet?.snapshot[mint];
          return [
            mint,
            {
              balanceAtS:
                evidence?.balanceAtS == null
                  ? null
                  : BigInt(evidence.balanceAtS),
              ...(evidence?.mintFirstSeenSlot === undefined
                ? {}
                : { mintFirstSeenSlot: evidence.mintFirstSeenSlot }),
            },
          ];
        }),
      );
    },
  };
  return {
    chain,
    exitCaps: {
      async getSellValues(holdings) {
        // Preserve the recorded display examples; live scans use reserve mathematics.
        return {
          partial: false,
          values: new Map(
            holdings.map(({ mint, amount }) => {
              const record = accounts.get(mint);
              const price = prices[mint];
              let decimals = null;
              try {
                decimals = record ? decodeMint(record).mint.decimals : null;
              } catch (error) {
                warnCause("xray_fixture_mint_invalid", error);
                /* Unreadable fixture mint. */
              }
              const lamports = estimateValueLamports({
                amountRaw: amount,
                decimals,
                usdPrice: price?.usdPrice,
                ageSlots: price?.ageSlots,
                solUsd: wallets[0]?.solUsd ?? 0,
                exitCapLamports:
                  caps[mint] == null ? null : BigInt(caps[mint]!),
              });
              return [
                mint,
                {
                  ...(lamports === undefined ? {} : { lamports }),
                  slot: wallets[0]?.slot ?? 0,
                },
              ];
            }),
          ),
        };
      },

      async getExitCap(mint) {
        const cap = caps[mint];
        return cap == null
          ? { kind: "none" }
          : {
              kind: "pumpswap",
              realQuoteLamports: BigInt(cap),
              feeBps: 0,
              mayhem: false,
              solQuote: true,
              slot: wallets[0]?.slot ?? 0,
            };
      },
    },
    prices: {
      async getPrices(mints) {
        return Object.fromEntries(mints.map((mint) => [mint, prices[mint]]));
      },
      async getTokenInfo(mints) {
        return Object.fromEntries(
          mints.map((mint) => {
            const info = metadata[mint];
            return [
              mint,
              info
                ? {
                    symbol: info.symbol ?? mint.slice(0, 4),
                    name: info.name ?? "",
                    ...(info.image ? { logoURI: info.image } : {}),
                  }
                : undefined,
            ];
          }),
        );
      },
      async getSolUsd() {
        return wallets[0]?.solUsd ?? 0;
      },
    },
    names: {
      async resolve(input) {
        const match = /^(trencher|clean|mixed)\.sns$/.exec(input.toLowerCase());
        return match?.[1] ? (owners[match[1]] ?? null) : null;
      },
    },
    owners,
    slotS,
  };
}
