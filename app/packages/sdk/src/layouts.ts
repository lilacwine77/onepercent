import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { ACCOUNT_SIZES } from "@onepercent/config";
import { discriminator, integer } from "./bytes.js";
import { SIZES } from "./constants.js";

export type DeepPartial<T> = T extends PublicKey | Uint8Array
  ? T
  : T extends readonly (infer U)[]
    ? DeepPartial<U>[]
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;
interface Codec<T> {
  size: number;
  read(data: Buffer, offset: number): T;
  write(data: Buffer, offset: number, value: DeepPartial<T> | undefined): void;
}
type Value<C> = C extends Codec<infer T> ? T : never;
type Field = readonly [number, Codec<unknown>];
type Fields = Record<string, Field>;
type RecordValue<F extends Fields> = { [K in keyof F]: Value<F[K][1]> };
const byte: Codec<number> = {
  size: 1,
  read: (b, o) => b.readUInt8(o),
  write: (b, o, v = 0) => {
    b.writeUInt8(integer(v, 255), o);
  },
};
const short: Codec<number> = {
  size: 2,
  read: (b, o) => b.readUInt16LE(o),
  write: (b, o, v = 0) => {
    b.writeUInt16LE(integer(v, 65535), o);
  },
};
const word: Codec<number> = {
  size: 4,
  read: (b, o) => b.readUInt32LE(o),
  write: (b, o, v = 0) => {
    b.writeUInt32LE(integer(v, 0xffffffff), o);
  },
};
const long: Codec<bigint> = {
  size: 8,
  read: (b, o) => b.readBigUInt64LE(o),
  write: (b, o, v = 0n) => {
    b.writeBigUInt64LE(v, o);
  },
};
const signed: Codec<bigint> = {
  size: 8,
  read: (b, o) => b.readBigInt64LE(o),
  write: (b, o, v = 0n) => {
    b.writeBigInt64LE(v, o);
  },
};
const key: Codec<PublicKey> = {
  size: 32,
  read: (b, o) => new PublicKey(b.subarray(o, o + 32)),
  write: (b, o, v = PublicKey.default) => {
    v.toBuffer().copy(b, o);
  },
};
const bytes = (size: number): Codec<Uint8Array> => ({
  size,
  read: (b, o) => Uint8Array.from(b.subarray(o, o + size)),
  write: (b, o, v = new Uint8Array(size)) => {
    if (v.length !== size) throw new RangeError("Wrong fixed byte length");
    b.set(v, o);
  },
});
const array = <T>(codec: Codec<T>, length: number): Codec<T[]> => ({
  size: codec.size * length,
  read: (b, o) =>
    Array.from({ length }, (_, i) => codec.read(b, o + i * codec.size)),
  write: (b, o, values) => {
    if (values && values.length !== length)
      throw new RangeError("Wrong fixed array length");
    for (let i = 0; i < length; i++)
      codec.write(b, o + i * codec.size, values?.[i]);
  },
});
function struct<const F extends Fields>(
  size: number,
  fields: F,
): Codec<RecordValue<F>> & { fields: { [K in keyof F]: number } } {
  for (const [offset, codec] of Object.values(fields))
    if (offset + codec.size > size)
      throw new Error("Layout exceeds declared size");
  return {
    size,
    fields: Object.fromEntries(
      Object.entries(fields).map(([k, [o]]) => [k, o]),
    ) as { [K in keyof F]: number },
    read(data, offset) {
      if (data.length < offset + size)
        throw new RangeError("Account is too short");
      return Object.fromEntries(
        Object.entries(fields).map(([name, [at, codec]]) => [
          name,
          codec.read(data, offset + at),
        ]),
      ) as RecordValue<F>;
    },
    write(data, offset, value) {
      for (const [name, [at, codec]] of Object.entries(fields))
        codec.write(
          data,
          offset + at,
          (value as Record<string, unknown> | undefined)?.[name],
        );
    },
  };
}
function account<const F extends Fields>(
  name: string,
  size: number,
  fields: F,
) {
  const layout = struct(size, { discriminator: [0, bytes(8)], ...fields });
  const disc = discriminator("account", name);
  return {
    ...layout,
    decode(data: Uint8Array): RecordValue<F> {
      const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      if (!buffer.subarray(0, 8).equals(disc))
        throw new Error(`Wrong ${name} discriminator`);
      return layout.read(buffer, 0) as RecordValue<F>;
    },
    encode(
      value: DeepPartial<RecordValue<F>> = {} as DeepPartial<RecordValue<F>>,
    ): Buffer {
      const data = Buffer.alloc(size);
      layout.write(data, 0, value as Parameters<typeof layout.write>[2]);
      disc.copy(data);
      return data;
    },
  };
}

export const bucketLayout = struct(SIZES.bucket, {
  mint: [0, key],
  oracle: [32, key],
  amount: [64, long],
  cost: [72, long],
  reserved: [80, long],
  cap: [88, long],
  trend_bought_hour: [96, long],
  trend_hour_index: [104, word],
  decimals: [108, byte],
  class: [109, byte],
  enabled: [110, byte],
  token_program: [111, byte],
  final_pool: [112, long],
  trend_sold_hour: [120, long],
});
export type Bucket = Value<typeof bucketLayout>;
export const bucketHistoryLayout = struct(24, {
  listed_ts: [0, signed],
  sb_inflow_hour: [8, long],
  sb_inflow_prev_hour: [16, long],
});
export type BucketHistory = Value<typeof bucketHistoryLayout>;
export const onePctSlotLayout = struct(SIZES.onePctSlot, {
  amount: [0, long],
  state: [8, byte],
  _pad: [9, bytes(7)],
});
export const spotlightSlotLayout = struct(SIZES.spotlightSlot, {
  mint: [0, key],
  sponsor: [32, key],
  window_start: [64, signed],
  amount: [72, long],
  state: [80, byte],
  _pad: [81, bytes(15)],
});
export const execRecordLayout = struct(SIZES.execRecord, {
  kind: [0, byte],
  bucket: [1, byte],
  _pad: [2, bytes(6)],
  amount: [8, long],
  v0: [16, long],
  min_out: [24, long],
  slot: [32, long],
  target: [40, key],
  aux: [72, long],
});
export const configLayout = account("Config", SIZES.config, {
  admin: [8, key],
  guardians: [40, array(key, 2)],
  keeper: [104, key],
  executor: [136, key],
  intake_signer: [168, key],
  quote_signer: [200, key],
  launch_wallet: [232, key],
  team_wallet: [264, key],
  team_wallets: [296, array(key, 8)],
  token_mint: [552, key],
  vrf_queues: [584, array(key, 4)],
  snapshot_slot: [712, long],
  snapshot_ts: [720, signed],
  stock_up_ts: [728, signed],
  version: [736, byte],
  bump: [737, byte],
  active_queue: [738, byte],
  season_set: [739, byte],
  admin_paused: [740, byte],
  guardian_paused: [741, byte],
  disabled_roles: [742, byte],
  _pad: [743, byte],
  vrf_program: [744, key],
  _reserved: [776, bytes(96)],
});
export type Config = ReturnType<typeof configLayout.decode>;
export const machineLayout = account("Machine", SIZES.machine, {
  version: [8, byte],
  bump: [9, byte],
  phase: [10, byte],
  vault_auth_bump: [11, byte],
  deck_bump: [12, byte],
  config_bump: [13, byte],
  fee_in_bump: [14, byte],
  _pad0: [15, byte],
  next_seq: [16, long],
  pending_pulls: [24, long],
  reserved_dust: [32, long],
  power_on_ts: [40, signed],
  on_air_ts: [48, signed],
  end_ts: [56, signed],
  final_ts: [64, signed],
  stock_sol: [72, long],
  jackpot_sol: [80, long],
  burn_sol: [88, long],
  team_sol: [96, long],
  final_pool_sol: [104, long],
  total_spend: [112, long],
  hour_index: [120, long],
  hit_out_this_hour: [128, long],
  hit_out_last_hour: [136, long],
  sb_paid_hour: [144, long],
  sol_at_hour_start: [152, long],
  packs_revealed: [160, array(long, 4)],
  hit_value_out: [192, array(long, 4)],
  buckets: [224, array(bucketLayout, 16)],
  jackpot_tokens: [2272, long],
  jackpot_cost: [2280, long],
  burned_total: [2288, long],
  last_burn_ts: [2296, signed],
  burn_hour_index: [2304, long],
  burn_paid_hour: [2312, long],
  last_jackpot_buy_ts: [2320, signed],
  final_pool_1pct: [2328, long],
  onepct: [2336, array(onePctSlotLayout, 4)],
  spotlight: [2400, spotlightSlotLayout],
  exec: [2496, execRecordLayout],
  last_stock_trade_ts: [2576, signed],
  stock_hour_index: [2584, long],
  stock_bought_hour: [2592, long],
  stock_sold_hour: [2600, long],
  token_mint: [2608, key],
  final_sol_total: [2640, long],
  final_1pct_total: [2648, long],
  last_reveal_ts: [2656, signed],
  sb_paid_prev_hour: [2664, long],
  keeper_history_version: [2672, long],
  keeper_history_started_ts: [2680, signed],
  bucket_history: [2688, array(bucketHistoryLayout, 16)],
  unsettled_reveals: [3072, long],
  _reserved0: [3080, bytes(600)],
  _reserved1: [3680, bytes(128)],
});
export type Machine = ReturnType<typeof machineLayout.decode>;
export const deckEntryLayout = struct(ACCOUNT_SIZES.deckEntry, {
  depositor: [0, key],
  mint: [32, key],
  amount: [64, long],
  deposit: [72, word],
  flags: [76, byte],
  _pad: [77, bytes(3)],
});
export type DeckEntry = Value<typeof deckEntryLayout>;
export const deckHeaderLayout = account("Deck", ACCOUNT_SIZES.deckHeader, {
  len: [8, word],
  cap: [12, word],
  header_rent: [16, long],
  total_fed: [24, long],
  total_pulled: [32, long],
  total_taken_back: [40, long],
  bump: [48, byte],
  version: [49, byte],
  _pad: [50, bytes(6)],
  _reserved: [56, bytes(8)],
});
export const cardLayout = struct(ACCOUNT_SIZES.cardSlot, {
  mint: [0, key],
  amount: [32, long],
  value: [40, long],
  kind: [48, byte],
  edition: [49, byte],
  flags: [50, byte],
  _pad: [51, byte],
  seq_lo: [52, word],
});
export type Card = Value<typeof cardLayout>;
export const binderHeaderLayout = account(
  "Binder",
  ACCOUNT_SIZES.binderHeader,
  {
    owner: [8, key],
    referrer: [40, key],
    season_spend: [72, long],
    sol_owed: [80, long],
    feed_nonce_base: [88, word],
    sb_nonce: [92, word],
    pull_nonce: [96, word],
    feed_nonce_bits: [100, short],
    fresh_in_deck: [102, short],
    len: [104, short],
    cap: [106, short],
    reserved: [108, short],
    bump: [110, byte],
    flags: [111, byte],
  },
);
export const royaltyLayout = struct(SIZES.royalty, {
  depositor: [0, key],
  lamports: [32, long],
  refund: [40, long],
});
export const packRecordLayout = struct(ACCOUNT_SIZES.pullPerPack, {
  royalties: [0, array(royaltyLayout, 4)],
  backing: [192, byte],
  tier: [193, byte],
  carved_bucket: [194, byte],
  house_mask: [195, byte],
  fresh_mask: [196, byte],
  _pad: [197, bytes(3)],
});
export type PackRecord = Value<typeof packRecordLayout>;
export const pullHeaderLayout = account("Pull", ACCOUNT_SIZES.pullHeader, {
  seq: [8, long],
  buyer: [16, key],
  referrer: [48, key],
  randomness: [80, bytes(32)],
  created_ts: [112, signed],
  revealed_ts: [120, signed],
  price: [128, long],
  buyer_nonce: [136, word],
  settled_mask: [140, short],
  edition: [142, byte],
  qty: [143, byte],
  status: [144, byte],
  holder: [145, byte],
  bump: [146, byte],
  version: [147, byte],
  live_flags: [148, byte],
  _pad: [149, bytes(3)],
  _reserved: [152, bytes(24)],
});
export const mintLedgerLayout = account(
  "MintLedger",
  ACCOUNT_SIZES.mintLedger,
  { mint: [8, key], payer: [40, key], accounted: [72, long] },
);
export type MintLedger = ReturnType<typeof mintLedgerLayout.decode>;

function checkTail(
  data: Uint8Array,
  size: number,
  slot: number,
  cap: number,
  len: number,
) {
  if (len > cap || data.length !== size + slot * cap)
    throw new RangeError("Invalid dynamic account capacity");
}
export function decodeDeck(
  data: Uint8Array,
  range?: { start: number; count: number },
) {
  const header = deckHeaderLayout.decode(data);
  checkTail(
    data,
    deckHeaderLayout.size,
    deckEntryLayout.size,
    header.cap,
    header.len,
  );
  const start = range?.start ?? 0;
  const count = range?.count ?? header.len;
  integer(start, header.len);
  integer(count, header.len - start);
  return {
    ...header,
    entries: Array.from({ length: count }, (_, i) =>
      deckEntryLayout.read(
        Buffer.from(data.buffer, data.byteOffset, data.byteLength),
        deckHeaderLayout.size + (start + i) * deckEntryLayout.size,
      ),
    ),
  };
}
export function encodeDeck(
  input: DeepPartial<ReturnType<typeof decodeDeck>>,
): Buffer {
  const entries = input.entries ?? [];
  const cap = input.cap ?? entries.length;
  const len = input.len ?? entries.length;
  if (len > cap || entries.length > cap)
    throw new RangeError("Invalid Deck capacity");
  const data = Buffer.alloc(deckHeaderLayout.size + deckEntryLayout.size * cap);
  deckHeaderLayout.encode({ ...input, cap, len }).copy(data);
  entries.forEach((entry, i) =>
    deckEntryLayout.write(
      data,
      deckHeaderLayout.size + i * deckEntryLayout.size,
      entry,
    ),
  );
  return data;
}
export function decodeBinder(data: Uint8Array) {
  const header = binderHeaderLayout.decode(data);
  checkTail(
    data,
    binderHeaderLayout.size,
    cardLayout.size,
    header.cap,
    header.len + header.reserved,
  );
  return {
    ...header,
    cards: Array.from({ length: header.len }, (_, i) =>
      cardLayout.read(
        Buffer.from(data.buffer, data.byteOffset, data.byteLength),
        binderHeaderLayout.size + i * cardLayout.size,
      ),
    ),
  };
}
export function encodeBinder(
  input: DeepPartial<ReturnType<typeof decodeBinder>>,
): Buffer {
  const cards = input.cards ?? [];
  const len = input.len ?? cards.length;
  const cap = input.cap ?? len + (input.reserved ?? 0);
  if (len + (input.reserved ?? 0) > cap || cards.length > cap)
    throw new RangeError("Invalid Binder capacity");
  const data = Buffer.alloc(binderHeaderLayout.size + cardLayout.size * cap);
  binderHeaderLayout.encode({ ...input, cap, len }).copy(data);
  cards.forEach((card, i) =>
    cardLayout.write(data, binderHeaderLayout.size + i * cardLayout.size, card),
  );
  return data;
}
export function decodePull(data: Uint8Array) {
  const header = pullHeaderLayout.decode(data);
  checkTail(
    data,
    pullHeaderLayout.size,
    packRecordLayout.size,
    header.qty,
    header.qty,
  );
  return {
    ...header,
    packs: Array.from({ length: header.qty }, (_, i) =>
      packRecordLayout.read(
        Buffer.from(data.buffer, data.byteOffset, data.byteLength),
        pullHeaderLayout.size + i * packRecordLayout.size,
      ),
    ),
  };
}
export function encodePull(
  input: DeepPartial<ReturnType<typeof decodePull>>,
): Buffer {
  const packs = input.packs ?? [];
  const qty = input.qty ?? packs.length;
  if (packs.length > qty) throw new RangeError("Invalid Pull quantity");
  const data = Buffer.alloc(
    pullHeaderLayout.size + packRecordLayout.size * qty,
  );
  pullHeaderLayout.encode({ ...input, qty }).copy(data);
  packs.forEach((pack, i) =>
    packRecordLayout.write(
      data,
      pullHeaderLayout.size + i * packRecordLayout.size,
      pack,
    ),
  );
  return data;
}
export type Deck = ReturnType<typeof decodeDeck>;
export type Binder = ReturnType<typeof decodeBinder>;
export type Pull = ReturnType<typeof decodePull>;
export const decodeConfig = configLayout.decode;
export const encodeConfig = configLayout.encode;
export const decodeMachine = machineLayout.decode;
export const encodeMachine = machineLayout.encode;
export const decodeMintLedger = mintLedgerLayout.decode;
export const encodeMintLedger = mintLedgerLayout.encode;
export const LAYOUTS = {
  Config: configLayout,
  Machine: machineLayout,
  Bucket: bucketLayout,
  BucketHistory: bucketHistoryLayout,
  OnePctSlot: onePctSlotLayout,
  SpotlightSlot: spotlightSlotLayout,
  ExecRecord: execRecordLayout,
  Deck: deckHeaderLayout,
  DeckEntry: deckEntryLayout,
  Binder: binderHeaderLayout,
  Card: cardLayout,
  Pull: pullHeaderLayout,
  PackRecord: packRecordLayout,
  Royalty: royaltyLayout,
  MintLedger: mintLedgerLayout,
};
