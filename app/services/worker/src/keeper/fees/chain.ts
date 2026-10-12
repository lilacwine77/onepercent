import {
  Keypair,
  PublicKey,
  SystemProgram,
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  type Signer,
  type VersionedTransaction,
} from "@solana/web3.js";
import { z } from "zod";
import { WSOL_MINT, type ProgramCluster } from "@onepercent/config";
import { EXTERNAL_IDS } from "@onepercent/sdk/constants";
import { machineLayout } from "@onepercent/sdk/layouts";
import {
  createDeploymentSelector,
  type ClusterDeployment,
  dbcPoolPda,
  feeInPda,
  machinePda,
  userAta,
  decodeDbcFeePool,
  decodeDbcFeeConfig,
  decodeDammFeePool,
  decodeDammFeePosition,
  dammLaunchPoolPda,
  meteoraPda,
  feeChainInstructions,
  migrationDammV2Ix,
  type FeeChainInput,
} from "@onepercent/sdk";
import type { JsonRpcClient } from "@onepercent/service-kit";

import {
  readMigrationPosition,
  type MigrationPosition,
} from "./migration-position.js";

const integer = z.number().int().nonnegative().safe();
const accountSchema = z.object({
  owner: z.string(),
  executable: z.boolean(),
  lamports: integer,
  data: z.tuple([z.string(), z.literal("base64")]),
});
type Account = z.infer<typeof accountSchema>;
function data(account: Account | null | undefined, owner: PublicKey): Buffer {
  if (!account || account.executable || account.owner !== owner.toBase58())
    throw new Error("fee_account_owner_mismatch");
  const bytes = Buffer.from(account.data[0], "base64");
  if (bytes.toString("base64") !== account.data[0])
    throw new Error("fee_account_invalid_data");
  return bytes;
}
function amount(
  account: Account | null | undefined,
  mint: PublicKey,
  owner: PublicKey,
  program = EXTERNAL_IDS.splToken,
): bigint {
  if (
    !account ||
    (account.owner === SystemProgram.programId.toBase58() &&
      account.data[0] === "")
  )
    return 0n;
  const bytes = data(account, program);
  if (
    bytes.length < 165 ||
    !new PublicKey(bytes.subarray(0, 32)).equals(mint) ||
    !new PublicKey(bytes.subarray(32, 64)).equals(owner)
  )
    throw new Error("fee_token_account_mismatch");
  return bytes.readBigUInt64LE(64);
}
export interface FeeSnapshot {
  season: string;
  phase: number;
  onAirTs: bigint;
  endTs: bigint;
  migrated: boolean;
  migrationDue: boolean;
  surplusClaimed: boolean;
  waiting: boolean;
  baseFees: bigint;
  reserveFingerprint: string;
  input: FeeChainInput;
}
export class FeeChainReader {
  private readonly deployment: ClusterDeployment;
  private ephemeral: Signer | undefined;
  private readonly migrationPositions = new Map<string, MigrationPosition>();
  constructor(
    private readonly options: {
      rpc: JsonRpcClient;
      programId: PublicKey;
      payer: PublicKey;
      cluster: ProgramCluster;
      lookupTable?: string;
    },
  ) {
    this.deployment = createDeploymentSelector({
      [options.cluster]: options.programId,
    })(options.cluster);
  }
  private async accounts(
    addresses: readonly PublicKey[],
    commitment: "confirmed" | "finalized",
    signal?: AbortSignal,
  ) {
    const response = await this.options.rpc.request(
      "getMultipleAccounts",
      [
        addresses.map((key) => key.toBase58()),
        { commitment, encoding: "base64" },
      ],
      z.object({
        context: z.object({ slot: integer }),
        value: z.array(accountSchema.nullable()),
      }),
      signal,
    );
    if (response.value.length !== addresses.length)
      throw new Error("fee_accounts_length");
    return response;
  }
  async lookupTables(signal?: AbortSignal) {
    const address = this.options.lookupTable;
    if (!address) return [];
    const key = new PublicKey(address);
    const { value } = await this.accounts([key], "confirmed", signal);
    const table = new AddressLookupTableAccount({
      key,
      state: AddressLookupTableAccount.deserialize(
        data(value[0], AddressLookupTableProgram.programId),
      ),
    });
    if (!table.isActive() || table.state.authority)
      throw new Error("fee_lookup_table_not_frozen");
    return [table];
  }
  async read(
    commitment: "confirmed" | "finalized",
    signal?: AbortSignal,
  ): Promise<FeeSnapshot | null> {
    const { rpc, payer } = this.options;
    const machineAccount = (
      await this.accounts(
        [machinePda(this.deployment.programId)[0]],
        commitment,
        signal,
      )
    ).value[0];
    const machine = machineLayout.decode(
      data(machineAccount, this.deployment.programId),
    );
    if (machine.exec.kind !== 0) throw new Error("ExecInFlight");
    if (machine.phase < 2 || machine.token_mint.equals(PublicKey.default))
      return null;
    const configKey = new PublicKey(this.deployment.meteora.dbcConfig);
    const mint = machine.token_mint;
    const curveKey = dbcPoolPda(mint, configKey)[0];
    const feeIn = feeInPda(this.deployment.programId)[0];
    const quoteMint = new PublicKey(WSOL_MINT);
    const { value } = await this.accounts(
      [
        curveKey,
        configKey,
        feeIn,
        userAta(feeIn, quoteMint, EXTERNAL_IDS.splToken),
        userAta(feeIn, mint, EXTERNAL_IDS.splToken),
      ],
      commitment,
      signal,
    );
    const curve = decodeDbcFeePool(data(value[0], EXTERNAL_IDS.meteoraDbc));
    const config = decodeDbcFeeConfig(data(value[1], EXTERNAL_IDS.meteoraDbc));
    if (
      !curve.config.equals(configKey) ||
      !curve.baseMint.equals(mint) ||
      !config.feeClaimer.equals(feeIn) ||
      !config.quoteMint.equals(quoteMint) ||
      config.creatorTradingFeePercentage !== 0 ||
      config.collectFeeMode !== 0 ||
      config.partnerLockedPercent !== 100
    )
      throw new Error("fee_in_creator_changed");
    if (
      value[2] &&
      (value[2].owner !== SystemProgram.programId.toBase58() ||
        value[2].executable ||
        value[2].data[0] !== "")
    )
      throw new Error("fee_in_account_mismatch");
    const rent = BigInt(
      await rpc.request(
        "getMinimumBalanceForRentExemption",
        [0, { commitment }],
        integer,
        signal,
      ),
    );
    const feeInLamports = BigInt(value[2]?.lamports ?? 0);
    const common = {
      payer,
      mint,
      baseVault: curve.baseVault,
      quoteVault: curve.quoteVault,
    };
    let input: FeeChainInput = {
      deployment: this.deployment,
      claim: { ...common, kind: "curve" },
      feeInLamports,
      feeInRentMinimum: rent,
    };
    let waiting = curve.quoteFee > 0n;
    let baseFees = curve.baseFee + amount(value[4], mint, feeIn);
    let reserveFingerprint = `curve:${curve.baseReserve}:${curve.quoteReserve}`;
    if (curve.migrated) {
      const poolKey = dammLaunchPoolPda(mint);
      const poolAccount = (await this.accounts([poolKey], commitment, signal))
        .value[0];
      const pool = decodeDammFeePool(
        data(poolAccount, EXTERNAL_IDS.meteoraDammV2),
      );
      if (
        !pool.baseMint.equals(mint) ||
        !pool.quoteMint.equals(quoteMint) ||
        pool.collectFeeMode !== 1
      )
        throw new Error("fee_in_creator_changed");
      let canonical = this.migrationPositions.get(poolKey.toBase58());
      if (!canonical) {
        canonical = await readMigrationPosition(
          rpc,
          poolKey,
          curveKey,
          configKey,
          signal,
        );
        this.migrationPositions.set(poolKey.toBase58(), canonical);
      }
      const positionAccounts = (
        await this.accounts(
          [canonical.address, canonical.nft],
          commitment,
          signal,
        )
      ).value;
      const decoded = decodeDammFeePosition(
        data(positionAccounts[0], EXTERNAL_IDS.meteoraDammV2),
      );
      if (
        !decoded.pool.equals(poolKey) ||
        !decoded.nftMint.equals(canonical.mint) ||
        !meteoraPda(EXTERNAL_IDS.meteoraDammV2, "position", [
          decoded.nftMint,
        ]).equals(canonical.address) ||
        !meteoraPda(EXTERNAL_IDS.meteoraDammV2, "position_nft_account", [
          decoded.nftMint,
        ]).equals(canonical.nft)
      )
        throw new Error("fee_position_identity");
      const nftAccount = positionAccounts[1];
      const nftBytes = data(nftAccount, EXTERNAL_IDS.token2022);
      if (
        nftBytes.length < 165 ||
        !new PublicKey(nftBytes.subarray(32, 64)).equals(feeIn)
      )
        throw new Error("fee_in_creator_changed");
      if (
        amount(nftAccount, decoded.nftMint, feeIn, EXTERNAL_IDS.token2022) !==
        1n
      )
        throw new Error("fee_position_nft_amount");
      const position = { ...canonical, position: decoded };
      input = {
        ...input,
        claim: {
          ...common,
          kind: "pool",
          pool: poolKey,
          baseVault: pool.baseVault,
          quoteVault: pool.quoteVault,
          position: position.address,
          positionNftAccount: position.nft,
        },
        ...(!curve.surplusClaimed
          ? { surplus: { ...common, kind: "surplus" } as const }
          : {}),
      };
      waiting =
        position.position.pendingB > 0n ||
        !position.position.checkpointB.equals(pool.feeB) ||
        !curve.surplusClaimed;
      if (
        position.position.pendingA > 0n ||
        !position.position.checkpointA.equals(pool.feeA)
      )
        baseFees += position.position.pendingA || 1n;
      // Token vault balances include all changes on older pool layouts too.
      const vaults = (
        await this.accounts(
          [pool.baseVault, pool.quoteVault],
          commitment,
          signal,
        )
      ).value;
      const authority = meteoraPda(
        EXTERNAL_IDS.meteoraDammV2,
        "pool_authority",
      );
      reserveFingerprint = `pool:${amount(vaults[0], mint, authority)}:${amount(vaults[1], quoteMint, authority)}`;
    }
    waiting ||=
      feeInLamports > rent ||
      amount(value[3], quoteMint, feeIn) > 0n ||
      feeInLamports < rent;
    return {
      season: machine.power_on_ts.toString(),
      phase: machine.phase,
      onAirTs: machine.on_air_ts,
      endTs: machine.end_ts,
      migrated: curve.migrated,
      migrationDue:
        !curve.migrated && curve.quoteReserve >= config.migrationThreshold,
      surplusClaimed: curve.surplusClaimed,
      waiting,
      baseFees,
      reserveFingerprint,
      input,
    };
  }
  collection(snapshot: FeeSnapshot, withAdvancePhase = false) {
    return feeChainInstructions({ ...snapshot.input, withAdvancePhase });
  }
  migration(snapshot: FeeSnapshot) {
    this.clearEphemeral();
    const generated = Keypair.generate();
    // Keypair.secretKey returns a copy. Keep the actual signing buffer so cleanup
    // clears the retained bytes, rather than clearing another temporary copy.
    this.ephemeral = {
      publicKey: generated.publicKey,
      secretKey: generated.secretKey,
    };
    const input = snapshot.input.claim;
    if (input.kind !== "curve") throw new Error("migration_state_changed");
    const dbcConfig = new PublicKey(this.deployment.meteora.dbcConfig);
    return [
      migrationDammV2Ix({
        ...input,
        dbcConfig,
        curve: dbcPoolPda(input.mint, dbcConfig)[0],
        positionMint: this.ephemeral.publicKey,
      }),
    ];
  }
  signAuxiliary(transaction: VersionedTransaction) {
    const required = transaction.message.staticAccountKeys
      .slice(0, transaction.message.header.numRequiredSignatures)
      .filter((key) => !key.equals(this.options.payer));
    if (required.length === 0) return;
    if (
      required.length !== 1 ||
      !this.ephemeral ||
      !required[0]!.equals(this.ephemeral.publicKey)
    )
      throw new Error("fee_auxiliary_signer_missing");
    transaction.sign([this.ephemeral]);
    this.clearEphemeral();
  }
  clearEphemeral() {
    this.ephemeral?.secretKey.fill(0);
    this.ephemeral = undefined;
  }
}
