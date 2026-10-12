import { webDeployment } from "./deployment";
import type { Buffer } from "buffer";
import {
  ACCOUNT_SIZES,
  FEED_RULES,
  PAUSE_BITS,
  WSOL_MINT,
  XRAY,
} from "@onepercent/config";
import {
  checkPumpOrigin,
  extensionTypes,
  mintIsSafe,
} from "@onepercent/eligibility";
import {
  binderPda,
  bondingCurvePda,
  configPda,
  decodeBinder,
  decodeConfig,
  decodeMachine,
  decodeMintLedger,
  EXTERNAL_IDS,
  ledgerPda,
  machinePda,
  PHASE,
  SIZES,
  TOKEN_2022_NATIVE_MINT,
  userAta,
  vaultAta,
  vaultAuthPda,
  type MintLedger,
} from "@onepercent/sdk/browser";
import {
  getTransferFeeAmount,
  unpackAccount,
  unpackMint,
  type Account,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js";

export type FeedChainRpc = Pick<
  Connection,
  | "getMultipleAccountsInfoAndContext"
  | "getTokenAccountsByOwner"
  | "getMinimumBalanceForRentExemption"
  | "getBlockTime"
>;

export function rpcLamports(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid RPC lamports");
  return BigInt(value);
}

export function uninitializedAccount(info: AccountInfo<Buffer> | null) {
  return (
    info === null ||
    (info.owner.equals(SystemProgram.programId) &&
      !info.executable &&
      info.data.length === 0)
  );
}

function programData(info: AccountInfo<Buffer>, size?: number) {
  if (
    !info.owner.equals(webDeployment().programId) ||
    info.executable ||
    (size !== undefined && info.data.length !== size)
  )
    throw new Error("Unexpected program account");
  return info.data;
}

/** Chain accounts, including a donated but uninitialized Binder, are authoritative. */
export async function readFeedCore(rpc: FeedChainRpc, wallet: PublicKey) {
  const result = await rpc.getMultipleAccountsInfoAndContext(
    [
      configPda(webDeployment().programId)[0],
      machinePda(webDeployment().programId)[0],
      binderPda(webDeployment().programId, wallet)[0],
    ],
    { commitment: "confirmed" },
  );
  const [configInfo, machineInfo, binderInfo] = result.value;
  if (!configInfo && !machineInfo) return null;
  if (!configInfo || !machineInfo || binderInfo === undefined)
    throw new Error("Incomplete machine accounts");
  const config = decodeConfig(programData(configInfo, SIZES.config));
  const machine = decodeMachine(programData(machineInfo, SIZES.machine));
  const binder = uninitializedAccount(binderInfo)
    ? null
    : decodeBinder(programData(binderInfo!));
  if (
    config.version !== 1 ||
    config.bump !== configPda(webDeployment().programId)[1] ||
    machine.version !== 1 ||
    machine.bump !== machinePda(webDeployment().programId)[1] ||
    (binder &&
      (!binder.owner.equals(wallet) ||
        binder.bump !== binderPda(webDeployment().programId, wallet)[1]))
  )
    throw new Error("Invalid machine account identity");
  const blockTime = await rpc.getBlockTime(result.context.slot);
  if (blockTime === null || !Number.isSafeInteger(blockTime) || blockTime < 0)
    throw new Error("Cluster time unavailable");
  return {
    config,
    machine,
    binder,
    binderLamports: rpcLamports(binderInfo?.lamports ?? 0),
    slot: result.context.slot,
    blockTime,
  };
}
export type FeedCore = NonNullable<Awaited<ReturnType<typeof readFeedCore>>>;

export function feedIsOpen(core: FeedCore) {
  return (
    core.config.season_set === 1 &&
    [PHASE.stockUp, PHASE.poweredOn, PHASE.onAir].some(
      (phase) => phase === core.machine.phase,
    ) &&
    ((core.config.admin_paused | core.config.guardian_paused) &
      PAUSE_BITS.feed) ===
      0 &&
    (core.machine.end_ts === 0n || BigInt(core.blockTime) < core.machine.end_ts)
  );
}

export interface ChainTokenAccount extends Account {
  tokenProgram: PublicKey;
  lamports: bigint;
  closable: boolean;
}

export interface ChainBag {
  mint: PublicKey;
  amount: bigint;
  decimals: number | null;
  tokenProgram: PublicKey;
  canonicalAta: PublicKey;
  source: PublicKey;
  sourceExists: boolean;
  accounts: ChainTokenAccount[];
  /** Hard checks only. Snapshot provenance is finalized by the intake signer. */
  feedable: boolean;
  reasonCode: string | null;
  vaultExists: boolean;
  vaultLamports: bigint;
  ledger: MintLedger | null;
  ledgerLamports: bigint;
}

const raw = (address: PublicKey, info: AccountInfo<Buffer>) => ({
  address: address.toBase58(),
  owner: info.owner.toBase58(),
  lamports: rpcLamports(info.lamports),
  data: info.data,
});

/** Never collapse a malformed token account into a zero balance. */
export async function readWalletInventory(
  rpc: FeedChainRpc,
  wallet: PublicKey,
  options: { minContextSlot?: number; tokenMint?: PublicKey } = {},
) {
  let slot = options.minContextSlot ?? 0;
  const tokenAccounts: ChainTokenAccount[] = [];
  const seen = new Set<string>();
  const unreadableMints = new Set<string>();
  for (const tokenProgram of [EXTERNAL_IDS.splToken, EXTERNAL_IDS.token2022]) {
    const result = await rpc.getTokenAccountsByOwner(
      wallet,
      { programId: tokenProgram },
      { commitment: "confirmed", minContextSlot: slot },
    );
    if (result.context.slot < slot) throw new Error("Stale token account read");
    slot = result.context.slot;
    if (tokenAccounts.length + result.value.length > XRAY.maxTokenAccounts)
      throw new Error("Wallet has too many token accounts");
    for (const { pubkey, account: info } of result.value) {
      if (seen.has(pubkey.toBase58()))
        throw new Error("Duplicate token account");
      seen.add(pubkey.toBase58());
      if (!info.owner.equals(tokenProgram) || info.executable)
        throw new Error("Invalid token account owner");
      const account = unpackAccount(pubkey, info, tokenProgram);
      if (!account.owner.equals(wallet))
        throw new Error("Unexpected token owner");
      let extensionsReadable = true;
      try {
        extensionTypes(account.tlvData);
      } catch {
        extensionsReadable = false;
        unreadableMints.add(account.mint.toBase58());
      }
      const withheld = extensionsReadable
        ? (getTransferFeeAmount(account)?.withheldAmount ?? 0n)
        : null;
      tokenAccounts.push({
        ...account,
        tokenProgram,
        lamports: rpcLamports(info.lamports),
        closable:
          account.isInitialized &&
          !account.isFrozen &&
          withheld === 0n &&
          (!account.closeAuthority || account.closeAuthority.equals(wallet)),
      });
    }
  }
  const grouped = new Map<string, ChainTokenAccount[]>();
  for (const account of tokenAccounts) {
    const name = account.mint.toBase58();
    const group = grouped.get(name) ?? [];
    group.push(account);
    grouped.set(name, group);
  }
  const groups = [...grouped.values()].filter((group) =>
    group.some((account) => account.amount > 0n),
  );
  const addresses = groups.flatMap((group) => {
    const { mint, tokenProgram } = group[0]!;
    return [
      mint,
      bondingCurvePda(mint)[0],
      ledgerPda(webDeployment().programId, mint)[0],
      vaultAta(webDeployment().programId, mint, tokenProgram),
    ];
  });
  const infos = new Map<string, AccountInfo<Buffer> | null>();
  for (
    let start = 0;
    start < addresses.length;
    start += XRAY.accountsPerBatch
  ) {
    const batch = addresses.slice(start, start + XRAY.accountsPerBatch);
    const result = await rpc.getMultipleAccountsInfoAndContext(batch, {
      commitment: "confirmed",
      minContextSlot: slot,
    });
    if (result.context.slot < slot || result.value.length !== batch.length)
      throw new Error("Incomplete bag accounts");
    slot = result.context.slot;
    batch.forEach((key, index) =>
      infos.set(key.toBase58(), result.value[index]!),
    );
  }
  const bags = groups.map((accounts): ChainBag => {
    const { mint, tokenProgram } = accounts[0]!;
    const mintInfo = infos.get(mint.toBase58());
    const curve = bondingCurvePda(mint)[0];
    const curveInfo = infos.get(curve.toBase58());
    const ledgerInfo =
      infos.get(ledgerPda(webDeployment().programId, mint)[0].toBase58()) ??
      null;
    const vault = vaultAta(webDeployment().programId, mint, tokenProgram);
    const vaultInfo = infos.get(vault.toBase58()) ?? null;
    const canonicalAta = userAta(wallet, mint, tokenProgram);
    const safety =
      mintInfo && !mintInfo.executable ? mintIsSafe(raw(mint, mintInfo)) : null;
    let decimals: number | null = safety?.ok ? safety.decimals : null;
    if (mintInfo && !mintInfo.executable && decimals === null) {
      try {
        decimals = unpackMint(mint, mintInfo, tokenProgram).decimals;
      } catch {
        // Unsafe rows remain visible without fabricating an amount scale.
      }
    }
    const amount = accounts.reduce((sum, account) => sum + account.amount, 0n);
    let reasonCode: string | null = null;
    if (!mintInfo) reasonCode = "mint_missing";
    else if (!mintInfo.owner.equals(tokenProgram))
      reasonCode = "unknown_program";
    else if (!safety?.ok) reasonCode = safety?.code ?? "mint_unparseable";
    else if (
      mint.toBase58() === WSOL_MINT ||
      mint.equals(TOKEN_2022_NATIVE_MINT) ||
      mint.equals(options.tokenMint ?? PublicKey.default)
    )
      reasonCode = "excluded";
    else if (
      !curveInfo ||
      curveInfo.executable ||
      !checkPumpOrigin(mint, raw(curve, curveInfo))
    )
      reasonCode = "not_pump_fun";
    else if (
      unreadableMints.has(mint.toBase58()) ||
      accounts.some(
        (account) =>
          !account.isInitialized ||
          account.isFrozen ||
          !account.tokenProgram.equals(tokenProgram) ||
          !account.closable,
      )
    )
      reasonCode = "token_extensions";
    const ledger = uninitializedAccount(ledgerInfo)
      ? null
      : decodeMintLedger(programData(ledgerInfo!, ACCOUNT_SIZES.mintLedger));
    if (ledger && !ledger.mint.equals(mint))
      throw new Error("Unexpected MintLedger mint");
    const vaultExists = !uninitializedAccount(vaultInfo);
    if (vaultExists) {
      if (vaultInfo!.executable) throw new Error("Unexpected vault account");
      const account = unpackAccount(vault, vaultInfo!, tokenProgram);
      if (
        !account.mint.equals(mint) ||
        !account.owner.equals(vaultAuthPda(webDeployment().programId)[0])
      )
        throw new Error("Unexpected vault identity");
    }
    return {
      mint,
      amount,
      decimals,
      tokenProgram,
      canonicalAta,
      source: canonicalAta,
      sourceExists: accounts.some((account) =>
        account.address.equals(canonicalAta),
      ),
      accounts,
      feedable: reasonCode === null,
      reasonCode,
      vaultExists,
      vaultLamports: rpcLamports(vaultInfo?.lamports ?? 0),
      ledger,
      ledgerLamports: rpcLamports(ledgerInfo?.lamports ?? 0),
    };
  });
  return {
    slot,
    bags,
    emptyAccounts: tokenAccounts.filter(
      (account) => account.amount === 0n && account.closable,
    ),
  };
}

export async function readFeedRent(
  rpc: Pick<Connection, "getMinimumBalanceForRentExemption">,
) {
  const rent = async (size: number) =>
    rpcLamports(await rpc.getMinimumBalanceForRentExemption(size, "confirmed"));
  // Inventory can read concurrently. Keep this lane sequential so foreground
  // preparation respects the public proxy's two-request per-IP capacity.
  const empty = await rent(0);
  const entry = await rent(ACCOUNT_SIZES.deckEntry);
  const binder = await rent(ACCOUNT_SIZES.binderHeader);
  const mintLedger = await rent(ACCOUNT_SIZES.mintLedger);
  const vaultSpl = await rent(ACCOUNT_SIZES.vaultSpl);
  const vaultToken2022 = await rent(ACCOUNT_SIZES.vaultToken2022);
  if (entry < empty) throw new Error("Invalid rent schedule");
  return {
    deckEntry: entry - empty,
    binder,
    mintLedger,
    vaultSpl,
    vaultToken2022,
  };
}
export type FeedRent = Awaited<ReturnType<typeof readFeedRent>>;
const remaining = (rent: bigint, current: bigint) =>
  rent > current ? rent - current : 0n;

export function feedDepositCost(
  bags: readonly ChainBag[],
  binderExists: boolean,
  rent: FeedRent,
  binderLamports = 0n,
) {
  const binder =
    !binderExists && bags.length ? remaining(rent.binder, binderLamports) : 0n;
  const entries = rent.deckEntry * BigInt(bags.length);
  let vaults = 0n,
    ledgers = 0n,
    mergeAtas = 0n;
  for (const bag of bags) {
    const ataRent = bag.tokenProgram.equals(EXTERNAL_IDS.token2022)
      ? rent.vaultToken2022
      : rent.vaultSpl;
    if (!bag.ledger) ledgers += remaining(rent.mintLedger, bag.ledgerLamports);
    if (!bag.vaultExists) vaults += remaining(ataRent, bag.vaultLamports);
    if (!bag.sourceExists) mergeAtas += ataRent;
  }
  return {
    binder,
    entries,
    vaults,
    ledgers,
    mergeAtas,
    total: binder + entries + vaults + ledgers,
  };
}

export const freshFeedRoom = (core: FeedCore) =>
  Math.max(0, FEED_RULES.freshCapPerWallet - (core.binder?.fresh_in_deck ?? 0));
