import { TOKEN_1PCT } from "@onepercent/config";
import {
  decodeDbcPool,
  launchAddresses,
  type LaunchIdentity,
} from "@onepercent/sdk";
import { PublicKey } from "@solana/web3.js";
import {
  checkDbcLaunchConfig,
  checkLaunchMint,
  checkLaunchPool,
  checkLaunchTokenAccount,
  classifyLaunchMintAccount,
  classifyLaunchPoolAccount,
  decodeLaunchConfig,
  decodeLaunchLedger,
  decodeLaunchMachine,
  LaunchCheckError,
  type AccountSnapshot,
} from "./checks.js";

export interface ProximaState {
  config: AccountSnapshot | null;
  machine: AccountSnapshot | null;
  mint: AccountSnapshot | null;
  pool: AccountSnapshot | null;
  dbc: AccountSnapshot | null;
  vault: AccountSnapshot | null;
  ledger: AccountSnapshot | null;
  launchAta: AccountSnapshot | null;
  launchTokens: readonly AccountSnapshot[];
  now: bigint;
}
export type ProximaStage =
  | "set-mint"
  | "stock-up"
  | "awaiting-proxima"
  | "deposit"
  | "power-on"
  | "powered-on";
const requireState = (ok: boolean, code: string) => {
  if (!ok) throw new LaunchCheckError(code);
};

/** The pool is always fetched at its canonical PDA; no caller supplies a pool override. */
export function checkProximaState(
  identity: LaunchIdentity,
  state: ProximaState,
  migrationQuoteThreshold?: bigint,
  poolCreator?: PublicKey,
) {
  const a = launchAddresses(identity);
  const config = decodeLaunchConfig(state.config, a.programId);
  const machine = decodeLaunchMachine(state.machine, a.programId);
  requireState(
    !identity.mint.equals(PublicKey.default),
    "proxima_mint_required",
  );
  requireState(
    config.launchWallet.equals(identity.wallet),
    "proxima_launch_wallet_mismatch",
  );
  requireState(
    !poolCreator?.equals(identity.wallet),
    "proxima_pool_creator_is_launch_wallet",
  );
  const dbc = checkDbcLaunchConfig(state.dbc, {
    feeIn: a.feeIn,
    cluster: identity.deployment.cluster,
    migrationQuoteThreshold,
  });
  const mintState = classifyLaunchMintAccount(state.mint);
  const poolState = classifyLaunchPoolAccount(state.pool);
  requireState(
    mintState !== "foreign" && poolState !== "foreign",
    "proxima_foreign_mint_or_pool",
  );
  requireState(
    (mintState === "absent") === (poolState === "absent"),
    "proxima_partial_external_launch",
  );
  const registered = config.tokenMint.equals(identity.mint);
  const common = {
    mint: identity.mint.toBase58(),
    launchWallet: identity.wallet.toBase58(),
    ...(poolCreator ? { poolCreator: poolCreator.toBase58() } : {}),
    admin: config.admin.toBase58(),
    pool: a.launchPool.toBase58(),
    dbcConfig: a.dbcConfig.toBase58(),
    feeClaimer: dbc.feeClaimer.toBase58(),
    requiredAmount: TOKEN_1PCT.devBuyAmount.toString(),
    launchVerified: mintState !== "absent",
  };
  const verifyLaunch = () => {
    checkLaunchMint(state.mint);
    checkLaunchPool(state.pool, {
      mint: identity.mint,
      feeIn: a.feeIn,
      dbcConfig: a.dbcConfig,
      dbcConfigAccount: state.dbc,
      cluster: identity.deployment.cluster,
      migrationQuoteThreshold,
    });
    const pool = decodeDbcPool(state.pool!.data);
    requireState(
      pool.creator.equals(poolCreator ?? identity.wallet),
      "proxima_pool_creator_mismatch",
    );
  };
  if (machine.phase === 0) {
    if (mintState !== "absent") {
      requireState(Boolean(poolCreator), "proxima_mint_exists_before_stock_up");
      verifyLaunch();
    }
    return {
      ...common,
      stage: (registered ? "stock-up" : "set-mint") as ProximaStage,
      seasonReady: config.seasonSet === 1 && state.now >= config.stockUpTs,
      stockUpTs: config.stockUpTs.toString(),
    };
  }
  requireState(registered, "proxima_registered_mint_mismatch");
  requireState(
    machine.phase >= 1 && machine.phase <= 3,
    "proxima_phase_invalid",
  );
  if (mintState === "absent") {
    requireState(
      machine.phase === 1 && machine.powerOnTs === 0n,
      "proxima_machine_already_powered",
    );
    return { ...common, stage: "awaiting-proxima" as ProximaStage };
  }
  verifyLaunch();
  const walletAmount = state.launchTokens.reduce(
    (sum, account) =>
      sum + checkLaunchTokenAccount(account, identity.mint, identity.wallet),
    0n,
  );
  const ataAmount = state.launchAta
    ? checkLaunchTokenAccount(state.launchAta, identity.mint, identity.wallet)
    : 0n;
  const vaultAmount = state.vault
    ? checkLaunchTokenAccount(state.vault, identity.mint, a.vaultAuth)
    : 0n;
  const ledger = state.ledger
    ? decodeLaunchLedger(state.ledger, a.programId)
    : null;
  if (ledger)
    requireState(
      ledger.mint.equals(identity.mint) && ledger.payer.equals(identity.wallet),
      "proxima_ledger_identity",
    );
  const balances = {
    walletAmount: walletAmount.toString(),
    vaultAmount: vaultAmount.toString(),
    accounted: (ledger?.accounted ?? 0n).toString(),
    unaccountedSurplus: (vaultAmount > TOKEN_1PCT.devBuyAmount
      ? vaultAmount - TOKEN_1PCT.devBuyAmount
      : 0n
    ).toString(),
  };
  if (machine.phase >= 2) {
    requireState(
      machine.tokenMint.equals(identity.mint) && machine.powerOnTs > 0n,
      "proxima_machine_identity",
    );
    requireState(
      ledger?.accounted === TOKEN_1PCT.devBuyAmount &&
        vaultAmount >= TOKEN_1PCT.devBuyAmount,
      "proxima_powered_amounts",
    );
    return { ...common, ...balances, stage: "powered-on" as ProximaStage };
  }
  requireState(
    machine.powerOnTs === 0n && (ledger?.accounted ?? 0n) === 0n,
    "proxima_already_accounted",
  );
  // A funded vault is authoritative on retries, even if the launch wallet received
  // more tokens after depositing. Wallet surplus never triggers another transfer.
  if (vaultAmount >= TOKEN_1PCT.devBuyAmount)
    return { ...common, ...balances, stage: "power-on" as ProximaStage };
  requireState(
    ataAmount >= TOKEN_1PCT.devBuyAmount,
    "proxima_dev_buy_amount_or_account",
  );
  return {
    ...common,
    ...balances,
    unaccountedSurplus: vaultAmount.toString(),
    stage: "deposit" as ProximaStage,
  };
}
