import { warnCause } from "@onepercent/service-kit";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { JsonRpcClient, ServiceMetrics } from "@onepercent/service-kit";
import type { IndexedTransaction, SqlClient, SqlPool } from "./store.js";
import { decodeInstructionData } from "./consumption.js";
import {
  ACCOUNT_BYTES,
  TOKEN_PROGRAMS,
  ZERO_ADDRESS,
  accountDiscriminator,
  accountKind,
  decodeConfig,
  decodeDeckEntry,
  decodeDeckHeader,
  decodeLedger,
  decodeMachine,
  decodePull,
  jsonAccount,
  ledgerAddress,
  pullAddress,
  singletonAddress,
  vaultAddress,
  type DeckEntry,
} from "./accounts.js";

const base64 = z
  .string()
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const accountSchema = z.object({
  owner: z.string(),
  executable: z.boolean(),
  data: z.tuple([base64, z.literal("base64")]),
});
const contextSchema = z.object({ slot: z.number().int().nonnegative().safe() });
const responseSchema = z.object({
  context: contextSchema,
  value: accountSchema.nullable(),
});
const programAccountsSchema = z.object({
  context: contextSchema,
  value: z.array(z.object({ pubkey: z.string(), account: accountSchema })),
});
type RpcAccount = z.infer<typeof accountSchema>;
interface AccountRead {
  address: string;
  slot: bigint;
  value: RpcAccount | null;
}
interface ReconcileOptions {
  rpc: Pick<JsonRpcClient, "request">;
  pool: SqlPool;
  programId: string;
  deckChunkBytes: number;
  alert: (
    key: string,
    severity: "info" | "warning" | "critical",
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
  metrics: Pick<ServiceMetrics, "indexerDeckDrift">;
}
const U64_MAX = (1n << 64n) - 1n;
export const ACCOUNT_CURSOR_PREFIX = "indexer:account:";
export const DECK_SNAPSHOT_CURSOR = "indexer:deck-snapshot";
export const PROJECTION_LOCK = "SELECT pg_advisory_xact_lock(472001)";
/** A concurrent confirmed write invalidates a sliced snapshot; retry later. */
export function isDeckReadContention(error: unknown): boolean {
  return (
    error instanceof Error &&
    ["deck_changed_during_read", "deck_snapshot_behind_projection"].includes(
      error.message,
    )
  );
}
function rpcSlot(slot: bigint) {
  if (slot < 0n || slot > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("invalid_context_slot");
  return Number(slot);
}
function ownedData(value: RpcAccount, programId: string) {
  if (value.owner !== programId || value.executable)
    throw new Error("invalid_account_owner");
  return Buffer.from(value.data[0], "base64");
}
async function transaction(
  pool: SqlPool,
  action: (client: SqlClient) => Promise<void>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(PROJECTION_LOCK);
    await action(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function fence(client: SqlClient, name: string, slot: bigint) {
  await client.query(
    "INSERT INTO cursors(name,last_slot) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET last_slot=EXCLUDED.last_slot",
    [name, slot.toString()],
  );
}
async function newerThanFence(client: SqlClient, name: string, slot: bigint) {
  const current = await client.query(
    "SELECT last_slot FROM cursors WHERE name=$1",
    [name],
  );
  return !current.rows[0] || BigInt(String(current.rows[0].last_slot)) <= slot;
}
export class AccountReconciler {
  private driftRuns = 0;
  constructor(private readonly options: ReconcileOptions) {
    if (
      !Number.isSafeInteger(options.deckChunkBytes) ||
      options.deckChunkBytes < ACCOUNT_BYTES.deckEntry
    )
      throw new Error("invalid_deck_chunk_size");
  }
  /** A real confirmed opening signature, including when its logs were truncated. */
  async remember(tx: IndexedTransaction): Promise<boolean> {
    if (tx.err !== null) return true;
    const discriminator = createHash("sha256")
      .update("global:buy_packs")
      .digest()
      .subarray(0, 8);
    let complete = true;
    for (const instruction of tx.instructions) {
      if (instruction.programId !== this.options.programId) continue;
      let address: string;
      try {
        const data = decodeInstructionData(instruction.data);
        if (!data.subarray(0, 8).equals(discriminator)) continue;
        if (data.length < 17 || data.readUInt8(9) === 0)
          throw new Error("invalid_buy_packs_data");
        let offset = 15;
        const referrer = data.readUInt8(offset++);
        if (referrer > 1) throw new Error("invalid_buy_packs_data");
        offset += referrer * 32;
        if (offset >= data.length) throw new Error("invalid_buy_packs_data");
        const hold = data.readUInt8(offset++);
        // Anchor deserializes the arguments and ignores trailing instruction bytes.
        if (hold > 1 || offset + hold * 9 > data.length)
          throw new Error("invalid_buy_packs_data");
        const buyer = instruction.accounts[0];
        const candidate = instruction.accounts[5];
        if (
          !buyer ||
          !candidate ||
          pullAddress(this.options.programId, buyer, data.readUInt32LE(10)) !==
            candidate
        )
          throw new Error("invalid_pull_pda");
        address = candidate;
      } catch (error) {
        warnCause("indexer_tx_unprocessable", error);
        complete = false;
        await this.options.alert("indexer_tx_unprocessable", "warning", {
          signature: tx.signature,
          reason:
            error instanceof Error ? error.message : "invalid_buy_packs_data",
        });
        continue;
      }
      await this.options.pool.query(
        "INSERT INTO cursors(name,last_signature,last_slot) VALUES($1,$2,$3) ON CONFLICT(name) DO UPDATE SET last_signature=EXCLUDED.last_signature,last_slot=EXCLUDED.last_slot",
        ["indexer:pull-origin:" + address, tx.signature, tx.slot.toString()],
      );
    }
    for (const event of tx.events) {
      if (event.name !== "PullOpened") continue;
      const metadata = event.data._indexer;
      if (
        !metadata ||
        typeof metadata !== "object" ||
        Array.isArray(metadata) ||
        !Number.isSafeInteger(metadata.buyerNonce)
      )
        continue;
      await this.options.pool.query(
        "INSERT INTO cursors(name,last_signature,last_slot) VALUES($1,$2,$3) ON CONFLICT(name) DO UPDATE SET last_signature=EXCLUDED.last_signature,last_slot=EXCLUDED.last_slot",
        [
          "indexer:pull-origin:" + String(event.data.pull),
          tx.signature,
          tx.slot.toString(),
        ],
      );
    }
    return complete;
  }
  /** CPI openings carry their nonce in the exact Pull account named by the event. */
  async recoverPullNonces(tx: IndexedTransaction): Promise<void> {
    if (tx.err !== null) return;
    const discriminator = createHash("sha256")
      .update("global:buy_packs")
      .digest()
      .subarray(0, 8);
    const events = tx.events.filter((event) => {
      if (event.name !== "PullOpened" || typeof event.data.pull !== "string")
        return false;
      const instruction = tx.instructions[Number(event.ixIndex)];
      if (!instruction || instruction.programId !== this.options.programId)
        return true;
      try {
        return !decodeInstructionData(instruction.data)
          .subarray(0, 8)
          .equals(discriminator);
      } catch (error) {
        warnCause("indexer_instruction_decode_failed", error);
        return true;
      }
    });
    const addresses = [
      ...new Set(events.map((event) => String(event.data.pull))),
    ];
    const reads = new Map(
      (await this.readMany(addresses, tx.slot)).map((read) => [
        read.address,
        read,
      ]),
    );
    for (const event of events) {
      const address = String(event.data.pull);
      const read = reads.get(address);
      let nonce: number;
      try {
        if (!read?.value) throw new Error("pull_nonce_unavailable");
        const pull = decodePull(ownedData(read.value, this.options.programId));
        if (
          pull.buyer !== event.data.buyer ||
          pull.seq.toString() !== String(event.data.seq) ||
          pullAddress(this.options.programId, pull.buyer, pull.buyer_nonce) !==
            address
        )
          throw new Error("invalid_pull_pda");
        nonce = pull.buyer_nonce;
      } catch (error) {
        warnCause("pull_history_incomplete", error);
        await this.options.alert("pull_history_incomplete", "warning", {
          signature: tx.signature,
          address,
          reason:
            error instanceof Error ? error.message : "pull_nonce_unavailable",
        });
        continue;
      }
      const metadata = event.data._indexer;
      event.data._indexer = {
        ...(metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? metadata
          : {}),
        buyerNonce: nonce,
      };
    }
  }
  /** RPC batches are bounded to 100 accounts; pairs stay in the same bank. */
  private async readMany(
    addresses: readonly string[],
    minSlot: bigint,
  ): Promise<AccountRead[]> {
    const reads: AccountRead[] = [];
    for (let offset = 0; offset < addresses.length; offset += 100) {
      const batch = addresses.slice(offset, offset + 100);
      const result = await this.options.rpc.request(
        "getMultipleAccounts",
        [
          batch,
          {
            commitment: "confirmed",
            encoding: "base64",
            minContextSlot: rpcSlot(minSlot),
          },
        ],
        z.object({
          context: contextSchema,
          value: z.array(accountSchema.nullable()).length(batch.length),
        }),
      );
      const slot = BigInt(result.context.slot);
      if (slot < minSlot) throw new Error("stale_account_context");
      for (const [index, address] of batch.entries())
        reads.push({ address, slot, value: result.value[index]! });
    }
    return reads;
  }
  private async read(
    address: string,
    minSlot: bigint,
    slice?: { offset: number; length: number },
  ): Promise<AccountRead> {
    const result = await this.options.rpc.request(
      "getAccountInfo",
      [
        address,
        {
          commitment: "confirmed",
          encoding: "base64",
          minContextSlot: rpcSlot(minSlot),
          ...(slice ? { dataSlice: slice } : {}),
        },
      ],
      responseSchema,
    );
    const slot = BigInt(result.context.slot);
    if (slot < minSlot) throw new Error("stale_account_context");
    return { address, slot, value: result.value };
  }
  private async scan(
    kind: "MintLedger" | "Pull",
    minSlot: bigint,
  ): Promise<AccountRead[]> {
    const result = await this.options.rpc.request(
      "getProgramAccounts",
      [
        this.options.programId,
        {
          commitment: "confirmed",
          encoding: "base64",
          withContext: true,
          minContextSlot: rpcSlot(minSlot),
          filters: [
            {
              memcmp: {
                offset: 0,
                bytes: accountDiscriminator(kind).toString("base64"),
                encoding: "base64",
              },
            },
          ],
        },
      ],
      programAccountsSchema,
    );
    const slot = BigInt(result.context.slot);
    if (slot < minSlot) throw new Error("stale_account_context");
    return result.value.map(({ pubkey, account }) => ({
      address: pubkey,
      slot,
      value: account,
    }));
  }
  async reconcileDeck(minSlot = 0n): Promise<void> {
    const address = singletonAddress(this.options.programId, "deck");
    const slice = { offset: 0, length: ACCOUNT_BYTES.Deck };
    const before = await this.read(address, minSlot, slice);
    if (!before.value) return;
    const beforeData = ownedData(before.value, this.options.programId);
    const header = decodeDeckHeader(beforeData);
    // Counters cannot prove an unchanged Deck after saturation.
    if (
      [header.total_fed, header.total_pulled, header.total_taken_back].includes(
        U64_MAX,
      )
    )
      throw new Error("deck_counter_saturated");
    const entries: DeckEntry[] = [];
    const countPerChunk = Math.floor(
      this.options.deckChunkBytes / ACCOUNT_BYTES.deckEntry,
    );
    let lastSlot = before.slot;
    for (let start = 0; start < header.len; start += countPerChunk) {
      const count = Math.min(countPerChunk, header.len - start);
      const result = await this.read(address, lastSlot, {
        offset: ACCOUNT_BYTES.Deck + start * ACCOUNT_BYTES.deckEntry,
        length: count * ACCOUNT_BYTES.deckEntry,
      });
      if (!result.value) throw new Error("deck_changed_during_read");
      lastSlot = result.slot;
      const data = ownedData(result.value, this.options.programId);
      if (data.length !== count * ACCOUNT_BYTES.deckEntry)
        throw new Error("invalid_deck_chunk_length");
      for (let i = 0; i < count; i++)
        entries.push(
          decodeDeckEntry(
            data.subarray(
              i * ACCOUNT_BYTES.deckEntry,
              (i + 1) * ACCOUNT_BYTES.deckEntry,
            ),
          ),
        );
    }
    const after = await this.read(address, lastSlot, slice);
    if (
      !after.value ||
      !beforeData.equals(ownedData(after.value, this.options.programId))
    )
      throw new Error("deck_changed_during_read");
    let drift = 0;
    let applied = false;
    await transaction(this.options.pool, async (client) => {
      if (!(await newerThanFence(client, DECK_SNAPSHOT_CURSOR, after.slot)))
        return;
      const recent = await client.query(
        "SELECT max(slot) AS slot FROM deck_entries",
      );
      if (
        recent.rows[0]?.slot != null &&
        BigInt(String(recent.rows[0].slot)) > after.slot
      )
        throw new Error("deck_snapshot_behind_projection");
      const rows = await client.query(
        "SELECT deck_index,depositor,mint,amount,deposit,flags FROM deck_entries ORDER BY deck_index",
      );
      const previous = new Map(
        rows.rows.map((row) => [Number(row.deck_index), row]),
      );
      for (const [index, entry] of entries.entries()) {
        const row = previous.get(index);
        if (
          !row ||
          row.depositor !== entry.depositor ||
          row.mint !== entry.mint ||
          String(row.amount) !== entry.amount.toString() ||
          String(row.deposit) !== entry.deposit.toString() ||
          Number(row.flags) !== entry.flags
        ) {
          drift++;
          await client.query(
            "INSERT INTO deck_entries(deck_index,depositor,mint,amount,deposit,flags,slot,tx_index,ix_index,event_index) VALUES($1,$2,$3,$4,$5,$6,$7,-1,-1,-1) ON CONFLICT(deck_index) DO UPDATE SET depositor=EXCLUDED.depositor,mint=EXCLUDED.mint,amount=EXCLUDED.amount,deposit=EXCLUDED.deposit,flags=EXCLUDED.flags,slot=EXCLUDED.slot,tx_index=-1,ix_index=-1,event_index=-1",
            [
              index,
              entry.depositor,
              entry.mint,
              entry.amount.toString(),
              entry.deposit.toString(),
              entry.flags,
              after.slot.toString(),
            ],
          );
        }
        previous.delete(index);
      }
      drift += previous.size;
      await client.query("DELETE FROM deck_entries WHERE deck_index >= $1", [
        header.len,
      ]);
      await client.query("UPDATE machine_state SET deck_len=$1 WHERE id=1", [
        header.len,
      ]);
      await fence(client, DECK_SNAPSHOT_CURSOR, after.slot);
      applied = true;
    });
    if (!applied) return;
    this.options.metrics.indexerDeckDrift.set(drift);
    this.driftRuns = drift > 0 ? this.driftRuns + 1 : 0;
    if (this.driftRuns >= 2)
      await this.options.alert("deck_drift", "warning", {
        differingRows: drift,
        slot: after.slot.toString(),
      });
  }
  async reconcile(accounts?: readonly string[], minSlot = 0n): Promise<void> {
    const machineAddress = singletonAddress(this.options.programId, "machine");
    const configAddress = singletonAddress(this.options.programId, "config");
    const deckAddress = singletonAddress(this.options.programId, "deck");
    const [singletons, deckRead] = await Promise.all([
      this.readMany([machineAddress, configAddress], minSlot),
      this.read(deckAddress, minSlot, {
        offset: 0,
        length: ACCOUNT_BYTES.Deck,
      }),
    ]);
    const [machineRead, configRead] = singletons as [AccountRead, AccountRead];
    const reads = accounts
      ? await this.readMany(
          [...new Set(accounts)].filter(
            (address) =>
              ![machineAddress, configAddress, deckAddress].includes(address),
          ),
          minSlot,
        )
      : (
          await Promise.all([
            this.scan("MintLedger", minSlot),
            this.scan("Pull", minSlot),
          ])
        ).flat();
    const machine = machineRead.value
      ? decodeMachine(ownedData(machineRead.value, this.options.programId))
      : undefined;
    const config = configRead.value
      ? decodeConfig(ownedData(configRead.value, this.options.programId))
      : undefined;
    const deck = deckRead.value
      ? decodeDeckHeader(ownedData(deckRead.value, this.options.programId))
      : undefined;
    const ledgers: (ReturnType<typeof decodeLedger> & {
      address: string;
      slot: bigint;
      tokenProgram: string;
      vault: string;
      vaultExists: boolean;
    })[] = [];
    const pulls: (ReturnType<typeof decodePull> & {
      address: string;
      slot: bigint;
    })[] = [];
    const candidates: { address: string; mint: string; slot: bigint }[] = [];
    for (const read of reads) {
      if (!read.value || read.value.owner !== this.options.programId) continue;
      const data = ownedData(read.value, this.options.programId);
      const kind = accountKind(data);
      if (kind === "MintLedger") {
        const ledger = decodeLedger(data);
        if (ledgerAddress(this.options.programId, ledger.mint) !== read.address)
          throw new Error("invalid_ledger_pda");
        candidates.push({
          address: read.address,
          mint: ledger.mint,
          slot: read.slot,
        });
      } else if (kind === "Pull") {
        const pull = decodePull(data);
        if (
          pullAddress(this.options.programId, pull.buyer, pull.buyer_nonce) !==
          read.address
        )
          throw new Error("invalid_pull_pda");
        pulls.push({ ...pull, address: read.address, slot: read.slot });
      }
    }
    const maxSlot = (values: readonly { slot: bigint }[], initial: bigint) =>
      values.reduce(
        (highest, read) => (read.slot > highest ? read.slot : highest),
        initial,
      );
    const mintReads = await this.readMany(
      candidates.map(({ mint }) => mint),
      maxSlot(candidates, minSlot),
    );
    const pairs = candidates.map((candidate, index) => {
      const mint = mintReads[index]!;
      if (
        !mint.value ||
        mint.value.executable ||
        !TOKEN_PROGRAMS.some((id) => id === mint.value?.owner)
      )
        throw new Error("invalid_mint_owner");
      const tokenProgram = mint.value.owner;
      return {
        ...candidate,
        tokenProgram,
        vault: vaultAddress(
          this.options.programId,
          candidate.mint,
          tokenProgram,
        ),
      };
    });
    const pairedReads = await this.readMany(
      pairs.flatMap(({ address, vault }) => [address, vault]),
      maxSlot(mintReads, minSlot),
    );
    for (const [index, pair] of pairs.entries()) {
      // Each pair is consecutive and the batch size is even, so both accounts
      // were read at exactly the same confirmed context slot.
      const ledgerRead = pairedReads[index * 2]!;
      const vaultRead = pairedReads[index * 2 + 1]!;
      if (!ledgerRead.value) continue;
      const currentLedger = decodeLedger(
        ownedData(ledgerRead.value, this.options.programId),
      );
      if (currentLedger.mint !== pair.mint)
        throw new Error("invalid_ledger_pda");
      if (
        vaultRead.value &&
        (vaultRead.value.owner !== pair.tokenProgram ||
          vaultRead.value.executable)
      )
        throw new Error("invalid_vault_owner");
      ledgers.push({
        ...currentLedger,
        address: pair.address,
        slot: ledgerRead.slot,
        tokenProgram: pair.tokenProgram,
        vault: pair.vault,
        vaultExists: vaultRead.value !== null,
      });
    }
    const incompletePulls: { address: string; seq: string }[] = [];
    const incompleteBuckets: { mint: string; index: number }[] = [];
    await transaction(this.options.pool, async (client) => {
      if (
        machine &&
        config &&
        deck &&
        (await newerThanFence(
          client,
          ACCOUNT_CURSOR_PREFIX + machineAddress,
          machineRead.slot,
        )) &&
        (await newerThanFence(
          client,
          ACCOUNT_CURSOR_PREFIX + configAddress,
          configRead.slot,
        )) &&
        (await newerThanFence(client, DECK_SNAPSHOT_CURSOR, deckRead.slot))
      ) {
        const slot = [machineRead.slot, configRead.slot, deckRead.slot].reduce(
          (a, b) => (a < b ? a : b),
        );
        await client.query(
          "INSERT INTO machine_state(id,slot,machine,config,deck_len) VALUES(1,$1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET slot=EXCLUDED.slot,machine=EXCLUDED.machine,config=EXCLUDED.config,deck_len=EXCLUDED.deck_len WHERE machine_state.slot <= EXCLUDED.slot",
          [
            slot.toString(),
            jsonAccount(machine),
            jsonAccount(config),
            deck.len,
          ],
        );
        if (
          await newerThanFence(
            client,
            ACCOUNT_CURSOR_PREFIX + machineAddress,
            machineRead.slot,
          )
        ) {
          const occupied = machine.buckets
            .filter(
              (bucket) => bucket.mint !== ZERO_ADDRESS && bucket.class !== 0,
            )
            .map((bucket) => bucket.index);
          await client.query(
            'DELETE FROM buckets WHERE NOT ("index" = ANY($1::integer[]))',
            [occupied],
          );
          for (const bucket of machine.buckets) {
            if (bucket.mint === ZERO_ADDRESS || bucket.class === 0) continue;
            if (bucket.class !== 1 && bucket.class !== 2)
              throw new Error("invalid_bucket_class");
            // M1 admin_list_mint emits ConfigChanged action 13 with key=mint.
            const listing = await client.query(
              "SELECT slot FROM chain_events WHERE name='ConfigChanged' AND data->>'action'='13' AND data->>'key'=$1 AND slot<=$2 ORDER BY slot DESC,tx_index DESC,event_index DESC LIMIT 1",
              [bucket.mint, machineRead.slot.toString()],
            );
            const previous = listing.rows[0]
              ? undefined
              : (
                  await client.query(
                    'SELECT listed_slot FROM buckets WHERE "index"=$1 AND mint=$2',
                    [bucket.index, bucket.mint],
                  )
                ).rows[0];
            const listedSlot = listing.rows[0]?.slot ?? previous?.listed_slot;
            if (listedSlot === undefined) {
              incompleteBuckets.push({
                mint: bucket.mint,
                index: bucket.index,
              });
              continue;
            }
            await client.query(
              'INSERT INTO buckets("index",mint,class,enabled,amount,cost,reserved,cap,listed_slot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT("index") DO UPDATE SET mint=EXCLUDED.mint,class=EXCLUDED.class,enabled=EXCLUDED.enabled,amount=EXCLUDED.amount,cost=EXCLUDED.cost,reserved=EXCLUDED.reserved,cap=EXCLUDED.cap,listed_slot=EXCLUDED.listed_slot',
              [
                bucket.index,
                bucket.mint,
                bucket.class === 1 ? "major" : "trending",
                bucket.enabled !== 0,
                bucket.amount.toString(),
                bucket.cost.toString(),
                bucket.reserved.toString(),
                bucket.cap.toString(),
                String(listedSlot),
              ],
            );
          }
          await fence(
            client,
            ACCOUNT_CURSOR_PREFIX + machineAddress,
            machineRead.slot,
          );
          await fence(
            client,
            ACCOUNT_CURSOR_PREFIX + configAddress,
            configRead.slot,
          );
        }
      }
      for (const ledger of ledgers) {
        const cursor = ACCOUNT_CURSOR_PREFIX + ledger.address;
        if (!(await newerThanFence(client, cursor, ledger.slot))) continue;
        const closure = ledger.vaultExists
          ? undefined
          : (
              await client.query(
                "SELECT t.block_time FROM chain_events e JOIN chain_txs t USING(signature) WHERE e.name='VaultClosed' AND e.data->>'mint'=$1 AND e.slot<=$2 AND t.err IS NULL ORDER BY e.slot DESC,e.tx_index DESC,e.ix_index DESC,e.event_index DESC LIMIT 1",
                [ledger.mint, ledger.slot.toString()],
              )
            ).rows[0];
        await client.query(
          "INSERT INTO mint_ledgers(mint,ledger,payer,accounted,vault,token_program,vault_exists,closed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(mint) DO UPDATE SET ledger=EXCLUDED.ledger,payer=EXCLUDED.payer,accounted=EXCLUDED.accounted,vault=EXCLUDED.vault,token_program=EXCLUDED.token_program,vault_exists=EXCLUDED.vault_exists,closed_at=EXCLUDED.closed_at",
          [
            ledger.mint,
            ledger.address,
            ledger.payer,
            ledger.accounted.toString(),
            ledger.vault,
            ledger.tokenProgram,
            ledger.vaultExists,
            closure?.block_time ?? null,
          ],
        );
        await fence(client, cursor, ledger.slot);
      }
      for (const pull of pulls) {
        const cursor = ACCOUNT_CURSOR_PREFIX + pull.address;
        if (!(await newerThanFence(client, cursor, pull.slot))) continue;
        const existing = await client.query(
          "SELECT seq FROM pulls WHERE seq=$1",
          [pull.seq.toString()],
        );
        if (!existing.rows[0]) {
          const origin = await client.query(
            "SELECT c.last_signature FROM cursors c JOIN chain_txs t ON t.signature=c.last_signature WHERE c.name=$1 AND t.err IS NULL",
            ["indexer:pull-origin:" + pull.address],
          );
          if (!origin.rows[0]) {
            incompletePulls.push({
              address: pull.address,
              seq: pull.seq.toString(),
            });
            continue;
          }
          await client.query(
            "INSERT INTO pulls(seq,address,buyer,buyer_nonce,edition,qty,price,referrer,holder,status,created_ts,opened_sig,live_flags,randomness,settled_mask) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,to_timestamp($11),$12,$13,$14,$15) ON CONFLICT(seq) DO NOTHING",
            [
              pull.seq.toString(),
              pull.address,
              pull.buyer,
              pull.buyer_nonce,
              pull.edition,
              pull.qty,
              pull.price.toString(),
              pull.referrer === ZERO_ADDRESS ? null : pull.referrer,
              pull.holder,
              pull.status,
              pull.created_ts.toString(),
              String(origin.rows[0].last_signature),
              pull.live_flags,
              pull.status === "revealed" ? pull.randomness : null,
              pull.settled_mask,
            ],
          );
        }
        // Reveal signatures and draw widths come from confirmed events only.
        await client.query(
          "UPDATE pulls SET buyer_nonce=$2,edition=$3,qty=$4,price=$5,referrer=$6,holder=$7,status=$8,live_flags=(pulls.live_flags | $9),randomness=$10,settled_mask=$11 WHERE seq=$1",
          [
            pull.seq.toString(),
            pull.buyer_nonce,
            pull.edition,
            pull.qty,
            pull.price.toString(),
            pull.referrer === ZERO_ADDRESS ? null : pull.referrer,
            pull.holder,
            pull.status,
            pull.live_flags,
            pull.status === "revealed" ? pull.randomness : null,
            pull.settled_mask,
          ],
        );
        for (const [pack, record] of pull.packs.entries())
          await client.query(
            "UPDATE packs SET house_mask=$3,fresh_mask=$4 WHERE seq=$1 AND pack=$2",
            [pull.seq.toString(), pack, record.house_mask, record.fresh_mask],
          );
        await fence(client, cursor, pull.slot);
      }
    });
    for (const pull of incompletePulls)
      await this.options.alert("pull_history_incomplete", "warning", pull);
    for (const bucket of incompleteBuckets)
      await this.options.alert("bucket_history_incomplete", "warning", bucket);
  }
}
