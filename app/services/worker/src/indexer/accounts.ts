import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

// Read-only M1 draft ABI, checked against state/*.rs and the draft IDL.
// Structural sizes only. Replace this adapter with the merged M1 SDK at G1.
export const ACCOUNT_BYTES = {
  Machine: 3808,
  Config: 872,
  MintLedger: 80,
  Deck: 64,
  deckEntry: 80,
  Pull: 176,
  packRecord: 200,
} as const;
export const TOKEN_PROGRAMS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
] as const;
const ATA_PROGRAM = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const ZERO_ADDRESS = PublicKey.default.toBase58();
export type AccountKind = "Machine" | "Config" | "MintLedger" | "Deck" | "Pull";
export const accountDiscriminator = (name: AccountKind) =>
  createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
export function accountKind(data: Buffer): AccountKind | undefined {
  return (["Machine", "Config", "MintLedger", "Deck", "Pull"] as const).find(
    (name) => data.subarray(0, 8).equals(accountDiscriminator(name)),
  );
}
function check(data: Buffer, name: AccountKind, dynamic = false) {
  if (
    (dynamic
      ? data.length < ACCOUNT_BYTES[name]
      : data.length !== ACCOUNT_BYTES[name]) ||
    !data.subarray(0, 8).equals(accountDiscriminator(name))
  )
    throw new Error(`invalid_account:${name}`);
}
const key = (data: Buffer, offset: number) =>
  new PublicKey(data.subarray(offset, offset + 32)).toBase58();
const u64 = (data: Buffer, offset: number) => data.readBigUInt64LE(offset);
const i64 = (data: Buffer, offset: number) => data.readBigInt64LE(offset);
function fields(
  data: Buffer,
  names: readonly string[],
  offset: number,
  signed = false,
) {
  return Object.fromEntries(
    names.map((name, index) => [
      name,
      (signed ? i64 : u64)(data, offset + index * 8),
    ]),
  );
}
export function singletonAddress(
  programId: string,
  seed: "machine" | "config" | "deck" | "vault_auth",
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed)],
    new PublicKey(programId),
  )[0].toBase58();
}
export function ledgerAddress(programId: string, mint: string) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ledger"), new PublicKey(mint).toBuffer()],
    new PublicKey(programId),
  )[0].toBase58();
}
export function pullAddress(programId: string, buyer: string, nonce: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(nonce);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pull"), new PublicKey(buyer).toBuffer(), bytes],
    new PublicKey(programId),
  )[0].toBase58();
}
export function vaultAddress(
  programId: string,
  mint: string,
  tokenProgram: string,
) {
  return PublicKey.findProgramAddressSync(
    [
      new PublicKey(singletonAddress(programId, "vault_auth")).toBuffer(),
      new PublicKey(tokenProgram).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    ATA_PROGRAM,
  )[0].toBase58();
}
export function decodeDeckHeader(data: Buffer) {
  check(data, "Deck");
  const len = data.readUInt32LE(8);
  const cap = data.readUInt32LE(12);
  if (len > cap) throw new Error("invalid_deck_capacity");
  return {
    len,
    cap,
    header_rent: u64(data, 16),
    total_fed: u64(data, 24),
    total_pulled: u64(data, 32),
    total_taken_back: u64(data, 40),
    bump: data.readUInt8(48),
    version: data.readUInt8(49),
  };
}
export interface DeckEntry {
  depositor: string;
  mint: string;
  amount: bigint;
  deposit: bigint;
  flags: number;
}
export function decodeDeckEntry(data: Buffer): DeckEntry {
  if (data.length !== ACCOUNT_BYTES.deckEntry)
    throw new Error("invalid_deck_entry_length");
  return {
    depositor: key(data, 0),
    mint: key(data, 32),
    amount: u64(data, 64),
    deposit: BigInt(data.readUInt32LE(72)),
    flags: data.readUInt8(76),
  };
}
export function decodeLedger(data: Buffer) {
  check(data, "MintLedger");
  return { mint: key(data, 8), payer: key(data, 40), accounted: u64(data, 72) };
}
export function decodePull(data: Buffer) {
  check(data, "Pull", true);
  const qty = data.readUInt8(143);
  const status = data.readUInt8(144);
  if (
    data.length !== ACCOUNT_BYTES.Pull + qty * ACCOUNT_BYTES.packRecord ||
    qty === 0 ||
    (status !== 1 && status !== 2)
  )
    throw new Error("invalid_pull_layout");
  return {
    seq: u64(data, 8),
    buyer: key(data, 16),
    referrer: key(data, 48),
    randomness: data.subarray(80, 112).toString("hex"),
    created_ts: i64(data, 112),
    revealed_ts: i64(data, 120),
    price: u64(data, 128),
    buyer_nonce: data.readUInt32LE(136),
    settled_mask: data.readUInt16LE(140),
    edition: data.readUInt8(142),
    qty,
    status: status === 1 ? ("pending" as const) : ("revealed" as const),
    holder: data.readUInt8(145) !== 0,
    live_flags: data.readUInt8(148),
    packs: Array.from({ length: qty }, (_, index) => {
      const at = ACCOUNT_BYTES.Pull + index * ACCOUNT_BYTES.packRecord;
      return {
        royalties: Array.from({ length: 4 }, (_, k) => ({
          depositor: key(data, at + k * 48),
          lamports: u64(data, at + k * 48 + 32),
          refund: u64(data, at + k * 48 + 40),
        })),
        backing: data.readUInt8(at + 192),
        tier: data.readUInt8(at + 193),
        carved_bucket: data.readUInt8(at + 194),
        house_mask: data.readUInt8(at + 195),
        fresh_mask: data.readUInt8(at + 196),
      };
    }),
  };
}
export function decodeConfig(data: Buffer) {
  check(data, "Config");
  return {
    admin: key(data, 8),
    guardians: [key(data, 40), key(data, 72)],
    keeper: key(data, 104),
    executor: key(data, 136),
    intake_signer: key(data, 168),
    quote_signer: key(data, 200),
    launch_wallet: key(data, 232),
    team_wallet: key(data, 264),
    team_wallets: Array.from({ length: 8 }, (_, i) => key(data, 296 + i * 32)),
    token_mint: key(data, 552),
    vrf_queues: Array.from({ length: 4 }, (_, i) => key(data, 584 + i * 32)),
    snapshot_slot: u64(data, 712),
    snapshot_ts: i64(data, 720),
    stock_up_ts: i64(data, 728),
    version: data.readUInt8(736),
    bump: data.readUInt8(737),
    active_queue: data.readUInt8(738),
    season_set: data.readUInt8(739),
    admin_paused: data.readUInt8(740),
    guardian_paused: data.readUInt8(741),
    disabled_roles: data.readUInt8(742),
    vrf_program: key(data, 744),
  };
}
export function decodeMachine(data: Buffer) {
  check(data, "Machine");
  return {
    version: data.readUInt8(8),
    bump: data.readUInt8(9),
    phase: data.readUInt8(10),
    vault_auth_bump: data.readUInt8(11),
    deck_bump: data.readUInt8(12),
    config_bump: data.readUInt8(13),
    fee_in_bump: data.readUInt8(14),
    ...fields(data, ["next_seq", "pending_pulls", "reserved_dust"], 16),
    ...fields(
      data,
      ["power_on_ts", "on_air_ts", "end_ts", "final_ts"],
      40,
      true,
    ),
    ...fields(
      data,
      [
        "stock_sol",
        "jackpot_sol",
        "burn_sol",
        "team_sol",
        "final_pool_sol",
        "total_spend",
        "hour_index",
        "hit_out_this_hour",
        "hit_out_last_hour",
        "sb_paid_hour",
        "sol_at_hour_start",
      ],
      72,
    ),
    packs_revealed: Array.from({ length: 4 }, (_, i) => u64(data, 160 + i * 8)),
    hit_value_out: Array.from({ length: 4 }, (_, i) => u64(data, 192 + i * 8)),
    buckets: Array.from({ length: 16 }, (_, index) => {
      const at = 224 + index * 128;
      return {
        index,
        mint: key(data, at),
        oracle: key(data, at + 32),
        amount: u64(data, at + 64),
        cost: u64(data, at + 72),
        reserved: u64(data, at + 80),
        cap: u64(data, at + 88),
        trend_bought_hour: u64(data, at + 96),
        trend_hour_index: data.readUInt32LE(at + 104),
        decimals: data.readUInt8(at + 108),
        class: data.readUInt8(at + 109),
        enabled: data.readUInt8(at + 110),
        token_program: data.readUInt8(at + 111),
        final_pool: u64(data, at + 112),
      };
    }),
    ...fields(data, ["jackpot_tokens", "jackpot_cost", "burned_total"], 2272),
    last_burn_ts: i64(data, 2296),
    burn_hour_index: u64(data, 2304),
    burn_paid_hour: u64(data, 2312),
    last_jackpot_buy_ts: i64(data, 2320),
    final_pool_1pct: u64(data, 2328),
    onepct: Array.from({ length: 4 }, (_, i) => ({
      amount: u64(data, 2336 + i * 16),
      state: data.readUInt8(2344 + i * 16),
    })),
    spotlight: {
      mint: key(data, 2400),
      sponsor: key(data, 2432),
      window_start: i64(data, 2464),
      amount: u64(data, 2472),
      state: data.readUInt8(2480),
    },
    exec: {
      kind: data.readUInt8(2496),
      bucket: data.readUInt8(2497),
      amount: u64(data, 2504),
      v0: u64(data, 2512),
      min_out: u64(data, 2520),
      slot: u64(data, 2528),
      target: key(data, 2536),
    },
  };
}
export const jsonAccount = (value: unknown) =>
  JSON.stringify(value, (_, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
