import { warnCause } from "@onepercent/service-kit";
import { PublicKey } from "@solana/web3.js";
import { decodeConfig, decodeDbcLaunchPool } from "@onepercent/sdk";
import { jsonValueSchema, u64StringSchema } from "@onepercent/db";
import { z } from "zod";
import { singletonAddress } from "../accounts.js";
import type { RpcReader } from "../source.js";
import type { IndexerStore } from "../store.js";

export const BLOCK0_READY_EVENT = "IndexerBlock0Ready";
// Reserved for the internal notification at the end of a completely scanned
// slot. Program transactions always retain their real block order.
export const BLOCK0_EVENT_INDEX = 0xffff_ffffn;
const integer = z.number().int().nonnegative().safe();
const publicKey = z.string().refine((value) => {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch (error) {
    warnCause("block0_address_invalid", error);
    return false;
  }
});
const sig = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
const tokenBalance = z.object({
  accountIndex: integer,
  mint: publicKey,
  owner: publicKey.optional(),
  uiTokenAmount: z.object({ amount: u64StringSchema }),
});
export const block0TransactionSchema = z.object({
  slot: integer,
  transaction: z.object({
    signatures: z.array(sig).min(1),
    message: z.object({ accountKeys: z.array(publicKey) }),
  }),
  meta: z
    .object({
      err: jsonValueSchema.nullable(),
      preBalances: z.array(integer),
      postBalances: z.array(integer),
      preTokenBalances: z.array(tokenBalance),
      postTokenBalances: z.array(tokenBalance),
      loadedAddresses: z
        .object({ writable: z.array(publicKey), readonly: z.array(publicKey) })
        .optional(),
    })
    .nullable(),
});
export type Block0Transaction = z.infer<typeof block0TransactionSchema>;
export interface Block0Launch {
  signature: string;
  slot: bigint;
  mint: string;
  launchPool: string;
  devBuyTokens: bigint;
}
export interface Block0Buy {
  signature: string;
  slot: bigint;
  owner: string;
  tokens: bigint;
  lamportsSpent: bigint | null;
  team: boolean;
  role: string | null;
}
export function block0Rows(input: {
  transaction: Block0Transaction;
  mint: string;
  poolBaseVault: string;
  teamRoles: ReadonlyMap<string, string>;
  vaultAuthority: string;
  launchSignature: string;
}): Block0Buy[] {
  const tx = input.transaction;
  if (!tx.meta) throw new Error("block0_transaction_metadata_missing");
  if (tx.meta.err !== null) return [];
  const keys = [
    ...tx.transaction.message.accountKeys,
    ...(tx.meta.loadedAddresses?.writable ?? []),
    ...(tx.meta.loadedAddresses?.readonly ?? []),
  ];
  const amounts = new Map<string, bigint>();
  const apply = (balances: typeof tx.meta.preTokenBalances, sign: bigint) => {
    for (const balance of balances) {
      if (balance.mint !== input.mint) continue;
      const account = keys[balance.accountIndex];
      if (!account) throw new Error("block0_token_account_missing");
      if (account === input.poolBaseVault) continue;
      if (!balance.owner) throw new Error("block0_token_owner_missing");
      amounts.set(
        balance.owner,
        (amounts.get(balance.owner) ?? 0n) +
          sign * BigInt(balance.uiTokenAmount.amount),
      );
    }
  };
  apply(tx.meta.preTokenBalances, -1n);
  apply(tx.meta.postTokenBalances, 1n);
  return [...amounts]
    .filter(([, amount]) => amount > 0n)
    .map(([owner, tokens]) => {
      let lamportsSpent: bigint | null = null;
      if (keys[0] === owner) {
        const pre = tx.meta!.preBalances[0];
        const post = tx.meta!.postBalances[0];
        if (pre === undefined || post === undefined)
          throw new Error("block0_payer_balance_missing");
        lamportsSpent = BigInt(Math.max(0, pre - post));
      }
      const role =
        owner === input.vaultAuthority &&
        tx.transaction.signatures[0] === input.launchSignature
          ? "disclosed_dev_buy"
          : (input.teamRoles.get(owner) ?? null);
      return {
        signature: tx.transaction.signatures[0]!,
        slot: BigInt(tx.slot),
        owner,
        tokens,
        lamportsSpent,
        team: role !== null,
        role,
      };
    })
    .sort((a, b) => a.owner.localeCompare(b.owner));
}

export function configTeamRoles(
  config: ReturnType<typeof decodeConfig>,
): Map<string, string> {
  const roles = new Map<string, string[]>();
  const add = (key: PublicKey, role: string) => {
    if (key.equals(PublicKey.default)) return;
    const value = key.toBase58();
    roles.set(value, [...(roles.get(value) ?? []), role]);
  };
  for (const role of [
    "launch_wallet",
    "keeper",
    "executor",
    "intake_signer",
    "quote_signer",
    "team_wallet",
    "admin",
  ] as const)
    add(config[role], role);
  config.team_wallets.forEach((key) => add(key, "team_wallets"));
  config.guardians.forEach((key) => add(key, "guardian"));
  return new Map(
    [...roles].map(([key, value]) => [key, [...new Set(value)].join(",")]),
  );
}

const signaturePage = z.array(
  z.object({ signature: sig, slot: integer, err: jsonValueSchema.nullable() }),
);
const accountSchema = z.object({
  context: z.object({ slot: integer }),
  value: z
    .object({
      owner: publicKey,
      data: z.tuple([z.string(), z.literal("base64")]),
    })
    .nullable(),
});

export class Block0Indexer {
  constructor(
    private readonly options: {
      store: IndexerStore;
      rpc: RpcReader;
      programId: string;
      dbcProgram: string;
      slots: number;
    },
  ) {
    z.number().int().positive().safe().parse(options.slots);
  }
  /** The caller has finished ingesting every Onepercent transaction through scanSlot. */
  async poll(
    confirmedSlot: bigint,
    scanSlot: bigint,
    signal?: AbortSignal,
    rebuild = false,
  ): Promise<boolean> {
    const raw = (
      await this.options.store.pool.query(
        "SELECT signature,slot,mint,launch_pool,dev_buy_tokens,status,as_of_slot FROM season_launches ORDER BY slot DESC LIMIT 1",
      )
    ).rows[0];
    if (!raw || (!rebuild && raw.status === "ready")) return false;
    const launch: Block0Launch = {
      signature: String(raw.signature),
      slot: BigInt(String(raw.slot)),
      mint: String(raw.mint),
      launchPool: String(raw.launch_pool),
      devBuyTokens: BigInt(String(raw.dev_buy_tokens)),
    };
    const end = launch.slot + BigInt(this.options.slots);
    if (confirmedSlot <= end + 32n || scanSlot < end + 32n) return false;
    const finalized = BigInt(
      await this.options.rpc.request(
        "getSlot",
        [{ commitment: "finalized" }],
        integer,
        signal,
      ),
    );
    // Waiting for finalized DBC history prevents a ready board from retaining
    // external trades that disappear after the Onepercent cursor has advanced.
    if (finalized < end) return false;
    const rows = await this.read(launch, end, signal);
    return this.options.store.transaction(async (sql) => {
      const canonical = (
        await sql.query(
          "SELECT status,as_of_slot FROM season_launches WHERE signature=$1 FOR UPDATE",
          [launch.signature],
        )
      ).rows[0];
      if (!canonical || (!rebuild && canonical.status === "ready"))
        return false;
      const latest = (
        await sql.query("SELECT COALESCE(MAX(slot),0) AS slot FROM chain_txs")
      ).rows[0];
      // Another indexer may have advanced while external history was fetched.
      // Retry at its fully scanned slot instead of inserting behind the outbox.
      if (BigInt(String(latest?.slot ?? 0)) > scanSlot) return false;
      await sql.query("DELETE FROM block0_buys WHERE launch_signature=$1", [
        launch.signature,
      ]);
      for (const row of rows)
        await sql.query(
          "INSERT INTO block0_buys(signature,owner,launch_signature,slot,tokens,lamports_spent,team,role) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(signature,owner) DO UPDATE SET launch_signature=EXCLUDED.launch_signature,slot=EXCLUDED.slot,tokens=EXCLUDED.tokens,lamports_spent=EXCLUDED.lamports_spent,team=EXCLUDED.team,role=EXCLUDED.role",
          [
            row.signature,
            row.owner,
            launch.signature,
            String(row.slot),
            String(row.tokens),
            row.lamportsSpent === null ? null : String(row.lamportsSpent),
            row.team,
            row.role,
          ],
        );
      const asOfSlot =
        canonical.status === "ready"
          ? String(canonical.as_of_slot)
          : String(scanSlot);
      await sql.query(
        "UPDATE season_launches SET status='ready',as_of_slot=$2 WHERE signature=$1",
        [launch.signature, asOfSlot],
      );
      await sql.query(
        "INSERT INTO chain_events(signature,slot,tx_index,ix_index,event_index,name,data) VALUES($1,$2,$3,-1,$3,$4,$5) ON CONFLICT(signature,ix_index,event_index) DO NOTHING",
        [
          launch.signature,
          asOfSlot,
          String(BLOCK0_EVENT_INDEX),
          BLOCK0_READY_EVENT,
          {},
        ],
      );
      return true;
    });
  }
  async read(
    launch: Block0Launch,
    end: bigint,
    signal?: AbortSignal,
  ): Promise<Block0Buy[]> {
    const { rpc, programId, dbcProgram } = this.options;
    const firstAvailable = BigInt(
      await rpc.request("getFirstAvailableBlock", [], integer, signal),
    );
    if (firstAvailable > launch.slot) throw new Error("block0_history_pruned");
    const readAccount = async (address: string, owner: string) => {
      const result = await rpc.request(
        "getAccountInfo",
        [
          address,
          {
            commitment: "finalized",
            encoding: "base64",
            minContextSlot: Number(end),
          },
        ],
        accountSchema,
        signal,
      );
      if (
        !result.value ||
        result.value.owner !== owner ||
        BigInt(result.context.slot) < end
      )
        throw new Error("block0_account_evidence_missing");
      return Buffer.from(result.value.data[0], "base64");
    };
    const config = decodeConfig(
      await readAccount(singletonAddress(programId, "config"), programId),
    );
    const pool = decodeDbcLaunchPool(
      await readAccount(launch.launchPool, dbcProgram),
    );
    if (
      config.token_mint.toBase58() !== launch.mint ||
      pool.baseMint.toBase58() !== launch.mint
    )
      throw new Error("block0_mint_mismatch");
    const signatures = new Map<string, { slot: bigint; err: unknown }>([
      [launch.signature, { slot: launch.slot, err: null }],
    ]);
    const seen = new Set<string>();
    let before: string | undefined;
    let previousSlot: bigint | undefined;
    for (;;) {
      signal?.throwIfAborted();
      const page = await rpc.request(
        "getSignaturesForAddress",
        [
          launch.launchPool,
          {
            commitment: "finalized",
            until: launch.signature,
            ...(before ? { before } : {}),
            limit: 1000,
          },
        ],
        signaturePage,
        signal,
      );
      for (const entry of page) {
        if (seen.has(entry.signature))
          throw new Error("block0_history_not_advancing");
        seen.add(entry.signature);
        const slot = BigInt(entry.slot);
        if (previousSlot !== undefined && slot > previousSlot)
          throw new Error("block0_history_unordered");
        previousSlot = slot;
        if (slot >= launch.slot && slot < end)
          signatures.set(entry.signature, { slot, err: entry.err });
      }
      if (page.length < 1000 || BigInt(page.at(-1)!.slot) < launch.slot) break;
      before = page.at(-1)!.signature;
    }
    const roles = configTeamRoles(config);
    const vaultAuthority = singletonAddress(programId, "vault_auth");
    const rows: Block0Buy[] = [];
    for (const [signature, entry] of signatures) {
      if (entry.err !== null) continue;
      const tx = await rpc.request(
        "getTransaction",
        [
          signature,
          {
            commitment: "finalized",
            encoding: "json",
            maxSupportedTransactionVersion: 0,
          },
        ],
        block0TransactionSchema.nullable(),
        signal,
      );
      if (
        !tx ||
        tx.transaction.signatures[0] !== signature ||
        BigInt(tx.slot) !== entry.slot ||
        !tx.meta ||
        tx.meta.err !== null
      )
        throw new Error("block0_transaction_evidence_missing");
      rows.push(
        ...block0Rows({
          transaction: tx,
          mint: launch.mint,
          poolBaseVault: pool.baseVault.toBase58(),
          teamRoles: roles,
          vaultAuthority,
          launchSignature: launch.signature,
        }),
      );
    }
    if (
      !rows.some(
        (row) =>
          row.signature === launch.signature &&
          row.owner === vaultAuthority &&
          row.tokens >= launch.devBuyTokens,
      )
    )
      throw new Error("block0_dev_buy_missing");
    return rows.sort((a, b) =>
      a.slot < b.slot
        ? -1
        : a.slot > b.slot
          ? 1
          : a.signature.localeCompare(b.signature) ||
            a.owner.localeCompare(b.owner),
    );
  }
}
