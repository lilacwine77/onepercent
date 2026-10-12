import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import * as namespace from "@anchor-lang/core";
import { GOVERNANCE, METEORA_BY_CLUSTER, TX_LIMITS } from "@onepercent/config";
import { createDbcConfigIx, DBC_PROGRAM_ID } from "@onepercent/sdk";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import { z } from "zod";
import { OpsError } from "../input.js";
import {
  checkDbcLaunchConfig,
  decodeLaunchConfig,
  LaunchCheckError,
} from "./checks.js";
import type { AccountSnapshot } from "./checks.js";
import { migrationQuoteThreshold, selectLaunchDeployment } from "./input.js";
import type { LaunchInput } from "./input.js";
import { requireLaunchCluster, rebroadcastLaunchAttempt } from "./runtime.js";

import {
  devnetPriorityInstructions,
  DEVNET_RPC_PROFILE,
} from "./devnet-transport.js";

const anchor =
  (Reflect.get(namespace, "default") as typeof namespace | undefined) ??
  namespace;
const recordSchema = z.object({
  cluster: z.string(),
  program: z.string(),
  wallet: z.string(),
  config: z.string(),
  threshold: z.string().regex(/^\d+$/),
  signature: z.string(),
  encoded: z.string(),
  microLamports: z.string().regex(/^\d+$/).optional(),
  lastValidBlockHeight: z.number().int().nonnegative().safe(),
});

/** Immutable DBC configuration. Journal only public identities and signed bytes. */
export async function createLaunchDbcConfig(
  rpc: Connection,
  input: LaunchInput,
  wallet: Keypair,
  options: {
    directory: string;
    emit(record: Record<string, unknown>): void;
    configSigner?: Keypair;
  },
) {
  await requireLaunchCluster(rpc, input);
  if (
    input.cluster === "mainnet" &&
    [input.dbcConfig, options.configSigner?.publicKey.toBase58()].some(
      (address) =>
        address === METEORA_BY_CLUSTER.localnet.dbcConfig ||
        address === METEORA_BY_CLUSTER.devnet.dbcConfig,
    )
  )
    throw new OpsError("launch_config_test_signer_forbidden_on_mainnet");
  const deployment = selectLaunchDeployment(input);
  const programId = deployment.programId;
  const feeIn = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_in")],
    programId,
  )[0];
  const threshold = migrationQuoteThreshold(input);
  const payer = await rpc.getAccountInfo(wallet.publicKey, "finalized");
  if (
    !payer ||
    !payer.owner.equals(SystemProgram.programId) ||
    payer.executable ||
    payer.data.length !== 0
  )
    throw new OpsError("launch_config_payer_invalid");
  if (input.cluster === "mainnet") {
    const cap: unknown = Reflect.get(GOVERNANCE, "opsWalletMaxLamports");
    if (typeof cap !== "bigint" || cap <= 0n)
      throw new OpsError("ops_wallet_cap_unconfigured");
    if (!Number.isSafeInteger(payer.lamports) || BigInt(payer.lamports) > cap)
      throw new OpsError("ops_wallet_balance_cap_or_account");
    const configAddress = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      programId,
    )[0];
    const machineConfig = await rpc.getAccountInfo(configAddress, "finalized");
    const config = decodeLaunchConfig(
      machineConfig
        ? { ...machineConfig, lamports: BigInt(machineConfig.lamports) }
        : null,
      programId,
    );
    if (!config.teamWallets.some((key) => key.equals(wallet.publicKey)))
      throw new OpsError("launch_config_ops_wallet_not_published");
  }
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const path = join(
    options.directory,
    `dbc-config-${input.cluster}-${input.program}-${wallet.publicKey.toBase58()}.json`,
  );
  const lock = await open(`${path}.lock`, "wx", 0o600).catch(() => {
    throw new OpsError("launch_config_operation_locked");
  });
  try {
    let record: z.infer<typeof recordSchema> | null = null;
    try {
      record = recordSchema.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw new OpsError("launch_config_journal_invalid");
    }
    if (
      record &&
      (record.cluster !== input.cluster ||
        record.program !== input.program ||
        record.wallet !== wallet.publicKey.toBase58() ||
        record.threshold !== threshold.toString() ||
        (input.dbcConfig && input.dbcConfig !== record.config))
    )
      throw new OpsError("launch_config_journal_identity_mismatch");
    const configSigner = options.configSigner;
    const pin = deployment.meteoraConfigPin;
    const selected =
      record?.config ??
      input.dbcConfig ??
      configSigner?.publicKey.toBase58() ??
      pin ??
      undefined;
    if (!selected) throw new OpsError("launch_config_signer_unavailable");
    const address = new PublicKey(selected);
    if (configSigner && !configSigner.publicKey.equals(address))
      throw new OpsError("launch_config_signer_identity_mismatch");
    if (pin !== null && address.toBase58() !== pin)
      throw new OpsError("launch_config_cluster_pin_mismatch");
    if (
      input.cluster === "mainnet" &&
      (address.toBase58() === METEORA_BY_CLUSTER.localnet.dbcConfig ||
        address.toBase58() === METEORA_BY_CLUSTER.devnet.dbcConfig)
    )
      throw new OpsError("launch_config_test_signer_forbidden_on_mainnet");
    async function verify() {
      const account = await rpc.getAccountInfo(address, "finalized");
      if (!account) return null;
      const snapshot: AccountSnapshot = {
        ...account,
        lamports: BigInt(account.lamports),
      };
      if (!account.owner.equals(DBC_PROGRAM_ID) || account.executable)
        throw new OpsError("launch_dbc_config_owner");
      try {
        return checkDbcLaunchConfig(snapshot, {
          feeIn,
          migrationQuoteThreshold: threshold,
          cluster: input.cluster,
        });
      } catch (error) {
        throw new OpsError(
          error instanceof LaunchCheckError
            ? error.code
            : "launch_dbc_config_invalid",
        );
      }
    }
    const existing = await verify();
    if (existing)
      return {
        ok: true,
        config: address.toBase58(),
        feeIn: feeIn.toBase58(),
        migrationQuoteThreshold: threshold.toString(),
        verified: existing,
        reconciled: true,
      };
    if (!record) {
      if (!configSigner) throw new OpsError("launch_config_signer_unavailable");
      const blockhash = await rpc.getLatestBlockhash("confirmed");
      const creation = createDbcConfigIx({
        config: address,
        payer: wallet.publicKey,
        feeIn,
        migrationQuoteThreshold: threshold,
      });
      const priority =
        input.cluster === "devnet"
          ? await devnetPriorityInstructions(
              rpc,
              input.cluster,
              wallet.publicKey,
              [creation],
            )
          : null;
      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: wallet.publicKey,
          recentBlockhash: blockhash.blockhash,
          instructions: priority?.instructions ?? [creation],
        }).compileToV0Message(),
      );
      if (transaction.serialize().length > TX_LIMITS.maxTxBytes)
        throw new OpsError("launch_config_transaction_exceeds_packet_limit");
      const simulation = await rpc.simulateTransaction(transaction, {
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: "confirmed",
        accounts: { encoding: "base64", addresses: [address.toBase58()] },
      });
      if (simulation.value.err)
        throw new OpsError("launch_config_simulation_failed");
      // A successful creation can still write a protocol version outside our pin.
      // Verify the simulated post-state before committing the immutable account.
      const simulated = simulation.value.accounts?.[0];
      if (!simulated)
        throw new OpsError("launch_config_simulation_account_missing");
      try {
        checkDbcLaunchConfig(
          {
            owner: new PublicKey(simulated.owner),
            executable: simulated.executable,
            lamports: BigInt(simulated.lamports),
            data: Buffer.from(simulated.data[0]!, "base64"),
          },
          { feeIn, migrationQuoteThreshold: threshold, cluster: input.cluster },
        );
      } catch (error) {
        throw new OpsError(
          error instanceof LaunchCheckError
            ? error.code
            : "launch_config_simulation_account_invalid",
        );
      }
      await requireLaunchCluster(rpc, input);
      transaction.sign([wallet, configSigner]);
      record = {
        cluster: input.cluster,
        program: input.program,
        wallet: wallet.publicKey.toBase58(),
        config: address.toBase58(),
        threshold: threshold.toString(),
        signature: anchor.utils.bytes.bs58.encode(transaction.signatures[0]!),
        encoded: Buffer.from(transaction.serialize()).toString("base64"),
        ...(priority
          ? { microLamports: priority.microLamports.toString() }
          : {}),
        lastValidBlockHeight: blockhash.lastValidBlockHeight,
      };
      await writeFile(`${path}.new`, `${JSON.stringify(record, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      await rename(`${path}.new`, path);
    }
    options.emit({
      event: "launch_config_signed",
      config: address.toBase58(),
      signature: record.signature,
      journal: path,
    });
    // A restarted command only resubmits the persisted bytes. No replacement on uncertainty.
    const signed = VersionedTransaction.deserialize(
      Buffer.from(record.encoded, "base64"),
    );
    if (
      record.microLamports !== undefined &&
      (input.cluster !== "devnet" ||
        BigInt(record.microLamports) >
          DEVNET_RPC_PROFILE.maxComputeUnitPriceMicroLamports)
    )
      throw new OpsError("launch_config_journal_invalid");
    const expectedMessage = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: signed.message.recentBlockhash,
      instructions: [
        ...(record.microLamports === undefined
          ? []
          : [
              ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: BigInt(record.microLamports),
              }),
            ]),
        createDbcConfigIx({
          config: address,
          payer: wallet.publicKey,
          feeIn,
          migrationQuoteThreshold: threshold,
        }),
      ],
    }).compileToV0Message();
    if (
      !Buffer.from(signed.message.serialize()).equals(
        Buffer.from(expectedMessage.serialize()),
      ) ||
      !signed.message.staticAccountKeys[0]!.equals(wallet.publicKey) ||
      anchor.utils.bytes.bs58.encode(signed.signatures[0]!) !== record.signature
    )
      throw new OpsError("launch_config_journal_invalid");
    await rebroadcastLaunchAttempt(
      rpc,
      {
        form: "single",
        signatures: [record.signature],
        encodedTransactions: [record.encoded],
        lastValidBlockHeight: record.lastValidBlockHeight,
      },
      {
        assertCluster: () => requireLaunchCluster(rpc, input),
        submit: (encoded) =>
          rpc.sendRawTransaction(Buffer.from(encoded, "base64"), {
            skipPreflight: false,
            maxRetries: 0,
          }),
        sleep,
        emit: options.emit,
      },
    );
    // A finalized re-read is the success condition, not a transport acknowledgement.
    let status = (
      await rpc.getSignatureStatuses([record.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];
    while (status?.confirmationStatus !== "finalized") {
      if (status?.err) throw new OpsError("launch_config_transaction_failed");
      if ((await rpc.getBlockHeight("finalized")) > record.lastValidBlockHeight)
        throw new OpsError("launch_config_reconciliation_required");
      await sleep(2_000);
      status = (
        await rpc.getSignatureStatuses([record.signature], {
          searchTransactionHistory: true,
        })
      ).value[0];
    }
    if (status.err) throw new OpsError("launch_config_transaction_failed");
    const verified = await verify();
    if (!verified) throw new OpsError("launch_config_reconciliation_required");
    return {
      ok: true,
      config: address.toBase58(),
      feeIn: feeIn.toBase58(),
      migrationQuoteThreshold: threshold.toString(),
      signature: record.signature,
      verified,
    };
  } finally {
    await lock.close();
    await unlink(`${path}.lock`);
  }
}
