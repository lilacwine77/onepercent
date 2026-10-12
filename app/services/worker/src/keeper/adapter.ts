import { warnCause } from "@onepercent/service-kit";
import { createHash } from "node:crypto";
import { JsonRpcClient } from "@onepercent/service-kit";
import {
  configLayout,
  machineLayout,
  mintLedgerLayout,
  packRecordLayout,
  pullHeaderLayout,
} from "@onepercent/sdk/layouts";
import { RESERVED_KEYS } from "@onepercent/sdk/constants";
import type { Payee, SettleInput } from "@onepercent/sdk";

import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import type { AccountMeta } from "@solana/web3.js";
import { z } from "zod";

export { RESERVED_KEYS };
export type { Payee, SettleInput };

// SWITCH to @onepercent/sdk when builders accept the runtime programId and limits.
// Keep the existing strict account checks and legacy-transaction return contract.
// Recorded Rust vectors continue to test this boundary against the shared layouts.
export const KEEPER_LAYOUT = {
  configSize: configLayout.size,
  machineSize: machineLayout.size,
  pullHeader: pullHeaderLayout.size,
  packSize: packRecordLayout.size,
  pullStatus: pullHeaderLayout.fields.status,
  ledgerSize: mintLedgerLayout.size,
  ledgerAccounted: mintLedgerLayout.fields.accounted,
} as const;
export function discriminator(
  namespace: "account" | "global" | "event",
  name: string,
): Buffer {
  return createHash("sha256")
    .update(`${namespace}:${name}`)
    .digest()
    .subarray(0, 8);
}
export interface KeeperPull {
  address: PublicKey;
  seq: bigint;
  buyer: PublicKey;
  referrer: PublicKey;
  createdTs: bigint;
  revealedTs: bigint;
  buyerNonce: number;
  settledMask: number;
  qty: number;
  status: 1 | 2;
  packs: {
    houseMask: number;
    freshMask: number;
    royalties: { depositor: PublicKey; lamports: bigint; refund: bigint }[];
  }[];
}
export interface KeeperLedger {
  address: PublicKey;
  mint: PublicKey;
  payer: PublicKey;
  accounted: bigint;
}
export interface KeeperSnapshot {
  asOfSlot: number;
  config: {
    seasonSet: boolean;
    stockUpTs: bigint;
    teamWallet: PublicKey;
    activeQueue: number;
    vrfQueues: PublicKey[];
    vrfProgram: PublicKey;
  };
  machine: {
    phase: number;
    nextSeq: bigint;
    onAirTs: bigint;
    endTs: bigint;
    teamSol: bigint;
    buckets: { mint: PublicKey; class: number }[];
  };
}
export type KeeperCommitment = "confirmed" | "finalized";
export interface KeeperLimits {
  settlePacksPerTx: number;
  maxTxBytes: number;
}
interface AdapterContext {
  programId: PublicKey;
  limits: KeeperLimits;
}
interface TransactionOptions {
  wallet: PublicKey;
  blockhash: string;
  computeBudget: false;
}

const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);
const ATA_PROGRAM = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
const MEMO_PROGRAM = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);
export function payeeWritable(payee: Payee): boolean {
  return !payee.executable && !RESERVED_KEYS.has(payee.address.toBase58());
}
export function keeperPda(
  programId: PublicKey,
  seed: string,
  ...parts: Buffer[]
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...parts],
    programId,
  )[0];
}
export function vaultAta(
  programId: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      keeperPda(programId, "vault_auth").toBuffer(),
      tokenProgram.toBuffer(),
      mint.toBuffer(),
    ],
    ATA_PROGRAM,
  )[0];
}
const keyAt = (data: Buffer, offset: number) =>
  new PublicKey(data.subarray(offset, offset + 32));
function checkData(
  data: Buffer,
  name: string,
  size: number,
  exact = true,
): void {
  if (
    (exact ? data.length !== size : data.length < size) ||
    !data.subarray(0, 8).equals(discriminator("account", name))
  ) {
    throw new Error("keeper_invalid_account");
  }
}
export function decodePull(
  data: Buffer,
  address: PublicKey,
  programId: PublicKey,
): KeeperPull {
  checkData(data, "Pull", KEEPER_LAYOUT.pullHeader, false);
  const qty = data.readUInt8(143);
  const status = data.readUInt8(KEEPER_LAYOUT.pullStatus);
  const buyer = keyAt(data, 16);
  const buyerNonce = data.readUInt32LE(136);
  const nonce = Buffer.alloc(4);
  nonce.writeUInt32LE(buyerNonce);
  if (
    !qty ||
    qty > 16 ||
    data.length !== KEEPER_LAYOUT.pullHeader + qty * KEEPER_LAYOUT.packSize ||
    (status !== 1 && status !== 2) ||
    data.readUInt8(147) !== 1 ||
    !keeperPda(programId, "pull", buyer.toBuffer(), nonce).equals(address) ||
    data.readUInt16LE(140) >= 2 ** qty
  )
    throw new Error("keeper_invalid_pull");
  return {
    address,
    seq: data.readBigUInt64LE(8),
    buyer,
    referrer: keyAt(data, 48),
    createdTs: data.readBigInt64LE(112),
    revealedTs: data.readBigInt64LE(120),
    buyerNonce,
    settledMask: data.readUInt16LE(140),
    qty,
    status,
    packs: Array.from({ length: qty }, (_, index) => {
      const start = KEEPER_LAYOUT.pullHeader + index * KEEPER_LAYOUT.packSize;
      return {
        houseMask: data.readUInt8(start + 195),
        freshMask: data.readUInt8(start + 196),
        royalties: Array.from({ length: 4 }, (_, k) => ({
          depositor: keyAt(data, start + k * 48),
          lamports: data.readBigUInt64LE(start + k * 48 + 32),
          refund: data.readBigUInt64LE(start + k * 48 + 40),
        })),
      };
    }),
  };
}
export function decodeLedger(
  data: Buffer,
  address: PublicKey,
  programId: PublicKey,
): KeeperLedger {
  checkData(data, "MintLedger", KEEPER_LAYOUT.ledgerSize);
  const mint = keyAt(data, 8);
  if (!keeperPda(programId, "ledger", mint.toBuffer()).equals(address))
    throw new Error("keeper_invalid_ledger");
  return {
    address,
    mint,
    payer: keyAt(data, 40),
    accounted: data.readBigUInt64LE(KEEPER_LAYOUT.ledgerAccounted),
  };
}
export function decodeSnapshot(
  config: Buffer,
  machine: Buffer,
  asOfSlot: number,
): KeeperSnapshot {
  checkData(config, "Config", KEEPER_LAYOUT.configSize);
  checkData(machine, "Machine", KEEPER_LAYOUT.machineSize);
  if (
    config.readUInt8(736) !== 1 ||
    machine.readUInt8(8) !== 1 ||
    config.readUInt8(738) >= 4 ||
    machine.readUInt8(10) > 6
  ) {
    throw new Error("keeper_invalid_snapshot");
  }
  return {
    asOfSlot,
    config: {
      seasonSet: config.readUInt8(739) === 1,
      stockUpTs: config.readBigInt64LE(728),
      teamWallet: keyAt(config, 264),
      activeQueue: config.readUInt8(738),
      vrfQueues: Array.from({ length: 4 }, (_, i) =>
        keyAt(config, 584 + i * 32),
      ),
      vrfProgram: keyAt(config, 744),
    },
    machine: {
      phase: machine.readUInt8(10),
      nextSeq: machine.readBigUInt64LE(16),
      onAirTs: machine.readBigInt64LE(48),
      endTs: machine.readBigInt64LE(56),
      teamSol: machine.readBigUInt64LE(96),
      buckets: Array.from({ length: 16 }, (_, i) => ({
        mint: keyAt(machine, 224 + i * 128),
        class: machine.readUInt8(224 + i * 128 + 109),
      })),
    },
  };
}
const meta = (pubkey: PublicKey, isWritable = false): AccountMeta => ({
  pubkey,
  isSigner: false,
  isWritable,
});
function instruction(
  programId: PublicKey,
  name: string,
  keys: AccountMeta[],
  args: Buffer = Buffer.alloc(0),
): TransactionInstruction {
  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.concat([discriminator("global", name), args]),
  });
}
function sequence(seq: bigint): Buffer {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(seq);
  return data;
}
export function settleInstruction(
  input: SettleInput,
  programId: PublicKey,
): TransactionInstruction {
  if (!Number.isInteger(input.pack) || input.pack < 0 || input.pack > 255)
    throw new Error("keeper_invalid_pack");
  const payees = [
    input.buyer,
    input.referrer ?? input.buyer,
    ...input.wallets.map((p) => p ?? input.buyer),
  ];
  const readonly = new Set(
    payees.filter((p) => !payeeWritable(p)).map((p) => p.address.toBase58()),
  );
  const payeeMeta = (address: PublicKey) =>
    meta(
      address,
      !readonly.has(address.toBase58()) &&
        !RESERVED_KEYS.has(address.toBase58()),
    );
  return instruction(
    programId,
    "settle",
    [
      meta(input.pull, true),
      meta(keeperPda(programId, "machine"), true),
      ...payees.map((p) => payeeMeta(p.address)),
      ...input.wallets.map((p) =>
        payeeMeta(
          p
            ? keeperPda(programId, "binder", p.address.toBuffer())
            : input.buyer.address,
        ),
      ),
    ],
    Buffer.concat([sequence(input.seq), Buffer.from([input.pack])]),
  );
}
export function refundPullInstruction(
  input: { pull: PublicKey; seq: bigint; buyer: Payee },
  programId: PublicKey,
): TransactionInstruction {
  return instruction(
    programId,
    "refund_pull",
    [
      meta(input.pull, true),
      meta(keeperPda(programId, "machine"), true),
      meta(
        keeperPda(programId, "binder", input.buyer.address.toBuffer()),
        true,
      ),
      meta(input.buyer.address, payeeWritable(input.buyer)),
    ],
    sequence(input.seq),
  );
}
function checkedTransaction(
  options: TransactionOptions,
  instructions: TransactionInstruction[],
  limits: KeeperLimits,
): Transaction {
  const transaction = new Transaction({
    feePayer: options.wallet,
    recentBlockhash: options.blockhash,
  }).add(...instructions);
  if (
    transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).length > limits.maxTxBytes
  )
    throw new Error("keeper_transaction_too_large");
  return transaction;
}
export function buildSettleTransaction(
  options: TransactionOptions & { packs: readonly SettleInput[] },
  context: AdapterContext,
): Transaction {
  if (
    !options.packs.length ||
    options.packs.length > context.limits.settlePacksPerTx
  )
    throw new Error("keeper_invalid_pack_count");
  const instructions = options.packs.map((pack) =>
    settleInstruction(pack, context.programId),
  );
  for (const seq of new Set(options.packs.map((pack) => pack.seq))) {
    instructions.push(
      new TransactionInstruction({
        programId: MEMO_PROGRAM,
        keys: [],
        data: Buffer.from(`1pct:roy:${seq}`),
      }),
    );
  }
  return checkedTransaction(options, instructions, context.limits);
}
export function buildRefundTransaction(
  options: TransactionOptions & { pull: PublicKey; seq: bigint; buyer: Payee },
  context: AdapterContext,
): Transaction {
  return checkedTransaction(
    options,
    [refundPullInstruction(options, context.programId)],
    context.limits,
  );
}

const pubkeySchema = z.string().refine((value) => {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch (error) {
    warnCause("keeper_address_invalid", error);
    return false;
  }
});
const rpcAccountSchema = z.object({
  owner: pubkeySchema,
  executable: z.boolean(),
  data: z.tuple([
    z
      .string()
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
    z.literal("base64"),
  ]),
});
type RpcAccount = z.infer<typeof rpcAccountSchema>;
const slotContext = z.object({ slot: z.number().int().nonnegative().safe() });
const bytes = (account: RpcAccount) => Buffer.from(account.data[0], "base64");
export function pullFilters(status: 1 | 2) {
  return [
    {
      memcmp: {
        offset: 0,
        bytes: discriminator("account", "Pull").toString("base64"),
        encoding: "base64",
      },
    },
    {
      memcmp: {
        offset: KEEPER_LAYOUT.pullStatus,
        bytes: Buffer.from([status]).toString("base64"),
        encoding: "base64",
      },
    },
  ];
}
export function zeroLedgerFilters() {
  return [
    { dataSize: KEEPER_LAYOUT.ledgerSize },
    {
      memcmp: {
        offset: 0,
        bytes: discriminator("account", "MintLedger").toString("base64"),
        encoding: "base64",
      },
    },
    {
      memcmp: {
        offset: KEEPER_LAYOUT.ledgerAccounted,
        bytes: Buffer.alloc(8).toString("base64"),
        encoding: "base64",
      },
    },
  ];
}
export class KeeperChain {
  constructor(
    private readonly client: JsonRpcClient,
    readonly programId: PublicKey,
    readonly limits: KeeperLimits,
    private readonly payer: PublicKey,
  ) {
    if (
      !Number.isSafeInteger(limits.settlePacksPerTx) ||
      limits.settlePacksPerTx <= 0 ||
      !Number.isSafeInteger(limits.maxTxBytes) ||
      limits.maxTxBytes <= 0
    )
      throw new Error("keeper_invalid_limits");
  }
  chainNow(): Promise<bigint> {
    return this.client.chainNow();
  }
  private owned(account: RpcAccount): Buffer {
    if (account.owner !== this.programId.toBase58() || account.executable)
      throw new Error("keeper_invalid_owner");
    return bytes(account);
  }
  private async accounts(
    addresses: readonly PublicKey[],
    commitment: KeeperCommitment,
    signal?: AbortSignal,
  ) {
    const result = await this.client.request(
      "getMultipleAccounts",
      [
        addresses.map((address) => address.toBase58()),
        { commitment, encoding: "base64" },
      ],
      z.object({
        context: slotContext,
        value: z.array(rpcAccountSchema.nullable()),
      }),
      signal,
    );
    if (result.value.length !== addresses.length)
      throw new Error("keeper_invalid_rpc_accounts");
    return result;
  }
  async snapshot(
    commitment: KeeperCommitment = "confirmed",
    signal?: AbortSignal,
  ): Promise<KeeperSnapshot> {
    const result = await this.accounts(
      [
        keeperPda(this.programId, "config"),
        keeperPda(this.programId, "machine"),
      ],
      commitment,
      signal,
    );
    const [config, machine] = result.value;
    if (!config || !machine) throw new Error("keeper_missing_snapshot");
    return decodeSnapshot(
      this.owned(config),
      this.owned(machine),
      result.context.slot,
    );
  }
  async pullCompletion(
    address: PublicKey,
    commitment: KeeperCommitment,
    signal?: AbortSignal,
  ): Promise<{ pull: KeeperPull | null; nextSeq: bigint }> {
    // One bank snapshot prevents absence before creation being paired with a
    // newer Machine that already includes that creation.
    const [pullAccount, machine] = (
      await this.accounts(
        [address, keeperPda(this.programId, "machine")],
        commitment,
        signal,
      )
    ).value;
    if (!machine) throw new Error("keeper_missing_machine");
    const data = this.owned(machine);
    checkData(data, "Machine", KEEPER_LAYOUT.machineSize);
    if (data.readUInt8(8) !== 1) throw new Error("keeper_invalid_machine");
    const pull =
      !pullAccount ||
      (pullAccount.owner !== this.programId.toBase58() &&
        bytes(pullAccount).length === 0)
        ? null
        : decodePull(this.owned(pullAccount), address, this.programId);
    return { pull, nextSeq: data.readBigUInt64LE(16) };
  }
  async scanPulls(status: 1 | 2, signal?: AbortSignal): Promise<KeeperPull[]> {
    const accounts = await this.client.request(
      "getProgramAccounts",
      [
        this.programId.toBase58(),
        {
          commitment: "confirmed",
          encoding: "base64",
          filters: pullFilters(status),
        },
      ],
      z.array(z.object({ pubkey: pubkeySchema, account: rpcAccountSchema })),
      signal,
    );
    return accounts.map(({ pubkey, account }) => {
      const pull = decodePull(
        this.owned(account),
        new PublicKey(pubkey),
        this.programId,
      );
      if (pull.status !== status)
        throw new Error("keeper_pull_filter_mismatch");
      return pull;
    });
  }
  async pull(
    address: PublicKey,
    commitment: KeeperCommitment = "confirmed",
    signal?: AbortSignal,
  ): Promise<KeeperPull | null> {
    const [account] = (await this.accounts([address], commitment, signal))
      .value;
    if (
      !account ||
      (account.owner !== this.programId.toBase58() &&
        bytes(account).length === 0)
    )
      return null;
    return decodePull(this.owned(account), address, this.programId);
  }
  async zeroLedgers(signal?: AbortSignal): Promise<KeeperLedger[]> {
    const accounts = await this.client.request(
      "getProgramAccounts",
      [
        this.programId.toBase58(),
        {
          commitment: "confirmed",
          encoding: "base64",
          filters: zeroLedgerFilters(),
        },
      ],
      z.array(z.object({ pubkey: pubkeySchema, account: rpcAccountSchema })),
      signal,
    );
    return accounts.map(({ pubkey, account }) => {
      const ledger = decodeLedger(
        this.owned(account),
        new PublicKey(pubkey),
        this.programId,
      );
      if (ledger.accounted !== 0n)
        throw new Error("keeper_ledger_filter_mismatch");
      return ledger;
    });
  }
  async ledger(
    mint: PublicKey,
    commitment: KeeperCommitment = "confirmed",
    signal?: AbortSignal,
  ): Promise<KeeperLedger | null> {
    const address = keeperPda(this.programId, "ledger", mint.toBuffer());
    const [account] = (await this.accounts([address], commitment, signal))
      .value;
    if (
      !account ||
      (account.owner !== this.programId.toBase58() &&
        bytes(account).length === 0)
    )
      return null;
    return decodeLedger(this.owned(account), address, this.programId);
  }
  async payees(
    addresses: readonly PublicKey[],
    commitment: KeeperCommitment = "confirmed",
    signal?: AbortSignal,
  ): Promise<Map<string, Payee>> {
    const distinct = [
      ...new Map(
        addresses.map((address) => [address.toBase58(), address]),
      ).values(),
    ];
    if (!distinct.length) return new Map();
    const result = await this.accounts(distinct, commitment, signal);
    return new Map(
      distinct.map((address, index) => [
        address.toBase58(),
        { address, executable: result.value[index]?.executable ?? false },
      ]),
    );
  }
  async settle(
    pull: KeeperPull,
    packs: readonly number[],
    signal?: AbortSignal,
  ): Promise<TransactionInstruction[]> {
    if (new Set(packs).size !== packs.length)
      throw new Error("keeper_duplicate_pack");
    const selected = packs.map((index) => {
      const record = pull.packs[index];
      if (!record || !Number.isInteger(index) || index < 0 || pull.status !== 2)
        throw new Error("keeper_invalid_pack");
      return { index, record };
    });
    const payees = await this.payees(
      [
        pull.buyer,
        pull.referrer,
        ...selected.flatMap(({ record }) =>
          record.royalties.map((royalty) => royalty.depositor),
        ),
      ],
      "confirmed",
      signal,
    );
    const get = (address: PublicKey) => {
      const payee = payees.get(address.toBase58());
      if (!payee) throw new Error("keeper_missing_payee");
      return payee;
    };
    return buildSettleTransaction(
      {
        wallet: this.payer,
        blockhash: PublicKey.default.toBase58(),
        computeBudget: false,
        packs: selected.map(({ index, record }) => {
          const wallet = (slot: number): Payee | null => {
            const royalty = record.royalties[slot];
            if (!royalty) throw new Error("keeper_invalid_royalty");
            return (record.houseMask & (1 << slot)) !== 0
              ? null
              : get(royalty.depositor);
          };
          return {
            pull: pull.address,
            seq: pull.seq,
            pack: index,
            buyer: get(pull.buyer),
            ...(pull.referrer.equals(PublicKey.default)
              ? {}
              : { referrer: get(pull.referrer) }),
            wallets: [wallet(0), wallet(1), wallet(2), wallet(3)],
          };
        }),
      },
      this,
    ).instructions;
  }
  async refund(
    pull: KeeperPull,
    signal?: AbortSignal,
  ): Promise<TransactionInstruction> {
    const buyer = (await this.payees([pull.buyer], "confirmed", signal)).get(
      pull.buyer.toBase58(),
    );
    if (!buyer) throw new Error("keeper_missing_payee");
    return refundPullInstruction(
      { pull: pull.address, seq: pull.seq, buyer },
      this.programId,
    );
  }
  advance(): TransactionInstruction {
    return instruction(this.programId, "advance_phase", [
      meta(keeperPda(this.programId, "config")),
      meta(keeperPda(this.programId, "machine"), true),
    ]);
  }
  async closeVaultState(
    ledger: KeeperLedger,
    commitment: KeeperCommitment = "confirmed",
    signal?: AbortSignal,
  ): Promise<{
    vaultExists: boolean;
    payerWritable: boolean;
    tokenProgram: PublicKey;
  }> {
    const result = await this.accounts(
      [ledger.mint, ledger.payer],
      commitment,
      signal,
    );
    const [mint, payer] = result.value;
    if (!mint || mint.executable || !TOKEN_PROGRAMS.has(mint.owner))
      throw new Error("keeper_invalid_mint");
    const tokenProgram = new PublicKey(mint.owner);
    const [vault] = (
      await this.accounts(
        [vaultAta(this.programId, ledger.mint, tokenProgram)],
        commitment,
        signal,
      )
    ).value;
    if (vault) {
      const data = bytes(vault);
      if (
        vault.owner !== mint.owner ||
        vault.executable ||
        data.length < 165 ||
        !keyAt(data, 0).equals(ledger.mint) ||
        !keyAt(data, 32).equals(keeperPda(this.programId, "vault_auth"))
      )
        throw new Error("keeper_invalid_vault");
    }
    return {
      tokenProgram,
      vaultExists: vault != null,
      payerWritable: payeeWritable({
        address: ledger.payer,
        executable: payer?.executable ?? false,
      }),
    };
  }
  closeVault(
    ledger: KeeperLedger,
    tokenProgram: PublicKey,
  ): TransactionInstruction {
    if (!TOKEN_PROGRAMS.has(tokenProgram.toBase58()))
      throw new Error("keeper_invalid_token_program");
    return instruction(this.programId, "close_vault", [
      meta(keeperPda(this.programId, "machine")),
      meta(ledger.mint, true),
      meta(keeperPda(this.programId, "ledger", ledger.mint.toBuffer()), true),
      meta(vaultAta(this.programId, ledger.mint, tokenProgram), true),
      meta(keeperPda(this.programId, "vault_auth")),
      meta(ledger.payer, true),
      meta(tokenProgram),
    ]);
  }
  teamWithdraw(teamWallet: PublicKey): TransactionInstruction {
    return instruction(this.programId, "team_withdraw", [
      meta(keeperPda(this.programId, "machine"), true),
      meta(keeperPda(this.programId, "config")),
      meta(teamWallet, true),
    ]);
  }
}

// SWITCH to @onepercent/sdk/events when the trigger accepts its transaction-level
// error input and committed-event result. This existing callback only receives
// logs and programId; it schedules a fresh account scan without trusting events.
export function parsePullRevealedLogs(
  logs: readonly string[],
  programId: PublicKey,
): { pull: PublicKey; seq: bigint }[] {
  const stack: string[] = [];
  const events: { pull: PublicKey; seq: bigint }[] = [];
  for (const log of logs) {
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(
      log,
    );
    if (invoke) {
      stack.length = Number(invoke[2]) - 1;
      stack.push(invoke[1] as string);
      continue;
    }
    const end = /^Program ([1-9A-HJ-NP-Za-km-z]+) (?:success|failed:.*)$/.exec(
      log,
    );
    if (end) {
      if (stack.at(-1) === end[1]) stack.pop();
      else stack.length = 0;
      continue;
    }
    if (
      stack.at(-1) !== programId.toBase58() ||
      !log.startsWith("Program data: ")
    )
      continue;
    const encoded = log.slice("Program data: ".length);
    const data = Buffer.from(encoded, "base64");
    // 8 discriminator + 32 pull + 8 seq + 32 buyer + 32 randomness + 1 qty + 6 u64.
    if (
      data.toString("base64") === encoded &&
      data.length === 161 &&
      data.subarray(0, 8).equals(discriminator("event", "PullRevealed"))
    ) {
      events.push({ pull: keyAt(data, 8), seq: data.readBigUInt64LE(40) });
    }
  }
  return events;
}
