import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { PROGRAM_IDS, PUMP_LAYOUTS } from "@onepercent/config";

export const EXTERNAL_IDS = Object.fromEntries(
  Object.entries(PROGRAM_IDS).map(([name, key]) => [name, new PublicKey(key)]),
) as { [K in keyof typeof PROGRAM_IDS]: PublicKey };
export const SEEDS = {
  config: "config",
  machine: "machine",
  deck: "deck",
  vaultAuth: "vault_auth",
  feeIn: "fee_in",
  binder: "binder",
  pull: "pull",
  ledger: "ledger",
  identity: "identity",
} as const;
export const PHASE = {
  setup: 0,
  stockUp: 1,
  poweredOn: 2,
  onAir: 3,
  buysClosed: 4,
  finalPull: 5,
  done: 6,
} as const;
export const BUCKET_CLASS = { empty: 0, major: 1, trending: 2 } as const;
export const TOKEN_PROGRAM_CODE = { spl: 0, token2022: 1 } as const;
export const PULL_STATUS = { pending: 1, revealed: 2 } as const;
export const DECK_FLAGS = { fresh: 1, refed: 2 } as const;
export const LIVE_FLAGS = { onePct: 1, spotlight: 2, jackpot: 4 } as const;
export const ONE_PCT_STATE = {
  locked: 0,
  live: 1,
  pulled: 2,
  final: 3,
} as const;
export const CREATOR_FEE_REGIME = {
  belowFloor: 0,
  season: 1,
  afterEnd: 2,
} as const;
export type CreatorFeeRegime =
  (typeof CREATOR_FEE_REGIME)[keyof typeof CREATOR_FEE_REGIME];
export const SIZES = {
  config: 872,
  machine: 3808,
  bucket: 128,
  onePctSlot: 16,
  spotlightSlot: 96,
  execRecord: 80,
  royalty: 48,
} as const;
export const LEGACY_VRF_IDENTITY = new PublicKey(
  "9irBy75QS2BN81FUgXuHcjqceJJRuc9oDkAe8TKVvvAw",
);
export const TOKEN_2022_NATIVE_MINT = new PublicKey(
  "9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP",
);
export const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

// Agave 4.2.2 ReservedAccountKeys::all_keys, including inactive entries.
// Keep these accounts read-only even when a royalty or refund names them.
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "AddressLookupTab1e1111111111111111111111111",
  "BPFLoader2111111111111111111111111111111111",
  "BPFLoader1111111111111111111111111111111111",
  "BPFLoaderUpgradeab1e11111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "Config1111111111111111111111111111111111111",
  "Ed25519SigVerify111111111111111111111111111",
  "Feature111111111111111111111111111111111111",
  "LoaderV411111111111111111111111111111111111",
  "KeccakSecp256k11111111111111111111111111111",
  "Secp256r1SigVerify1111111111111111111111111",
  "StakeConfig11111111111111111111111111111111",
  "Stake11111111111111111111111111111111111111",
  "11111111111111111111111111111111",
  "Vote111111111111111111111111111111111111111",
  "ZkE1Gama1Proof11111111111111111111111111111",
  "ZkTokenProof1111111111111111111111111111111",
  "SysvarC1ock11111111111111111111111111111111",
  "SysvarEpochRewards1111111111111111111111111",
  "SysvarEpochSchedu1e111111111111111111111111",
  "SysvarFees111111111111111111111111111111111",
  "Sysvar1nstructions1111111111111111111111111",
  "SysvarLastRestartS1ot1111111111111111111111",
  "SysvarRecentB1ockHashes11111111111111111111",
  "SysvarRent111111111111111111111111111111111",
  "SysvarRewards111111111111111111111111111111",
  "SysvarS1otHashes111111111111111111111111111",
  "SysvarS1otHistory11111111111111111111111111",
  "SysvarStakeHistory1111111111111111111111111",
  "NativeLoader1111111111111111111111111111111",
  "Sysvar1111111111111111111111111111111111111",
]);

// M2 structural bounds; their parity with TX_LIMITS.redeemPerTx is tested.
export const MAX_SELL_BACK_CARDS = 8;
export const MAX_FEED_BACK_CARDS = 8;
export const EXEC_KIND = {
  none: 0,
  stockBuy: 1,
  stockSell: 2,
  burn: 3,
  jackpotBuy: 4,
} as const;
export type ExecKind = Exclude<(typeof EXEC_KIND)[keyof typeof EXEC_KIND], 0>;
export const BUCKET_NONE = 255;

// External account ABI from M2 §6.4; integer offsets are byte offsets.
export const PYTH_PRICE_UPDATE_V2_DISCRIMINATOR = Uint8Array.from([
  0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd,
]);
export const PYTH_PRICE_UPDATE_V2_MIN_LEN = 133;
export const PYTH_PRICE_UPDATE_V2_VERIFICATION_LEVEL_OFFSET = 40;
export const PYTH_PRICE_UPDATE_V2_FEED_ID_OFFSET = 41;
export const PYTH_PRICE_UPDATE_V2_PRICE_OFFSET = 73;
export const PYTH_PRICE_UPDATE_V2_CONF_OFFSET = 81;
export const PYTH_PRICE_UPDATE_V2_EXPONENT_OFFSET = 89;
export const PYTH_PRICE_UPDATE_V2_PUBLISH_TIME_OFFSET = 93;
export const POOL_AUTHORITY_SEED = "pool-authority";
export const PUMPSWAP_POOL_DISCRIMINATOR = Buffer.from(
  PUMP_LAYOUTS.poolDiscriminatorHex,
  "hex",
);
export const PUMPSWAP_POOL_MIN_LEN = 261;
export const PUMPSWAP_POOL_INDEX_OFFSET = 9;
export const PUMPSWAP_POOL_BASE_MINT_OFFSET = 43;
export const PUMPSWAP_POOL_QUOTE_MINT_OFFSET = 75;
export const PUMPSWAP_POOL_BASE_VAULT_OFFSET = 139;
export const PUMPSWAP_POOL_QUOTE_VAULT_OFFSET = 171;
export const PUMPSWAP_POOL_IS_MAYHEM_MODE_OFFSET = 243;
export const PUMPSWAP_POOL_VIRTUAL_QUOTE_RESERVES_OFFSET = 245;
export const BONDING_CURVE_DISCRIMINATOR = Buffer.from(
  PUMP_LAYOUTS.bondingCurveDiscriminatorHex,
  "hex",
);
export const BONDING_CURVE_MIN_LEN = 49;
export const BONDING_CURVE_VIRTUAL_TOKEN_RESERVES_OFFSET = 8;
export const BONDING_CURVE_VIRTUAL_SOL_RESERVES_OFFSET = 16;
export const BONDING_CURVE_REAL_TOKEN_RESERVES_OFFSET = 24;
export const BONDING_CURVE_COMPLETE_OFFSET = 48;
