import { warnCause } from "@onepercent/service-kit";
import {
  PublicKey,
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { z } from "zod";
import {
  SOLANA_GENESIS_HASHES as GENESIS,
  WSOL_MINT,
} from "@onepercent/config";
import {
  configLayout,
  machineLayout,
  type ClusterDeployment,
  ledgerPda,
  vaultAta,
  configPda,
  machinePda,
  EXTERNAL_IDS,
  userAta,
  dbcPoolPda,
  decodeDbcFeePool,
  decodeDbcFeeConfig,
  dammLaunchPoolPda,
  decodeDammFeePool,
  feeInPda,
  parseOnepercentLogs,
} from "@onepercent/sdk";
import { type ExecReadings, readMeteora } from "@onepercent/sdk/server";
import type { JsonRpcClient, RuntimeEnv } from "@onepercent/service-kit";
import type { ExecutorSnapshot, ExecutorReference } from "./policy.js";
const accountSchema = z.object({
  owner: z.string(),
  executable: z.boolean(),
  lamports: z.number().int().nonnegative().safe(),
  data: z.tuple([z.string(), z.literal("base64")]),
});
const tokenBalanceSchema = z.object({
  accountIndex: z.number().int().nonnegative().safe(),
  mint: z.string(),
  owner: z.string().optional(),
  programId: z.string().optional(),
  uiTokenAmount: z.object({ amount: z.string().regex(/^\d+$/) }),
});
export type ExecutorAccount = {
  address: PublicKey;
  owner: PublicKey;
  executable: boolean;
  data: Buffer;
  slot: number;
  lamports: bigint;
};
export function assertExecutorGenesis(
  cluster: RuntimeEnv["CLUSTER"],
  endpoint: string,
  genesis: string,
): void {
  if (cluster === "devnet" && genesis === GENESIS.devnet) return;
  if (cluster === "mainnet-beta" && genesis === GENESIS.mainnet) return;
  if (
    cluster === "localnet" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(endpoint).hostname) &&
    genesis !== GENESIS.mainnet &&
    genesis !== GENESIS.devnet
  )
    return;
  throw new Error("executor_genesis_mismatch");
}

export class ExecutorSource {
  constructor(
    private readonly rpc: JsonRpcClient,
    readonly deployment: ClusterDeployment,
  ) {}
  async assertCluster(endpoint: string, signal?: AbortSignal): Promise<void> {
    const genesis = await this.rpc.request(
      "getGenesisHash",
      [],
      z.string().min(1),
      signal,
    );
    assertExecutorGenesis(
      this.deployment.cluster === "mainnet"
        ? "mainnet-beta"
        : this.deployment.cluster,
      endpoint,
      genesis,
    );
  }
  async account(
    address: PublicKey,
    commitment: "confirmed" | "finalized" = "confirmed",
    signal?: AbortSignal,
  ): Promise<ExecutorAccount> {
    const result = await this.rpc.request(
      "getAccountInfo",
      [address.toBase58(), { encoding: "base64", commitment }],
      z.object({
        context: z.object({ slot: z.number().int().nonnegative().safe() }),
        value: accountSchema.nullable(),
      }),
      signal,
    );
    if (!result.value) throw new Error("executor_account_missing");
    return {
      address,
      owner: new PublicKey(result.value.owner),
      executable: result.value.executable,
      data: Buffer.from(result.value.data[0], "base64"),
      slot: result.context.slot,
      lamports: BigInt(result.value.lamports),
    };
  }
  private async accounts(
    addresses: readonly PublicKey[],
    commitment: "confirmed" | "finalized",
    signal?: AbortSignal,
  ): Promise<ExecutorAccount[]> {
    const result = await this.rpc.request(
      "getMultipleAccounts",
      [
        addresses.map((key) => key.toBase58()),
        { encoding: "base64", commitment },
      ],
      z.object({
        context: z.object({ slot: z.number().int().nonnegative().safe() }),
        value: z.array(accountSchema.nullable()),
      }),
      signal,
    );
    if (result.value.length !== addresses.length)
      throw new Error("executor_account_count");
    return result.value.map((value, index) => ({
      address: addresses[index]!,
      owner: new PublicKey(value?.owner ?? SystemProgram.programId),
      executable: value?.executable ?? false,
      data: Buffer.from(value?.data[0] ?? "", "base64"),
      slot: result.context.slot,
      lamports: BigInt(value?.lamports ?? 0),
    }));
  }
  private state(accounts: readonly ExecutorAccount[]): ExecutorSnapshot {
    const [configAccount, machineAccount, clock] = accounts;
    const programId = this.deployment.programId;
    if (
      !configAccount ||
      !machineAccount ||
      !clock ||
      configAccount.executable ||
      machineAccount.executable ||
      clock.executable ||
      !configAccount.owner.equals(programId) ||
      !machineAccount.owner.equals(programId) ||
      clock.owner.toBase58() !==
        "Sysvar1111111111111111111111111111111111111" ||
      clock.data.length !== 40
    )
      throw new Error("executor_account_owner");
    const config = configLayout.decode(configAccount.data);
    const machine = machineLayout.decode(machineAccount.data);
    if (
      config.bump !== configPda(programId)[1] ||
      machine.bump !== machinePda(programId)[1]
    )
      throw new Error("executor_account_binding");
    return {
      deployment: this.deployment,
      config,
      machine,
      now: clock.data.readBigInt64LE(32),
      slot: clock.slot,
    };
  }
  async snapshot(
    commitment: "confirmed" | "finalized" = "confirmed",
    signal?: AbortSignal,
  ): Promise<ExecutorSnapshot> {
    return this.state(
      await this.accounts(
        [
          configPda(this.deployment.programId)[0],
          machinePda(this.deployment.programId)[0],
          SYSVAR_CLOCK_PUBKEY,
        ],
        commitment,
        signal,
      ),
    );
  }
  async reference(
    initial: ExecutorSnapshot,
    signal?: AbortSignal,
  ): Promise<{ snapshot: ExecutorSnapshot; reference: ExecutorReference }> {
    const programId = this.deployment.programId;
    const mint = initial.config.token_mint;
    const signer = initial.config.executor;
    const dbcConfig = new PublicKey(this.deployment.meteora.dbcConfig);
    const curveKey = dbcPoolPda(mint, dbcConfig)[0];
    const curveAccount = await this.account(curveKey, "confirmed", signal);
    if (
      !curveAccount.owner.equals(EXTERNAL_IDS.meteoraDbc) ||
      curveAccount.executable
    )
      throw new Error("executor_oracle_owner");
    const curve = decodeDbcFeePool(curveAccount.data);
    const poolKey = curve.migrated
      ? dammLaunchPoolPda(mint)
      : SystemProgram.programId;
    const venue = curve.migrated
      ? decodeDammFeePool(
          (await this.account(poolKey, "confirmed", signal)).data,
        )
      : curve;
    const keys = [
      configPda(programId)[0],
      machinePda(programId)[0],
      SYSVAR_CLOCK_PUBKEY,
      curveKey,
      poolKey,
      venue.baseVault,
      venue.quoteVault,
      mint,
      ledgerPda(programId, mint)[0],
      vaultAta(programId, mint, EXTERNAL_IDS.splToken),
      userAta(signer, new PublicKey(WSOL_MINT), EXTERNAL_IDS.splToken),
      dbcConfig,
    ];
    // Discovery only chooses addresses. State and all preflight evidence below
    // come from one bank snapshot, including both venue vaults on the curve.
    const accounts = await this.accounts(keys, "confirmed", signal);
    const snapshot = this.state(accounts);
    if (
      !snapshot.config.token_mint.equals(mint) ||
      !snapshot.config.executor.equals(signer)
    )
      throw new Error("executor_snapshot_changed");
    if (accounts.some((account, index) => index !== 4 && account.executable))
      throw new Error("executor_account_invalid");
    const configAccount = accounts[11]!;
    if (!configAccount.owner.equals(EXTERNAL_IDS.meteoraDbc))
      throw new Error("executor_oracle_owner");
    const config = decodeDbcFeeConfig(configAccount.data);
    if (
      !config.quoteMint.equals(new PublicKey(WSOL_MINT)) ||
      !config.feeClaimer.equals(feeInPda(programId)[0])
    )
      throw new Error("executor_oracle_binding");
    const oracles: ExecReadings["oracles"] = [
      accounts[3]!,
      accounts[4]!,
      accounts[5]!,
      accounts[6]!,
    ];
    const venueReading = readMeteora(oracles, mint, dbcConfig);
    const rent = async (size: number) =>
      BigInt(
        await this.rpc.request(
          "getMinimumBalanceForRentExemption",
          [size, { commitment: "confirmed" }],
          z.number().int().nonnegative().safe(),
          signal,
        ),
      );
    let src = accounts[10]!;
    if (
      src.lamports === 0n &&
      src.data.length === 0 &&
      src.owner.equals(SystemProgram.programId) &&
      !src.executable
    ) {
      // P1 prep creates this canonical native ATA before exec_begin. Model only
      // that deterministic zero-balance account; the full transaction is simulated.
      const data = Buffer.alloc(165);
      new PublicKey(WSOL_MINT).toBuffer().copy(data, 0);
      signer.toBuffer().copy(data, 32);
      data[108] = 1;
      data.writeUInt32LE(1, 109);
      const minimum = await rent(165);
      data.writeBigUInt64LE(minimum, 113);
      src = { ...src, owner: EXTERNAL_IDS.splToken, data, lamports: minimum };
    }
    return {
      snapshot,
      reference: {
        quoteReserve: venueReading.recordedQuote,
        sqrtPrice: venueReading.sqrtPrice,
        oracles: [
          oracles[0].address,
          oracles[1].address,
          oracles[2].address,
          oracles[3].address,
        ],
        readings: {
          mint: accounts[7]!,
          ledger: accounts[8]!,
          vault: accounts[9]!,
          src,
          solDest: {
            address: SystemProgram.programId,
            owner: SystemProgram.programId,
            data: Buffer.alloc(0),
          },
          oracles,
          machineLamports: accounts[1]!.lamports,
          machineRentMinimum: await rent(accounts[1]!.data.length),
        },
      },
    };
  }
  async lookupTable(
    address: PublicKey,
    signal?: AbortSignal,
  ): Promise<AddressLookupTableAccount> {
    const account = await this.account(address, "confirmed", signal);
    if (
      !account.owner.equals(AddressLookupTableProgram.programId) ||
      account.executable
    )
      throw new Error("executor_lut_invalid");
    const state = AddressLookupTableAccount.deserialize(account.data);
    if (state.deactivationSlot !== (1n << 64n) - 1n)
      throw new Error("executor_lut_deactivated");
    return new AddressLookupTableAccount({ key: address, state });
  }
  async receipt(signature: string, signer: PublicKey, signal?: AbortSignal) {
    const result = await this.rpc.request(
      "getTransaction",
      [
        signature,
        {
          encoding: "json",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        },
      ],
      z
        .object({
          transaction: z.object({
            signatures: z.array(z.string()),
            message: z.object({
              accountKeys: z.array(z.string()),
              instructions: z.array(
                z.object({
                  programIdIndex: z.number().int().nonnegative().safe(),
                  accounts: z.array(z.number().int().nonnegative().safe()),
                  data: z.string(),
                }),
              ),
            }),
          }),
          meta: z
            .object({
              err: z.unknown(),
              logMessages: z.array(z.string()).nullable(),
              loadedAddresses: z
                .object({
                  writable: z.array(z.string()),
                  readonly: z.array(z.string()),
                })
                .optional(),
              postTokenBalances: z
                .array(tokenBalanceSchema)
                .nullable()
                .optional(),
              preTokenBalances: z
                .array(tokenBalanceSchema)
                .nullable()
                .optional(),
            })
            .nullable(),
        })
        .nullable(),
      signal,
    );
    if (!result?.meta || result.meta.err !== null)
      throw new Error("executor_receipt_unavailable");
    if (
      result.transaction.signatures[0] !== signature ||
      result.transaction.message.accountKeys[0] !== signer.toBase58()
    )
      throw new Error("executor_receipt_binding");
    const keys = [
      ...result.transaction.message.accountKeys,
      ...(result.meta.loadedAddresses?.writable ?? []),
      ...(result.meta.loadedAddresses?.readonly ?? []),
    ];
    const source = userAta(
      signer,
      new PublicKey(WSOL_MINT),
      EXTERNAL_IDS.splToken,
    );
    const sourceBalance = (
      entries: z.infer<typeof tokenBalanceSchema>[] | null | undefined,
      mayBeAbsent: boolean,
    ) => {
      if (!entries) throw new Error("executor_residue_unavailable");
      const balances = entries.filter(
        (balance) => keys[balance.accountIndex] === source.toBase58(),
      );
      if (mayBeAbsent && balances.length === 0) return 0n;
      if (
        balances.length !== 1 ||
        balances[0]!.mint !== WSOL_MINT ||
        balances[0]!.owner !== signer.toBase58() ||
        balances[0]!.programId !== EXTERNAL_IDS.splToken.toBase58()
      )
        throw new Error("executor_residue_unavailable");
      return BigInt(balances[0]!.uiTokenAmount.amount);
    };
    const instructions = result.transaction.message.instructions;
    const begin = instructions.findIndex(
      (ix) => keys[ix.programIdIndex] === this.deployment.programId.toBase58(),
    );
    if (begin < 0) throw new Error("executor_receipt_binding");
    // SPL CloseAccount is the single byte 9, encoded as "A" in RPC JSON.
    // Previously signed plans may predate atomic resets: their historical
    // pre-balance is the baseline, never a balance read after confirmation.
    const reset = instructions
      .slice(0, begin)
      .some(
        (ix) =>
          keys[ix.programIdIndex] === EXTERNAL_IDS.splToken.toBase58() &&
          ix.data === "A" &&
          ix.accounts.length === 3 &&
          keys[ix.accounts[0]!] === source.toBase58() &&
          keys[ix.accounts[1]!] === signer.toBase58() &&
          keys[ix.accounts[2]!] === signer.toBase58(),
      );
    const baseline = reset
      ? 0n
      : sourceBalance(result.meta.preTokenBalances, true);
    const sourceResidue =
      sourceBalance(result.meta.postTokenBalances, false) - baseline;
    const parsed = parseOnepercentLogs({
      logs: result.meta.logMessages,
      err: result.meta.err,
      programId: this.deployment.programId.toBase58(),
    });
    if (parsed.truncated || parsed.malformed || parsed.unknownEvent)
      throw new Error("executor_receipt_unavailable");
    const events = parsed.events.filter((event) => event.name === "ExecEnded");
    if (events.length !== 1) throw new Error("executor_receipt_invalid");
    return {
      ...events[0]!.data,
      sourceResidue,
    };
  }
  async residue(signer: PublicKey, signal?: AbortSignal): Promise<bigint> {
    let account: ExecutorAccount;
    try {
      account = await this.account(
        userAta(signer, new PublicKey(WSOL_MINT), EXTERNAL_IDS.splToken),
        "confirmed",
        signal,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "executor_account_missing"
      ) {
        warnCause("executor_account_missing", error);
        return 0n;
      }
      throw error;
    }
    if (
      account.executable ||
      !account.owner.equals(EXTERNAL_IDS.splToken) ||
      account.data.length !== 165 ||
      !new PublicKey(account.data.subarray(0, 32)).equals(
        new PublicKey(WSOL_MINT),
      ) ||
      !new PublicKey(account.data.subarray(32, 64)).equals(signer) ||
      account.data[108] !== 1 ||
      account.data.readUInt32LE(109) !== 1
    )
      throw new Error("executor_residue_unavailable");
    return account.data.readBigUInt64LE(64);
  }
}
