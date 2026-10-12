import { createHash } from "node:crypto";
import {
  ACCOUNT_SIZES,
  PROGRAM_IDS,
  SEASON,
  TOKEN_1PCT,
} from "@onepercent/config";
import {
  DBC_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  dbcPool,
  decodeDbcConfig,
  decodeDbcPool,
  dbcConfigMismatches,
} from "@onepercent/sdk";
import {
  AddressLookupTableAccount,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

export interface AccountSnapshot {
  owner: PublicKey;
  data: Uint8Array;
  lamports: bigint;
  executable?: boolean;
}
export interface LaunchCheck {
  id: string;
  status: "GO" | "WARN" | "NO-GO";
  detail: string;
  value?: unknown;
}
export class LaunchCheckError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "LaunchCheckError";
  }
}
const requireCheck = (condition: boolean, code: string) => {
  if (!condition) throw new LaunchCheckError(code);
};
const key = (data: Buffer, offset: number) =>
  new PublicKey(data.subarray(offset, offset + 32));
const accountDiscriminator = (name: string) =>
  createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
const pda = (programId: PublicKey, ...seeds: Uint8Array[]) =>
  PublicKey.findProgramAddressSync(seeds, programId)[0];
const namedPda = (name: string, programId: PublicKey) =>
  pda(programId, Buffer.from(name));
const tokenProgram = new PublicKey(PROGRAM_IDS.splToken);
const nonzero = (value: PublicKey) => !value.equals(PublicKey.default);

/** Empty non-executable System accounts remain available, including donations. */
export function classifyLaunchAccount(
  account: AccountSnapshot | null,
  expectedOwner: PublicKey,
): "absent" | "expected" | "foreign" {
  if (
    account === null ||
    (account.owner.equals(SystemProgram.programId) &&
      account.data.length === 0 &&
      !account.executable)
  )
    return "absent";
  return account.owner.equals(expectedOwner) ? "expected" : "foreign";
}
export function classifyLaunchMintAccount(
  account: AccountSnapshot | null,
): "absent" | "token-mint" | "foreign" {
  const state = classifyLaunchAccount(account, tokenProgram);
  return state === "expected" ? "token-mint" : state;
}
export function classifyLaunchPoolAccount(
  account: AccountSnapshot | null,
): "absent" | "dbc-pool" | "foreign" {
  const state = classifyLaunchAccount(account, DBC_PROGRAM_ID);
  return state === "expected" ? "dbc-pool" : state;
}

function programAccount(
  account: AccountSnapshot | null,
  programId: PublicKey,
  name: string,
  size: number,
): Buffer {
  requireCheck(account !== null, `${name}_missing`);
  const value = account!;
  requireCheck(
    value.owner.equals(programId) && !value.executable,
    `${name}_owner`,
  );
  const data = Buffer.from(value.data);
  requireCheck(
    data.length === size &&
      data.subarray(0, 8).equals(accountDiscriminator(name)),
    `${name}_layout`,
  );
  return data;
}

// SWITCH: M1 layouts plus M4 §5.1's token_mint field at 2,608. Replace these
// launch-only decoders with the M4.1 SDK once its runtime-program-id API ships.
export function decodeLaunchConfig(
  account: AccountSnapshot | null,
  programId: PublicKey,
) {
  const data = programAccount(account, programId, "Config", 872);
  requireCheck(data[736] === 1, "Config_version");
  requireCheck(data[738]! < 4, "Config_active_queue");
  return {
    admin: key(data, 8),
    guardians: [key(data, 40), key(data, 72)],
    keeper: key(data, 104),
    executor: key(data, 136),
    intakeSigner: key(data, 168),
    quoteSigner: key(data, 200),
    launchWallet: key(data, 232),
    teamWallet: key(data, 264),
    teamWallets: Array.from({ length: 8 }, (_, index) =>
      key(data, 296 + index * 32),
    ),
    tokenMint: key(data, 552),
    vrfQueues: Array.from({ length: 4 }, (_, index) =>
      key(data, 584 + index * 32),
    ),
    snapshotSlot: data.readBigUInt64LE(712),
    stockUpTs: data.readBigInt64LE(728),
    seasonSet: data[739]!,
    activeQueue: data[738]!,
  };
}

export function decodeLaunchMachine(
  account: AccountSnapshot | null,
  programId: PublicKey,
) {
  const data = programAccount(account, programId, "Machine", 3_808);
  requireCheck(data[8] === 1, "Machine_version");
  return {
    phase: data[10]!,
    pendingPulls: data.readBigUInt64LE(24),
    powerOnTs: data.readBigInt64LE(40),
    onAirTs: data.readBigInt64LE(48),
    endTs: data.readBigInt64LE(56),
    onePct: Array.from({ length: TOKEN_1PCT.onePctCardCount }, (_, index) => ({
      amount: data.readBigUInt64LE(2_336 + index * 16),
      state: data[2_344 + index * 16]!,
    })),
    tokenMint: key(data, 2_608),
    buckets: Array.from({ length: 16 }, (_, index) => {
      const start = 224 + index * 128;
      return {
        mint: key(data, start),
        class: data[start + 109]!,
        tokenProgram: data[start + 111]!,
      };
    }),
  };
}

export function decodeLaunchLedger(
  account: AccountSnapshot | null,
  programId: PublicKey,
) {
  const data = programAccount(
    account,
    programId,
    "MintLedger",
    ACCOUNT_SIZES.mintLedger,
  );
  return {
    mint: key(data, 8),
    payer: key(data, 40),
    accounted: data.readBigUInt64LE(72),
  };
}

/** D29 uses the canonical, immutable SPL Token mint layout.
 * The linked DBC pool/config proves initial supply; current supply can fall by burns.
 */
export function checkLaunchMint(account: AccountSnapshot | null) {
  requireCheck(account !== null, "mint_missing");
  requireCheck(
    account!.owner.equals(tokenProgram) && !account!.executable,
    "mint_token_program",
  );
  const data = Buffer.from(account!.data);
  requireCheck(data.length === 82, "mint_layout");
  requireCheck(
    data.readUInt32LE(0) === 0 && data.readUInt32LE(46) === 0,
    "mint_authorities",
  );
  requireCheck(
    data[45] === 1 && data[44] === TOKEN_1PCT.decimals,
    "mint_decimals_or_initialization",
  );
  requireCheck(
    data.readBigUInt64LE(36) <= TOKEN_1PCT.totalSupply,
    "mint_supply",
  );
  return {
    decimals: data[44]!,
    supply: data.readBigUInt64LE(36).toString(),
    tokenProgram: tokenProgram.toBase58(),
    mintAuthority: null,
    freezeAuthority: null,
  };
}

export function checkDbcLaunchConfig(
  account: AccountSnapshot | null,
  input: {
    feeIn: PublicKey;
    migrationQuoteThreshold?: bigint;
    cluster?: string;
  },
) {
  requireCheck(account !== null, "dbc_config_missing");
  requireCheck(
    account!.owner.equals(DBC_PROGRAM_ID) && !account!.executable,
    "dbc_config_owner",
  );
  const config = decodeDbcConfig(account!.data);
  const mismatches = dbcConfigMismatches(
    config,
    input.feeIn,
    input.migrationQuoteThreshold,
    input.cluster,
  );
  requireCheck(
    mismatches.length === 0,
    `dbc_config_fields:${mismatches.join(",")}`,
  );
  return config;
}

export function checkLaunchPool(
  account: AccountSnapshot | null,
  input: {
    cluster?: string;
    mint: PublicKey;
    feeIn: PublicKey;
    dbcConfig: PublicKey;
    dbcConfigAccount: AccountSnapshot | null;
    migrationQuoteThreshold?: bigint;
    requirePartnerFees?: boolean;
    expectedPartnerFee?: bigint;
  },
) {
  requireCheck(account !== null, "pool_missing");
  requireCheck(
    account!.owner.equals(DBC_PROGRAM_ID) && !account!.executable,
    "pool_owner",
  );
  const config = checkDbcLaunchConfig(input.dbcConfigAccount, input);
  const pool = decodeDbcPool(account!.data);
  requireCheck(pool.baseMint.equals(input.mint), "pool_base_mint");
  requireCheck(pool.config.equals(input.dbcConfig), "pool_config");
  requireCheck(
    pool.creatorQuoteFee === 0n && pool.creatorBaseFee === 0n,
    "pool_creator_fees",
  );
  requireCheck(
    pool.partnerBaseFee === 0n && pool.protocolBaseFee === 0n,
    "pool_base_fees",
  );
  if (input.requirePartnerFees)
    requireCheck(pool.partnerQuoteFee > 0n, "pool_partner_fees_missing");
  if (input.expectedPartnerFee !== undefined)
    requireCheck(
      pool.partnerQuoteFee === input.expectedPartnerFee,
      "pool_partner_fee_quote_mismatch",
    );
  return {
    address: dbcPool(input.dbcConfig, input.mint).toBase58(),
    config: pool.config.toBase58(),
    baseMint: pool.baseMint.toBase58(),
    initialSupply: config.preMigrationTokenSupply.toString(),
    feeClaimer: config.feeClaimer.toBase58(),
    partnerQuoteFee: pool.partnerQuoteFee.toString(),
    creatorQuoteFee: pool.creatorQuoteFee.toString(),
  };
}

export function checkLaunchTokenAccount(
  account: AccountSnapshot | null,
  mint: PublicKey,
  authority: PublicKey,
) {
  requireCheck(account !== null, "token_account_missing");
  requireCheck(
    account!.owner.equals(tokenProgram) && !account!.executable,
    "token_account_program",
  );
  const data = Buffer.from(account!.data);
  requireCheck(
    data.length === 165 && data[108] === 1,
    "token_account_layout_or_state",
  );
  requireCheck(
    key(data, 0).equals(mint) && key(data, 32).equals(authority),
    "token_account_identity",
  );
  return data.readBigUInt64LE(64);
}

export function checkLaunchLookupTable(input: {
  table: AddressLookupTableAccount | null;
  expectedAddresses: readonly PublicKey[];
  currentSlot: number;
}) {
  const { table, expectedAddresses, currentSlot } = input;
  requireCheck(table !== null, "lookup_table_missing");
  requireCheck(
    table!.isActive() && table!.state.authority === undefined,
    "lookup_table_inactive_or_mutable",
  );
  requireCheck(
    Number.isSafeInteger(currentSlot) &&
      currentSlot > table!.state.lastExtendedSlot,
    "lookup_table_not_warmed",
  );
  const actual = table!.state.addresses.map((address) => address.toBase58());
  const expected = expectedAddresses.map((address) => address.toBase58());
  // Ordering is part of the compiled v0 message. Do not silently accept a set
  // whose indices disagree with the table used to construct the transaction.
  requireCheck(
    expected.length > 0 &&
      new Set(actual).size === actual.length &&
      actual.length === expected.length &&
      actual.every((address, index) => address === expected[index]),
    "lookup_table_addresses",
  );
  return {
    address: table!.key.toBase58(),
    active: true,
    authority: null,
    lastExtendedSlot: table!.state.lastExtendedSlot,
    observedSlot: currentSlot,
    addresses: actual,
  };
}

function checked(id: string, fn: () => unknown, detail: string): LaunchCheck {
  try {
    return { id, status: "GO", detail, value: fn() };
  } catch (error) {
    return {
      id,
      status: "NO-GO",
      detail:
        error instanceof LaunchCheckError
          ? error.code
          : "invalid_observed_account",
    };
  }
}

export function checkLaunchPrerequisites(input: {
  cluster?: string;
  programId: PublicKey;
  mint: PublicKey;
  launchWallet: PublicKey;
  config: AccountSnapshot | null;
  machine: AccountSnapshot | null;
  mintAccount: AccountSnapshot | null;
  poolAccount: AccountSnapshot | null;
  dbcConfigAccount: AccountSnapshot | null;
  expectedDbcConfig: PublicKey;
  migrationQuoteThreshold?: bigint;
  feeIn: AccountSnapshot | null;
  rentMinimumLamports: bigint;
  lookupTable: AddressLookupTableAccount | null;
  expectedLookupAddresses: readonly PublicKey[];
  currentSlot: number;
}): LaunchCheck[] {
  return [
    checked(
      "3.config",
      () => {
        const config = decodeLaunchConfig(input.config, input.programId);
        requireCheck(
          nonzero(config.tokenMint) &&
            config.tokenMint.equals(input.mint) &&
            nonzero(config.launchWallet) &&
            config.launchWallet.equals(input.launchWallet),
          "config_launch_identity",
        );
        const mintState = classifyLaunchMintAccount(input.mintAccount);
        requireCheck(mintState !== "foreign", "mint_foreign_account");
        requireCheck(mintState === "absent", "mint_already_exists");
        return {
          mint: config.tokenMint.toBase58(),
          launchWallet: config.launchWallet.toBase58(),
          mintExists: false,
          prefundedLamports: (input.mintAccount?.lamports ?? 0n).toString(),
        };
      },
      "Config identities match the two signers; mint address is available for DBC initialization.",
    ),
    checked(
      "3.pool",
      () => {
        const state = classifyLaunchPoolAccount(input.poolAccount);
        requireCheck(state !== "foreign", "pool_foreign_account");
        requireCheck(state === "absent", "pool_already_exists");
        return {
          address: dbcPool(input.expectedDbcConfig, input.mint).toBase58(),
          prefundedLamports: (input.poolAccount?.lamports ?? 0n).toString(),
        };
      },
      "Pool address is available for DBC initialization.",
    ),
    checked(
      "3.dbc_config",
      () => {
        const config = checkDbcLaunchConfig(input.dbcConfigAccount, {
          feeIn: namedPda("fee_in", input.programId),
          migrationQuoteThreshold: input.migrationQuoteThreshold,
          cluster: input.cluster,
        });
        return {
          address: input.expectedDbcConfig.toBase58(),
          feeClaimer: config.feeClaimer.toBase58(),
        };
      },
      "DBC config matches every D29 field and the selected curve threshold.",
    ),
    checked(
      "4.machine",
      () => {
        const machine = decodeLaunchMachine(input.machine, input.programId);
        requireCheck(
          machine.phase === 1 && machine.powerOnTs === 0n,
          "machine_not_stock_up",
        );
        return { phase: "StockUp", powerOnTs: "0" };
      },
      "Machine is StockUp and has never powered on.",
    ),
    checked(
      "4.fee_in",
      () => {
        const account = input.feeIn;
        requireCheck(
          account !== null &&
            account.owner.equals(SystemProgram.programId) &&
            account.data.length === 0 &&
            !account.executable,
          "fee_in_account",
        );
        requireCheck(
          input.rentMinimumLamports >= 0n &&
            account!.lamports >= input.rentMinimumLamports,
          "fee_in_below_rent",
        );
        return {
          lamports: account!.lamports.toString(),
          rentMinimumLamports: input.rentMinimumLamports.toString(),
        };
      },
      "FeeIn is a System account funded at current rent or above.",
    ),
    checked(
      "5.lookup_table",
      () =>
        checkLaunchLookupTable({
          table: input.lookupTable,
          expectedAddresses: input.expectedLookupAddresses,
          currentSlot: input.currentSlot,
        }),
      "Lookup table is active, frozen, warmed and exact.",
    ),
  ];
}

export function checkLaunchSimulation(input: {
  cluster?: string;
  err: unknown;
  expectedPartnerFee?: bigint;
  mint: AccountSnapshot | null;
  pool: AccountSnapshot | null;
  dbcConfigAccount: AccountSnapshot | null;
  expectedDbcConfig: PublicKey;
  migrationQuoteThreshold?: bigint;
  vault: AccountSnapshot | null;
  launchTokenAccount: AccountSnapshot | null;
  expectedMint: PublicKey;
  feeIn: PublicKey;
  vaultAuthority: PublicKey;
}): LaunchCheck[] {
  if (input.err !== null)
    return [
      {
        id: "6.simulation",
        status: "NO-GO",
        detail: "launch_simulation_failed",
        value: input.err,
      },
    ];
  return [
    {
      id: "6.simulation",
      status: "GO",
      detail: "Launch simulation succeeded.",
    },
    checked(
      "6.mint",
      () => checkLaunchMint(input.mint),
      "Simulated mint is immutable SPL Token with supply at most the configured initial supply.",
    ),
    checked(
      "6.pool",
      () =>
        checkLaunchPool(input.pool, {
          mint: input.expectedMint,
          feeIn: input.feeIn,
          dbcConfig: input.expectedDbcConfig,
          dbcConfigAccount: input.dbcConfigAccount,
          migrationQuoteThreshold: input.migrationQuoteThreshold,
          cluster: input.cluster,
          requirePartnerFees: true,
          expectedPartnerFee: input.expectedPartnerFee,
        }),
      "Simulated DBC pool accrues partner fees to FeeIn and no creator fees.",
    ),
    checked(
      "6.vault",
      () => {
        const amount = checkLaunchTokenAccount(
          input.vault,
          input.expectedMint,
          input.vaultAuthority,
        );
        requireCheck(
          amount === TOKEN_1PCT.devBuyAmount,
          "simulated_vault_amount",
        );
        return { amount: amount.toString() };
      },
      "Simulated vault holds exactly the dev buy.",
    ),
    checked(
      "6.launch_account",
      () => {
        requireCheck(
          input.launchTokenAccount === null ||
            (input.launchTokenAccount.owner.equals(SystemProgram.programId) &&
              input.launchTokenAccount.data.length === 0 &&
              !input.launchTokenAccount.executable &&
              input.launchTokenAccount.lamports === 0n),
          "simulated_launch_account_not_closed",
        );
        return { closed: true, amount: "0" };
      },
      "Simulated launch token account is closed.",
    ),
  ];
}

export function checkRehearsalMint(
  account: AccountSnapshot | null,
  evidence: { cluster: string; mint: PublicKey; observedSlot: number },
): LaunchCheck {
  return checked(
    "8.rehearsal_mint",
    () => {
      const mint = checkLaunchMint(account);
      // This legacy mint-only check has no linked DBC evidence of initial supply.
      requireCheck(
        mint.supply === TOKEN_1PCT.totalSupply.toString(),
        "rehearsal_initial_supply_unproven",
      );
      return { ...mint, ...evidence, mint: evidence.mint.toBase58() };
    },
    "Rehearsal mint is immutable SPL Token; D18 uses the recorded rehearsal.",
  );
}

export interface LaunchProgramVersion {
  programId: string;
  deploySlot: number;
  executableHash?: string;
}
const launchProgramIds = [
  DBC_PROGRAM_ID.toBase58(),
  DAMM_V2_PROGRAM_ID.toBase58(),
];
export function checkLaunchProgramVersions(
  observed: readonly LaunchProgramVersion[],
  baseline: readonly LaunchProgramVersion[],
): LaunchCheck {
  const ids = new Set(observed.map((version) => version.programId));
  const complete =
    observed.length === 2 &&
    baseline.length === 2 &&
    ids.size === 2 &&
    launchProgramIds.every((id) => ids.has(id)) &&
    new Set(baseline.map((version) => version.programId)).size === 2 &&
    baseline.every((before) => ids.has(before.programId));
  if (!complete)
    return {
      id: "1.meteora_programs",
      status: "NO-GO",
      detail: "two_meteora_program_versions_required",
    };
  const changes = observed.filter((after) => {
    const before = baseline.find(
      (value) => value.programId === after.programId,
    )!;
    return (
      before.deploySlot !== after.deploySlot ||
      (before.executableHash !== undefined &&
        before.executableHash !== after.executableHash)
    );
  });
  return {
    id: "1.meteora_programs",
    status: changes.length ? "WARN" : "GO",
    detail: changes.length
      ? "Meteora versions changed: re-run simulation, record the new versions and obtain the founder's rehearsal decision."
      : "Meteora versions match the recorded baseline.",
    value: { observed, changes },
  };
}

const ata = (owner: PublicKey, mint: PublicKey, program: PublicKey) =>
  pda(
    new PublicKey(PROGRAM_IDS.associatedToken),
    owner.toBuffer(),
    program.toBuffer(),
    mint.toBuffer(),
  );
export function buildLaunchReport(input: {
  cluster: string;
  programId: PublicKey;
  observedSlot: number;
  config: AccountSnapshot | null;
  machine: AccountSnapshot | null;
  ledger: AccountSnapshot | null;
  mint: AccountSnapshot | null;
  pool: AccountSnapshot | null;
  dbcConfigAccount: AccountSnapshot | null;
  expectedDbcConfig: PublicKey;
  migrationQuoteThreshold?: bigint;
  vault: AccountSnapshot | null;
  launchTokenAccounts: readonly AccountSnapshot[];
  launchLookupTable?: PublicKey;
  protocolLookupTable?: PublicKey;
  landedForm: "single-v0" | "proxima-separate";
  signatures: readonly string[];
  programVersions?: readonly LaunchProgramVersion[];
  launchSimulation?: boolean;
}) {
  const config = decodeLaunchConfig(input.config, input.programId);
  const machine = decodeLaunchMachine(input.machine, input.programId);
  const ledger = decodeLaunchLedger(input.ledger, input.programId);
  const mint = config.tokenMint;
  const feeIn = namedPda("fee_in", input.programId);
  const vaultAuthority = namedPda("vault_auth", input.programId);
  const checks: LaunchCheck[] = [
    checked(
      "report.phase",
      () => {
        requireCheck(
          machine.phase === 2 ||
            (!input.launchSimulation && machine.phase === 3),
          "report_not_powered_on",
        );
        requireCheck(
          machine.tokenMint.equals(mint) && nonzero(mint),
          "report_machine_mint",
        );
        return {
          phase: machine.phase === 2 ? "PoweredOn" : "OnAir",
          tokenMint: mint.toBase58(),
        };
      },
      "Machine is powered on for the configured mint.",
    ),
    checked(
      "report.ledger",
      () => {
        requireCheck(
          ledger.mint.equals(mint) && ledger.payer.equals(config.launchWallet),
          "report_ledger_identity",
        );
        requireCheck(
          ledger.accounted === TOKEN_1PCT.devBuyAmount,
          "report_ledger_amount",
        );
        return { accounted: ledger.accounted.toString() };
      },
      "Ledger accounts for exactly the dev buy.",
    ),
    checked(
      "report.vault",
      () => {
        const amount = checkLaunchTokenAccount(
          input.vault,
          mint,
          vaultAuthority,
        );
        requireCheck(amount >= TOKEN_1PCT.devBuyAmount, "report_vault_amount");
        return {
          amount: amount.toString(),
          unaccounted: (amount - ledger.accounted).toString(),
        };
      },
      "Vault covers the dev buy; any donated excess remains unaccounted.",
    ),
    checked(
      "report.one_pct",
      () => {
        requireCheck(
          machine.onePct.every(
            (slot, index) =>
              (slot.state === 0 ||
                (!input.launchSimulation && index === 0 && slot.state === 1)) &&
              slot.amount === TOKEN_1PCT.onePctCardAmount,
          ),
          "report_one_pct_slots",
        );
        return machine.onePct.map((slot) => ({
          amount: slot.amount.toString(),
          state: slot.state === 0 ? "Locked" : "Live",
        }));
      },
      input.launchSimulation
        ? "All four The 1% slots are Locked at their configured amounts."
        : "All four The 1% slots retain their configured amounts; only slot 0 may be Live.",
    ),
    checked(
      "report.timestamps",
      () => {
        requireCheck(
          machine.powerOnTs > 0n &&
            machine.onAirTs ===
              machine.powerOnTs + BigInt(SEASON.onAirDelaySeconds) &&
            machine.endTs === machine.onAirTs + BigInt(SEASON.durationSeconds),
          "report_timestamps",
        );
        return {
          powerOnTs: machine.powerOnTs.toString(),
          onAirTs: machine.onAirTs.toString(),
          endTs: machine.endTs.toString(),
          onePctReleaseTs: TOKEN_1PCT.onePctReleaseOffsetsSeconds.map(
            (offset) => (machine.onAirTs + BigInt(offset)).toString(),
          ),
        };
      },
      "Season clocks derive from the observed Power-On timestamp.",
    ),
    checked(
      "report.launch_wallet",
      () => {
        const amount = input.launchTokenAccounts.reduce(
          (total, account) =>
            total + checkLaunchTokenAccount(account, mint, config.launchWallet),
          0n,
        );
        if (input.launchSimulation)
          requireCheck(amount === 0n, "report_launch_wallet_tokens");
        return {
          amount: amount.toString(),
          tokenAccounts: input.launchTokenAccounts.length,
        };
      },
      input.launchSimulation
        ? "Simulated launch wallet holds zero of the configured token."
        : "Remaining tokens stay with the launch wallet; the ledger and vault prove the dev buy allocation.",
    ),
    checked(
      "report.mint",
      () => checkLaunchMint(input.mint),
      "Landed mint retains null authorities and supply no greater than the initial DBC supply.",
    ),
    checked(
      "report.pool",
      () =>
        checkLaunchPool(input.pool, {
          mint,
          feeIn,
          dbcConfig: input.expectedDbcConfig,
          dbcConfigAccount: input.dbcConfigAccount,
          migrationQuoteThreshold: input.migrationQuoteThreshold,
          cluster: input.cluster,
        }),
      "Landed DBC pool binds the mint to its initial supply, immutable metadata policy and FeeIn partner.",
    ),
  ];
  const publicKey = (value: PublicKey) => value.toBase58();
  return {
    version: 1,
    cluster: input.cluster,
    observedSlot: input.observedSlot,
    ok: checks.every((check) => check.status === "GO"),
    landedForm: input.landedForm,
    signatures: input.signatures,
    checks,
    programVersions: input.programVersions ?? [],
    addresses: {
      program: publicKey(input.programId),
      programData: publicKey(
        pda(
          new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
          input.programId.toBuffer(),
        ),
      ),
      config: publicKey(namedPda("config", input.programId)),
      machine: publicKey(namedPda("machine", input.programId)),
      deck: publicKey(namedPda("deck", input.programId)),
      vaultAuthority: publicKey(vaultAuthority),
      feeIn: publicKey(feeIn),
      ledger: publicKey(
        pda(input.programId, Buffer.from("ledger"), mint.toBuffer()),
      ),
      tokenMint: publicKey(mint),
      tokenVault: publicKey(ata(vaultAuthority, mint, tokenProgram)),
      dbcConfig: publicKey(input.expectedDbcConfig),
      launchPool: publicKey(dbcPool(input.expectedDbcConfig, mint)),
      launchWallet: publicKey(config.launchWallet),
      launchTokenAccount: publicKey(
        ata(config.launchWallet, mint, tokenProgram),
      ),
      launchLookupTable: input.launchLookupTable?.toBase58() ?? null,
      protocolLookupTable: input.protocolLookupTable?.toBase58() ?? null,
      admin: publicKey(config.admin),
      guardians: config.guardians.map(publicKey),
      keeper: publicKey(config.keeper),
      executor: publicKey(config.executor),
      intakeSigner: publicKey(config.intakeSigner),
      quoteSigner: publicKey(config.quoteSigner),
      teamWallet: publicKey(config.teamWallet),
      teamWallets: config.teamWallets.filter(nonzero).map(publicKey),
      vrfQueues: config.vrfQueues.filter(nonzero).map(publicKey),
      stockVaults: machine.buckets
        .filter((bucket) => bucket.class !== 0)
        .map((bucket) => {
          requireCheck(
            bucket.tokenProgram === 0 || bucket.tokenProgram === 1,
            "report_bucket_token_program",
          );
          return {
            mint: publicKey(bucket.mint),
            vault: publicKey(
              ata(
                vaultAuthority,
                bucket.mint,
                new PublicKey(
                  bucket.tokenProgram === 0
                    ? PROGRAM_IDS.splToken
                    : PROGRAM_IDS.token2022,
                ),
              ),
            ),
          };
        }),
    },
  };
}
