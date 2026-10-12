import { meteoraFixturePrograms } from "./e2e-meteora-fixtures.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  CU_LIMITS,
  STOCK,
  TOKEN_1PCT,
  WSOL_MINT,
} from "../packages/config/src/index.js";
import {
  advancePhaseInstruction,
  claimLaunchFeesIx,
  collectCreatorFeesIx,
  decodeOnepercentEvent,
  EXTERNAL_IDS,
  feeInPda,
  fetchMachine,
  machinePda,
  powerOnIx,
  userAta,
  vaultAta,
  vaultAuthPda,
} from "../packages/sdk/src/index.js";
import { JsonRpcClient } from "../packages/service-kit/src/rpc.js";
import { FeeChainReader } from "../services/worker/src/keeper/fees/chain.js";
import { DEPLOYMENT, PROGRAM_ID } from "../packages/sdk/tests/program-id.js";
import { meteoraLocalVenue } from "./e2e-meteora-fixtures.js";
import { meteoraTestConfig } from "./e2e-meteora-curve.js";

const wsol = new PublicKey(WSOL_MINT);
const dammConfig = new PublicKey(
  "A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck",
);
const writable = (pubkey: PublicKey, isSigner = false) => ({
  pubkey,
  isSigner,
  isWritable: true,
});
const readonly = (pubkey: PublicKey, isSigner = false) => ({
  pubkey,
  isSigner,
  isWritable: false,
});
const big = (value: unknown) => BigInt(String(value));
function consumedUnits(value: number | undefined, operation: string): number {
  assert(
    value !== undefined && Number.isSafeInteger(value) && value > 0,
    `${operation} requires a positive integer CU measurement`,
  );
  return value;
}
function tokenInstruction(
  opcode: number,
  keys: TransactionInstruction["keys"],
  amount?: bigint,
) {
  const data = Buffer.alloc(amount === undefined ? 1 : 10);
  data[0] = opcode;
  if (amount !== undefined) {
    data.writeBigUInt64LE(amount, 1);
    data[9] = TOKEN_1PCT.decimals;
  }
  return new TransactionInstruction({
    programId: EXTERNAL_IDS.splToken,
    keys,
    data,
  });
}
function createAta(payer: PublicKey, owner: PublicKey, mint: PublicKey) {
  return new TransactionInstruction({
    programId: EXTERNAL_IDS.associatedToken,
    keys: [
      writable(payer, true),
      writable(userAta(owner, mint, EXTERNAL_IDS.splToken)),
      readonly(owner),
      readonly(mint),
      readonly(SystemProgram.programId),
      readonly(EXTERNAL_IDS.splToken),
    ],
    data: Buffer.from([1]),
  });
}
async function submit(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  signers: Keypair[] = [],
) {
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: latest.blockhash,
  }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    ...instructions,
  );
  transaction.sign(payer, ...signers);
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    { preflightCommitment: "confirmed" },
  );
  let confirmed = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    const result = (await connection.getSignatureStatuses([signature]))
      .value[0];
    assert(!result?.err, JSON.stringify(result?.err));
    if (
      result?.confirmationStatus === "confirmed" ||
      result?.confirmationStatus === "finalized"
    ) {
      confirmed = true;
      break;
    }
    await delay(250);
  }
  assert(confirmed, `Local signature timed out: ${signature}`);
  for (let attempt = 0; attempt < 100; attempt++) {
    const receipt = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (receipt) {
      assert.equal(receipt.meta?.err, null);
      return { ...receipt, serializedBytes: transaction.serialize().length };
    }
    await delay(100);
  }
  throw new Error(`Missing local receipt ${signature}`);
}
async function amount(connection: Connection, address: PublicKey) {
  const account = await connection.getAccountInfo(address, "confirmed");
  return account ? account.data.readBigUInt64LE(64) : 0n;
}
export interface MeteoraSeasonState {
  mint: PublicKey;
  payer: Keypair;
  keeper: ReturnType<typeof createKeeperRehearsal>;
  position: PublicKey;
  positionNftAccount: PublicKey;
  economics: Record<string, string | number>[];
  computeUnits: Record<string, number>;
  transactionBytes: Record<string, number>;
}
/** One keeper reader per rehearsal, matching the production leadership term.
 * The account replay resets validator history, so retain the migration proof
 * already obtained from finalized history. Every call still reads live accounts. */
export function createKeeperRehearsal(
  connection: Connection,
  payer: PublicKey,
) {
  const endpoint = connection.rpcEndpoint;
  const reader = new FeeChainReader({
    rpc: new JsonRpcClient({
      url: connection.rpcEndpoint,
      timeoutMs: 15_000,
      failureThreshold: 3,
      recoverMs: 1_000,
    }),
    programId: DEPLOYMENT.programId,
    cluster: DEPLOYMENT.cluster,
    payer,
  });
  return async (connection: Connection, migration = false) => {
    assert.equal(
      connection.rpcEndpoint,
      endpoint,
      "Keeper rehearsal RPC changed",
    );
    try {
      const snapshot = await reader.read("confirmed");
      assert(snapshot);
      if (migration) assert(snapshot.migrationDue);
      const instructions = migration
        ? reader.migration(snapshot)
        : reader.collection(snapshot);
      const transaction = new VersionedTransaction(
        new TransactionMessage({
          payerKey: payer,
          recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
          instructions: [
            ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
            ...instructions,
          ],
        }).compileToV0Message(),
      );
      assert(transaction.serialize().length <= 1232);
      const simulation = await connection.simulateTransaction(transaction, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      assert.equal(
        simulation.value.err,
        null,
        JSON.stringify(simulation.value.logs),
      );
      console.log(
        `KEEPER ${migration ? "migration" : snapshot.input.surplus ? "pool+surplus+collect" : `${snapshot.input.claim.kind}+collect`} PASS: service reader and atomic plan simulation`,
      );
    } finally {
      reader.clearEphemeral();
    }
  };
}

async function context(
  connection: Connection,
  state: Pick<
    MeteoraSeasonState,
    | "mint"
    | "payer"
    | "economics"
    | "computeUnits"
    | "transactionBytes"
    | "keeper"
  >,
) {
  const { payer, mint } = state;
  const feeIn = feeInPda(PROGRAM_ID)[0];
  const venue = await meteoraLocalVenue(
    connection,
    new PublicKey(DEPLOYMENT.meteora.dbcConfig),
    dammConfig,
    mint,
    payer.publicKey,
    feeIn,
  );
  const quoteAccount = userAta(payer.publicKey, wsol, EXTERNAL_IDS.splToken);
  const baseAccount = userAta(payer.publicKey, mint, EXTERNAL_IDS.splToken);
  async function buy(
    kind: "dbc" | "damm-v2",
    spend: bigint,
    mode: 0 | 1 | 2 = 0,
    output = 1n,
  ) {
    const baseBefore = await amount(connection, baseAccount);
    const quoteBefore = await amount(connection, quoteAccount);
    const vault = kind === "dbc" ? venue.quoteVault : venue.migratedQuoteVault;
    const vaultBefore = await amount(connection, vault);
    const poolBefore =
      kind === "dbc"
        ? ((await venue.state("dbc", "VirtualPool", venue.launchPool))
            .pool_state as Record<string, unknown>)
        : await venue.state("damm-v2", "Pool", venue.migratedPool);
    const receipt = await submit(connection, payer, [
      createAta(payer.publicKey, payer.publicKey, wsol),
      createAta(payer.publicKey, payer.publicKey, mint),
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: quoteAccount,
        lamports: spend,
      }),
      tokenInstruction(17, [writable(quoteAccount)]),
      venue.swap(
        kind,
        quoteAccount,
        baseAccount,
        mode === 2 ? output : spend,
        mode === 2 ? spend : output,
        mode,
      ),
    ]);
    const spent =
      quoteBefore + spend - (await amount(connection, quoteAccount));
    const received = (await amount(connection, baseAccount)) - baseBefore;
    assert(spent > 0n && spent <= spend);
    assert(received > 0n);
    assert.equal((await amount(connection, vault)) - vaultBefore, spent);
    if (mode === 2) assert.equal(received, output);
    if (kind === "dbc" && poolBefore) {
      const poolAfter = (
        await venue.state("dbc", "VirtualPool", venue.launchPool)
      ).pool_state as Record<string, unknown>;
      const fee = (spent * 250n + 9_999n) / 10_000n;
      const protocol = (fee * 20n) / 100n;
      assert.equal(
        big(poolAfter.protocol_quote_fee) - big(poolBefore.protocol_quote_fee),
        protocol,
      );
      assert.equal(
        big(poolAfter.partner_quote_fee) - big(poolBefore.partner_quote_fee),
        fee - protocol,
      );
      assert.equal(
        big(poolAfter.quote_reserve) - big(poolBefore.quote_reserve),
        spent - fee,
      );
    }
    if (kind === "damm-v2" && poolBefore) {
      const poolAfter = await venue.state(
        "damm-v2",
        "Pool",
        venue.migratedPool,
      );
      const metricsBefore = poolBefore.metrics as Record<string, unknown>;
      const metricsAfter = poolAfter.metrics as Record<string, unknown>;
      const fee = (spent * 250n + 9999n) / 10000n;
      assert.equal(
        big(metricsAfter.total_protocol_b_fee) -
          big(metricsBefore.total_protocol_b_fee),
        (fee * 20n) / 100n,
      );
      assert.equal(
        big(metricsAfter.total_lp_b_fee) - big(metricsBefore.total_lp_b_fee),
        fee - (fee * 20n) / 100n,
      );
    }
    state.economics.push({
      operation: "buy",
      venue: kind,
      mode,
      spent: spent.toString(),
      received: received.toString(),
    });
    state.computeUnits[`${kind}Swap`] = Math.max(
      state.computeUnits[`${kind}Swap`] ?? 0,
      consumedUnits(receipt.meta?.computeUnitsConsumed, `${kind} swap`),
    );
    state.transactionBytes[`${kind}Swap`] = Math.max(
      state.transactionBytes[`${kind}Swap`] ?? 0,
      receipt.serializedBytes,
    );
    return { spent, received };
  }
  async function claim(
    kind: "curve" | "pool" | "surplus",
    regime: "belowFloor" | "season" | "afterEnd",
    position?: Pick<MeteoraSeasonState, "position" | "positionNftAccount">,
  ) {
    await state.keeper(connection);
    const before = await fetchMachine(PROGRAM_ID, connection);
    assert(before);
    const machineBalance = BigInt(
      await connection.getBalance(machinePda(PROGRAM_ID)[0]),
    );
    const feeBalance = BigInt(await connection.getBalance(feeIn));
    const ataRent = BigInt(
      await connection.getMinimumBalanceForRentExemption(165),
    );
    const baseVault =
      kind === "pool" ? venue.migratedBaseVault : venue.baseVault;
    const quoteVault =
      kind === "pool" ? venue.migratedQuoteVault : venue.quoteVault;
    const quoteBefore = await amount(connection, quoteVault);
    const baseBefore = await amount(connection, baseVault);
    const input =
      kind === "pool"
        ? {
            kind,
            payer: payer.publicKey,
            mint,
            baseVault,
            quoteVault,
            pool: venue.migratedPool,
            position: position!.position,
            positionNftAccount: position!.positionNftAccount,
          }
        : {
            kind,
            payer: payer.publicKey,
            mint,
            baseVault,
            quoteVault,
          };
    const nftBefore = position
      ? await connection.getAccountInfo(position.positionNftAccount)
      : null;
    const claimInstruction = claimLaunchFeesIx(DEPLOYMENT, input);
    const simulationTransaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
          claimInstruction,
        ],
      }).compileToV0Message(),
    );
    const simulation = await connection.simulateTransaction(
      simulationTransaction,
      { sigVerify: false, replaceRecentBlockhash: true },
    );
    assert.equal(
      simulation.value.err,
      null,
      JSON.stringify(simulation.value.logs),
    );
    const claimUnits = consumedUnits(
      simulation.value.unitsConsumed,
      `${kind} claim simulation`,
    );
    state.computeUnits[`claim${kind}`] = Math.max(
      state.computeUnits[`claim${kind}`] ?? 0,
      claimUnits,
    );
    if (process.env.UPDATE_REPORT !== "1")
      assert(claimUnits <= CU_LIMITS.claimLaunchFees[kind]);
    state.transactionBytes[`claim${kind}`] =
      simulationTransaction.serialize().length;
    const receipt = await submit(connection, payer, [
      claimInstruction,
      collectCreatorFeesIx(DEPLOYMENT, { payer: payer.publicKey }),
    ]);
    const events = (receipt.meta?.logMessages ?? [])
      .filter((line) => line.startsWith("Program data: "))
      .map((line) => decodeOnepercentEvent(line.slice(14)))
      .filter((event) => event !== null);
    const event = events.find((item) => item.name === "LaunchFeesClaimed");
    assert(event);
    const data = event.data as unknown as Record<string, unknown>;
    const quote = big(data.quote);
    const base = big(data.base);
    assert.equal(big(data.unwrapped_lamports), quote + ataRent);
    assert(kind === "surplus" ? quote >= 0n : quote > 0n);
    assert.equal(quoteBefore - (await amount(connection, quoteVault)), quote);
    assert.equal(baseBefore - (await amount(connection, baseVault)), base);
    assert.equal(base, 0n, "D29 collects quote only on the migrated pool");
    assert.equal(
      await connection.getAccountInfo(
        userAta(feeIn, wsol, EXTERNAL_IDS.splToken),
      ),
      null,
    );
    const after = await fetchMachine(PROGRAM_ID, connection);
    assert(after);
    const total = quote + ataRent;
    const team =
      regime === "belowFloor" ? 0n : regime === "season" ? total / 2n : total;
    assert.equal(after.stock_sol - before.stock_sol, total - team);
    assert.equal(after.team_sol - before.team_sol, team);
    assert.equal(after.burn_sol, before.burn_sol);
    assert.equal(
      BigInt(await connection.getBalance(machinePda(PROGRAM_ID)[0])) -
        machineBalance,
      total,
    );
    assert.equal(BigInt(await connection.getBalance(feeIn)), feeBalance);
    if (position) {
      const nftAfter = await connection.getAccountInfo(
        position.positionNftAccount,
      );
      assert(nftBefore && nftAfter);
      assert.deepEqual(nftAfter.data, nftBefore.data);
      assert.equal(nftAfter.lamports, nftBefore.lamports);
      assert(nftAfter.owner.equals(nftBefore.owner));
    }
    state.economics.push({
      operation: "claim",
      kind,
      regime,
      quote: quote.toString(),
      base: base.toString(),
      stock: (total - team).toString(),
      team: team.toString(),
    });
    const chainUnits = consumedUnits(
      receipt.meta?.computeUnitsConsumed,
      `${kind} claim and collect`,
    );
    state.computeUnits[`claim${kind}AndCollect`] = Math.max(
      state.computeUnits[`claim${kind}AndCollect`] ?? 0,
      chainUnits,
    );
    if (process.env.UPDATE_REPORT !== "1")
      assert(chainUnits <= CU_LIMITS.feeChainTx[kind]);
    state.transactionBytes[`claim${kind}AndCollect`] = Math.max(
      state.transactionBytes[`claim${kind}AndCollect`] ?? 0,
      receipt.serializedBytes,
    );
    console.log(
      `Meteora ${kind} ${regime}: quote=${quote}, base=${base}, stock=${total - team}, team=${team}`,
    );
  }
  return { venue, buy, claim, baseAccount, quoteAccount };
}

export async function runMeteoraSeason(
  connection: Connection,
  mintSigner: Keypair,
  payer: Keypair,
  appDirectory: string,
): Promise<MeteoraSeasonState> {
  const mint = mintSigner.publicKey;
  const keeper = createKeeperRehearsal(connection, payer.publicKey);
  const economics: MeteoraSeasonState["economics"] = [];
  const computeUnits: MeteoraSeasonState["computeUnits"] = {};
  const transactionBytes: MeteoraSeasonState["transactionBytes"] = {};
  const { venue, buy, claim, baseAccount } = await context(connection, {
    mint,
    payer,
    keeper,
    economics,
    computeUnits,
    transactionBytes,
  });
  const configSigner = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        await readFile(
          join(
            appDirectory,
            "fixtures/meteora/keys/localnet-devnet-dbc-config-TEST-ONLY.json",
          ),
          "utf8",
        ),
      ) as number[],
    ),
  );
  assert.equal(configSigner.publicKey.toBase58(), DEPLOYMENT.meteora.dbcConfig);
  const parameters = meteoraTestConfig();
  await submit(
    connection,
    payer,
    [venue.createConfig(parameters)],
    [configSigner],
  );
  const storedConfig = await venue.state(
    "dbc",
    "PoolConfig",
    configSigner.publicKey,
  );
  assert.equal(
    storedConfig.version,
    process.env.ONEPERCENT_METEORA_FIXTURE_PROFILE === "devnet-observed-v1"
      ? 1
      : 0,
  );
  for (const [field, expected] of Object.entries({
    quote_mint: wsol,
    fee_claimer: feeInPda(PROGRAM_ID)[0],
    leftover_receiver: feeInPda(PROGRAM_ID)[0],
  }))
    assert.equal(String(storedConfig[field]), expected.toBase58());
  for (const field of [
    "collect_fee_mode",
    "migration_option",
    "activation_type",
    "token_type",
    "token_decimal",
    "partner_liquidity_percentage",
    "partner_permanent_locked_liquidity_percentage",
    "creator_liquidity_percentage",
    "creator_permanent_locked_liquidity_percentage",
    "migration_fee_option",
    "creator_trading_fee_percentage",
    "token_update_authority",
    "migration_quote_threshold",
    "sqrt_start_price",
  ] as const)
    assert.equal(big(storedConfig[field]), big(parameters[field]));
  assert.equal(
    big(storedConfig.pre_migration_token_supply),
    TOKEN_1PCT.totalSupply,
  );
  assert.equal(
    big(storedConfig.post_migration_token_supply),
    TOKEN_1PCT.totalSupply,
  );
  assert.equal(storedConfig.migrated_collect_fee_mode, 0);
  assert.equal(storedConfig.migrated_pool_fee_bps, 250);
  assert.equal(storedConfig.migrated_dynamic_fee, 0);
  assert.equal(storedConfig.migrated_compounding_fee_bps, 0);
  await submit(
    connection,
    payer,
    [
      venue.initializePool({
        name: "Onepercent local test",
        symbol: "1PCT",
        uri: "https://example.invalid/onepercent-local.json",
      }),
    ],
    [mintSigner],
  );
  await buy("dbc", 5_000_000_000n, 2, TOKEN_1PCT.devBuyAmount);
  const vault = vaultAta(PROGRAM_ID, mint, EXTERNAL_IDS.splToken);
  await submit(connection, payer, [
    createAta(payer.publicKey, vaultAuthPda(PROGRAM_ID)[0], mint),
    tokenInstruction(
      12,
      [
        writable(baseAccount),
        readonly(mint),
        writable(vault),
        readonly(payer.publicKey, true),
      ],
      TOKEN_1PCT.devBuyAmount,
    ),
    powerOnIx(DEPLOYMENT, {
      launchWallet: payer.publicKey,
      mint,
      tokenProgram: EXTERNAL_IDS.splToken,
    }),
  ]);
  assert.equal((await fetchMachine(PROGRAM_ID, connection))?.phase, 2);
  assert.equal(await amount(connection, vault), TOKEN_1PCT.devBuyAmount);
  assert.equal(await amount(connection, baseAccount), 0n);
  await buy("dbc", 1_000_000_000n);
  await claim("curve", "belowFloor");
  const beforeSeed = await fetchMachine(PROGRAM_ID, connection);
  assert(beforeSeed && beforeSeed.stock_sol < STOCK.creatorFeeFloorLamports);
  const seed = STOCK.creatorFeeFloorLamports - beforeSeed.stock_sol;
  await submit(connection, payer, [
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: feeInPda(PROGRAM_ID)[0],
      lamports: seed,
    }),
    collectCreatorFeesIx(DEPLOYMENT, { payer: payer.publicKey }),
  ]);
  assert.equal(
    (await fetchMachine(PROGRAM_ID, connection))?.stock_sol,
    STOCK.creatorFeeFloorLamports,
  );
  await buy("dbc", 100_000_000_000n, 1);
  const completed = (await venue.state("dbc", "VirtualPool", venue.launchPool))
    .pool_state as Record<string, unknown>;
  const completedReserve = big(completed.quote_reserve);
  // This pinned curve's partial-fill input rounds up by one quote lamport.
  assert.equal(completedReserve, parameters.migration_quote_threshold + 1n);
  economics.push({
    operation: "curveComplete",
    quoteReserve: completedReserve.toString(),
    threshold: parameters.migration_quote_threshold.toString(),
  });
  await claim("curve", "season");
  // Pinned DBC flash_rent.rs requires a prefunded global authority; mainnet
  // already has it. Migration borrows rent and the local payer reimburses it.
  await submit(connection, payer, [
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: venue.launchAuthority,
      lamports: 1_000_000_000n,
    }),
  ]);
  await keeper(connection, true);
  const migration = venue.migration();
  const authorityBalanceBefore = await connection.getBalance(
    venue.launchAuthority,
  );
  const payerBeforeMigration = await connection.getBalance(payer.publicKey);
  const migrationReceipt = await submit(
    connection,
    payer,
    [migration.instruction],
    [migration.positionMint],
  );
  const authorityBalanceAfter = await connection.getBalance(
    venue.launchAuthority,
  );
  assert.equal(authorityBalanceAfter, authorityBalanceBefore);
  economics.push({
    operation: "migration",
    authorityBefore: String(authorityBalanceBefore),
    authorityAfter: String(authorityBalanceAfter),
    payerRent: String(
      payerBeforeMigration -
        (await connection.getBalance(payer.publicKey)) -
        (migrationReceipt.meta?.fee ?? 0),
    ),
  });
  computeUnits.migration = consumedUnits(
    migrationReceipt.meta?.computeUnitsConsumed,
    "migration",
  );
  transactionBytes.migration = migrationReceipt.serializedBytes;
  const migratedPool = await venue.state("damm-v2", "Pool", venue.migratedPool);
  assert.equal(migratedPool.collect_fee_mode, 1);
  assert.equal(
    big(migratedPool.permanent_lock_liquidity),
    big(migratedPool.liquidity),
  );
  const migratedPosition = await venue.state(
    "damm-v2",
    "Position",
    migration.position,
  );
  assert.equal(big(migratedPosition.unlocked_liquidity), 0n);
  assert.equal(big(migratedPosition.vested_liquidity), 0n);
  assert.equal(
    big(migratedPosition.permanent_locked_liquidity),
    big(migratedPool.liquidity),
  );
  const nft = await connection.getAccountInfo(migration.positionNftAccount);
  assert(nft);
  assert(
    new PublicKey(nft.data.subarray(32, 64)).equals(feeInPda(PROGRAM_ID)[0]),
  );
  assert.equal(nft.data.readBigUInt64LE(64), 1n);
  const position = {
    position: migration.position,
    positionNftAccount: migration.positionNftAccount,
  };
  // The service accepts position provenance only from finalized migration
  // history. Let the local validator root that receipt before rehearsing it.
  let migrationFinalized = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    if ((await connection.getSlot("finalized")) >= migrationReceipt.slot) {
      migrationFinalized = true;
      break;
    }
    await delay(250);
  }
  assert(migrationFinalized, "Local migration finality timed out");
  await claim("surplus", "season");
  await buy("damm-v2", 1_000_000_000n);
  await claim("pool", "season", position);
  console.log(
    "Meteora season PASS: real DBC config, launch, trades, claims, 85 SOL migration and DAMM trade",
  );
  return {
    mint,
    payer,
    keeper,
    ...position,
    economics,
    computeUnits,
    transactionBytes,
  };
}

export async function runMeteoraAfterEnd(
  connection: Connection,
  state: MeteoraSeasonState,
  appDirectory: string,
) {
  await submit(connection, state.payer, [
    advancePhaseInstruction(PROGRAM_ID),
    advancePhaseInstruction(PROGRAM_ID),
  ]);
  assert.equal((await fetchMachine(PROGRAM_ID, connection))?.phase, 4);
  const { buy, claim } = await context(connection, state);
  await buy("damm-v2", 1_000_000_000n);
  await claim("pool", "afterEnd", state);
  const metadataProgram = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
  );
  const [metadataAddress] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      metadataProgram.toBuffer(),
      state.mint.toBuffer(),
    ],
    metadataProgram,
  );
  const metadataAccount = await connection.getAccountInfo(metadataAddress);
  assert(metadataAccount && metadataAccount.owner.equals(metadataProgram));
  const metadata = metadataAccount.data;
  assert.equal(metadata[0], 4);
  let cursor = 65;
  for (let i = 0; i < 3; i++) cursor += 4 + metadata.readUInt32LE(cursor);
  cursor += 2;
  const creators = metadata[cursor++];
  assert(creators === 0 || creators === 1);
  if (creators) cursor += 4 + 34 * metadata.readUInt32LE(cursor);
  assert.equal(metadata[cursor + 1], 0, "Metadata immutable after migration");
  if (process.env.ONEPERCENT_METEORA_FIXTURE_PROFILE === "devnet-observed-v1") {
    const baseline = JSON.parse(
      await readFile(
        join(appDirectory, "fixtures/reports/m4-meteora-season.json"),
        "utf8",
      ),
    );
    assert.deepEqual(
      state.economics,
      baseline.economics,
      "Devnet binaries must preserve v0 economic vectors",
    );
  }
  const artifactReport = await meteoraFixturePrograms();
  const report = {
    fixtureProfile:
      process.env.ONEPERCENT_METEORA_FIXTURE_PROFILE ?? "mainnet-captured-v0",
    metadataImmutableAfterMigration: true,
    programs: [
      ...artifactReport.programs.map(({ programId, sha256 }) => ({
        programId,
        sha256,
      })),
      {
        programId: PROGRAM_ID.toBase58(),
        sha256: createHash("sha256")
          .update(
            await readFile(join(appDirectory, "target/deploy/onepercent.so")),
          )
          .digest("hex"),
      },
    ],
    config: meteoraTestConfig(),
    localFlashRentLamports: "1000000000",
    economics: state.economics,
    computeUnits: state.computeUnits,
    transactionBytes: state.transactionBytes,
    afterEndClock:
      "Exact real venue state replay; only Machine on_air_ts/end_ts pre-aged",
  };
  const devnetReplay =
    process.env.ONEPERCENT_METEORA_FIXTURE_PROFILE === "devnet-observed-v1";
  const path = join(
    appDirectory,
    devnetReplay
      ? "reports/devnet/meteora-season-v1.json"
      : "fixtures/reports/m4-meteora-season.json",
  );
  const serialized =
    JSON.stringify(
      report,
      (_, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      2,
    ) + "\n";
  if (process.env.UPDATE_REPORT === "1") await writeFile(path, serialized);
  else {
    const expected = JSON.parse(await readFile(path, "utf8")) as typeof report;
    const actual = JSON.parse(serialized) as typeof report;
    assert.deepEqual(actual.economics, expected.economics);
    assert.deepEqual(actual.config, expected.config);
    // External Meteora program dumps are pinned by hash; our own binary changes with
    // every build environment and program edit, so it is recorded but not compared.
    const external = (programs: typeof report.programs) =>
      programs.filter(({ programId }) => programId !== PROGRAM_ID.toBase58());
    assert.deepEqual(external(actual.programs), external(expected.programs));
  }
  console.log(
    "Meteora AFTER_END PASS: real migrated pool remains collectible after buys close",
  );
}
