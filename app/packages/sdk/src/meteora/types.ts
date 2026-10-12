// Account field types generated from the pinned, documentation-free IDLs.
import type { PublicKey } from "@solana/web3.js";
export interface DbcBaseFeeConfig {
  cliffFeeNumerator: bigint;
  secondFactor: bigint;
  thirdFactor: bigint;
  firstFactor: number;
  baseFeeMode: number;
  padding0: number[];
}
export interface DbcDynamicFeeConfig {
  initialized: number;
  padding: number[];
  maxVolatilityAccumulator: number;
  variableFeeControl: number;
  binStep: number;
  filterPeriod: number;
  decayPeriod: number;
  reductionFactor: number;
  padding2: number[];
  binStepU128: bigint;
}
export interface DbcPoolFeesConfig {
  baseFee: DbcBaseFeeConfig;
  dynamicFee: DbcDynamicFeeConfig;
}
export interface DbcLiquidityVestingInfo {
  isInitialized: number;
  vestingPercentage: number;
  Padding: number[];
  bpsPerPeriod: number;
  numberOfPeriods: number;
  frequency: number;
  cliffDurationFromMigrationTime: number;
}
export interface DbcLockedVestingConfig {
  amountPerPeriod: bigint;
  cliffDurationFromMigrationTime: bigint;
  frequency: bigint;
  numberOfPeriod: bigint;
  cliffUnlockAmount: bigint;
  Padding: bigint;
}
export interface DbcLiquidityDistributionConfig {
  sqrtPrice: bigint;
  liquidity: bigint;
}
export interface DbcPoolConfig {
  quoteMint: PublicKey;
  feeClaimer: PublicKey;
  leftoverReceiver: PublicKey;
  poolFees: DbcPoolFeesConfig;
  partnerLiquidityVestingInfo: DbcLiquidityVestingInfo;
  creatorLiquidityVestingInfo: DbcLiquidityVestingInfo;
  padding0: number[];
  padding1: number;
  collectFeeMode: number;
  migrationOption: number;
  activationType: number;
  tokenDecimal: number;
  version: number;
  tokenType: number;
  quoteTokenFlag: number;
  partnerPermanentLockedLiquidityPercentage: number;
  partnerLiquidityPercentage: number;
  creatorPermanentLockedLiquidityPercentage: number;
  creatorLiquidityPercentage: number;
  migrationFeeOption: number;
  fixedTokenSupplyFlag: number;
  creatorTradingFeePercentage: number;
  tokenUpdateAuthority: number;
  migrationFeePercentage: number;
  creatorMigrationFeePercentage: number;
  padding2: number[];
  swapBaseAmount: bigint;
  migrationQuoteThreshold: bigint;
  migrationBaseThreshold: bigint;
  migrationSqrtPrice: bigint;
  lockedVestingConfig: DbcLockedVestingConfig;
  preMigrationTokenSupply: bigint;
  postMigrationTokenSupply: bigint;
  migratedCollectFeeMode: number;
  migratedDynamicFee: number;
  migratedPoolFeeBps: number;
  migratedPoolBaseFeeMode: number;
  enableFirstSwapWithMinFee: number;
  migratedCompoundingFeeBps: number;
  poolCreationFee: bigint;
  migratedPoolBaseFeeBytes: number[];
  sqrtStartPrice: bigint;
  curve: DbcLiquidityDistributionConfig[];
}
export interface DbcVolatilityTracker {
  lastUpdateTimestamp: bigint;
  padding: number[];
  sqrtPriceReference: bigint;
  volatilityAccumulator: bigint;
  volatilityReference: bigint;
}
export interface DbcPoolMetrics {
  totalProtocolBaseFee: bigint;
  totalProtocolQuoteFee: bigint;
  totalTradingBaseFee: bigint;
  totalTradingQuoteFee: bigint;
}
export interface DbcPoolState {
  volatilityTracker: DbcVolatilityTracker;
  config: PublicKey;
  creator: PublicKey;
  baseMint: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  baseReserve: bigint;
  quoteReserve: bigint;
  protocolBaseFee: bigint;
  protocolQuoteFee: bigint;
  partnerBaseFee: bigint;
  partnerQuoteFee: bigint;
  sqrtPrice: bigint;
  activationPoint: bigint;
  poolType: number;
  isMigrated: number;
  isPartnerWithdrawSurplus: number;
  isProtocolWithdrawSurplus: number;
  migrationProgress: number;
  isWithdrawLeftover: number;
  isCreatorWithdrawSurplus: number;
  migrationFeeWithdrawStatus: number;
  metrics: DbcPoolMetrics;
  finishCurveTimestamp: bigint;
  creatorBaseFee: bigint;
  creatorQuoteFee: bigint;
  legacyCreationFeeBits: number;
  creationFeeBits: number;
  hasSwap: number;
  Padding0: number[];
  protocolLiquidityMigrationFeeBps: number;
  Padding1: number[];
  protocolMigrationBaseFeeAmount: bigint;
  protocolMigrationQuoteFeeAmount: bigint;
  Padding2: bigint[];
}
export interface DammV2BaseFeeInfo {
  data: number[];
}
export interface DammV2BaseFeeStruct {
  baseFeeInfo: DammV2BaseFeeInfo;
  padding1: bigint;
}
export interface DammV2DynamicFeeStruct {
  initialized: number;
  padding: number[];
  maxVolatilityAccumulator: number;
  variableFeeControl: number;
  binStep: number;
  filterPeriod: number;
  decayPeriod: number;
  reductionFactor: number;
  lastUpdateTimestamp: bigint;
  binStepU128: bigint;
  sqrtPriceReference: bigint;
  volatilityAccumulator: bigint;
  volatilityReference: bigint;
}
export interface DammV2PoolFeesStruct {
  baseFee: DammV2BaseFeeStruct;
  protocolFeePercent: number;
  padding0: number;
  referralFeePercent: number;
  padding1: number[];
  compoundingFeeBps: number;
  dynamicFee: DammV2DynamicFeeStruct;
  initSqrtPrice: bigint;
}
export interface DammV2PoolMetrics {
  totalLpAFee: bigint;
  totalLpBFee: bigint;
  totalProtocolAFee: bigint;
  totalProtocolBFee: bigint;
  padding0: bigint[];
  totalPosition: bigint;
  padding: bigint;
}
export interface DammV2RewardInfo {
  initialized: number;
  rewardTokenFlag: number;
  Padding0: number[];
  deadLiquidityRewardCheckpoint: bigint;
  mint: PublicKey;
  vault: PublicKey;
  funder: PublicKey;
  rewardDuration: bigint;
  rewardDurationEnd: bigint;
  rewardRate: bigint;
  rewardPerTokenStored: number[];
  lastUpdateTime: bigint;
  cumulativeSecondsWithEmptyLiquidityReward: bigint;
}
export interface DammV2Pool {
  poolFees: DammV2PoolFeesStruct;
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  whitelistedVault: PublicKey;
  padding0: number[];
  liquidity: bigint;
  padding1: bigint;
  protocolAFee: bigint;
  protocolBFee: bigint;
  deadLiquidityFeeCheckpoint: bigint;
  padding2: number[];
  sqrtMinPrice: bigint;
  sqrtMaxPrice: bigint;
  sqrtPrice: bigint;
  activationPoint: bigint;
  activationType: number;
  poolStatus: number;
  tokenAFlag: number;
  tokenBFlag: number;
  collectFeeMode: number;
  poolType: number;
  feeVersion: number;
  padding3: number;
  feeAPerLiquidity: number[];
  feeBPerLiquidity: number[];
  permanentLockLiquidity: bigint;
  metrics: DammV2PoolMetrics;
  creator: PublicKey;
  tokenAAmount: bigint;
  tokenBAmount: bigint;
  layoutVersion: number;
  padding4: number[];
  padding5: bigint[];
  rewardInfos: DammV2RewardInfo[];
}
export interface DammV2PositionMetrics {
  totalClaimedAFee: bigint;
  totalClaimedBFee: bigint;
}
export interface DammV2UserRewardInfo {
  rewardPerTokenCheckpoint: number[];
  rewardPendings: bigint;
  totalClaimedRewards: bigint;
}
export interface DammV2InnerVesting {
  cliffPoint: bigint;
  periodFrequency: bigint;
  cliffUnlockLiquidity: bigint;
  liquidityPerPeriod: bigint;
  totalReleasedLiquidity: bigint;
  numberOfPeriod: number;
  padding: number[];
}
export interface DammV2Position {
  pool: PublicKey;
  nftMint: PublicKey;
  feeAPerTokenCheckpoint: number[];
  feeBPerTokenCheckpoint: number[];
  feeAPending: bigint;
  feeBPending: bigint;
  unlockedLiquidity: bigint;
  vestedLiquidity: bigint;
  permanentLockedLiquidity: bigint;
  metrics: DammV2PositionMetrics;
  rewardInfos: DammV2UserRewardInfo[];
  innerVesting: DammV2InnerVesting;
  delegatePermission: number;
  padding: number[];
}
export interface DammV2DynamicFeeConfig {
  initialized: number;
  padding: number[];
  maxVolatilityAccumulator: number;
  variableFeeControl: number;
  binStep: number;
  filterPeriod: number;
  decayPeriod: number;
  reductionFactor: number;
  padding1: number[];
  binStepU128: bigint;
}
export interface DammV2PoolFeesConfig {
  baseFee: DammV2BaseFeeInfo;
  dynamicFee: DammV2DynamicFeeConfig;
  protocolFeePercent: number;
  padding0: number;
  referralFeePercent: number;
  padding1: number[];
  compoundingFeeBps: number;
  padding2: bigint[];
}
export interface DammV2Config {
  vaultConfigKey: PublicKey;
  poolCreatorAuthority: PublicKey;
  poolFees: DammV2PoolFeesConfig;
  activationType: number;
  collectFeeMode: number;
  configType: number;
  Padding0: number[];
  index: bigint;
  sqrtMinPrice: bigint;
  sqrtMaxPrice: bigint;
  permission: bigint;
  Padding1: bigint[];
}
