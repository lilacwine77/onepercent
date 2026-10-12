import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import {
  HIT_LIST,
  KEEPER_POLICY,
  PROGRAM_IDS,
  WSOL_MINT,
} from "@onepercent/config";
import {
  configPda,
  machinePda,
  decodeConfig,
  decodeMachine,
  encodeMachine,
  encodeConfig,
  decodePull,
  decodeBinder,
  pullHeaderLayout,
  binderHeaderLayout,
  PHASE,
  PULL_STATUS,
  rotateHour,
  keeperWindowBounds,
  EXTERNAL_IDS,
  userAta,
  vaultAta,
  vaultAuthPda,
  ledgerPda,
  EXEC_KIND,
} from "@onepercent/sdk";
import type { ClusterDeployment, ExecBeginInput } from "@onepercent/sdk";
import type { ExecAccountReading, ExecReadings } from "@onepercent/sdk/server";
import type { StockRequest, StockState } from "./planner.js";
export const unusedAccount = (): ExecAccountReading => ({
  address: SystemProgram.programId,
  owner: SystemProgram.programId,
  data: Buffer.alloc(0),
});
export function sponsoredAccount(feed: Uint8Array) {
  return PublicKey.findProgramAddressSync(
    [Buffer.alloc(2), Buffer.from(feed)],
    new PublicKey(PROGRAM_IDS.pythPushOracle),
  )[0];
}
/** Mirror only the idempotent ATA creation that composeExecTransaction prepends. */
export function preparedAta(
  address: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey,
  rent: bigint,
): ExecAccountReading {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data);
  owner.toBuffer().copy(data, 32);
  data[108] = 1;
  if (mint.toBase58() === WSOL_MINT) {
    data.writeUInt32LE(1, 109);
    data.writeBigUInt64LE(rent, 113);
  }
  return { address, owner: tokenProgram, data };
}
export class StockChain {
  constructor(
    readonly connection: Connection,
    readonly deployment: ClusterDeployment,
  ) {}
  async now(): Promise<bigint> {
    const clock = await this.connection.getAccountInfo(
      SYSVAR_CLOCK_PUBKEY,
      "confirmed",
    );
    if (!clock || clock.data.length !== 40)
      throw new Error("clock_unavailable");
    return clock.data.readBigInt64LE(32);
  }
  async snapshot() {
    const id = this.deployment.programId;
    const result = await this.connection.getMultipleAccountsInfoAndContext(
      [configPda(id)[0], machinePda(id)[0], SYSVAR_CLOCK_PUBKEY],
      "confirmed",
    );
    const [config, machine, clock] = result.value;
    if (
      !config ||
      !machine ||
      !clock ||
      clock.data.length !== 40 ||
      !config.owner.equals(id) ||
      !machine.owner.equals(id)
    )
      throw new Error("stock_accounts_unavailable");
    return {
      deployment: this.deployment,
      config: decodeConfig(config.data),
      machine: decodeMachine(machine.data),
      slot: result.context.slot,
      now: clock.data.readBigInt64LE(32),
      machineAccount: machine,
    };
  }
  /** Account reads only. A missing bound refuses buys, never substitutes zero. */
  async limits(
    snapshot: Awaited<ReturnType<StockChain["snapshot"]>>,
    now: bigint,
  ) {
    const m = snapshot.machine;
    const result = {
      buyBlockReason: null as string | null,
      spendableSol: 0n,
      payoutReserve: 0n,
      // Unknown legacy/saturated inflows permit no additional inventory. The
      // anchor remains subject to the separately proved payout reserve.
      inventoryInflowBound:
        (rotateHour(m, now).hit_out_last_hour *
          BigInt(KEEPER_POLICY.inventoryTargetMinutes)) /
        60n,
      lastReveal: m.last_reveal_ts as bigint | null,
      owedSol: 0n,
    };
    try {
      const rent = BigInt(
        await this.connection.getMinimumBalanceForRentExemption(
          snapshot.machineAccount.data.length,
        ),
      );
      if (!Number.isSafeInteger(snapshot.machineAccount.lamports))
        throw new Error("machine_balance_unreadable");
      const free =
        BigInt(snapshot.machineAccount.lamports) -
        rent -
        m.jackpot_sol -
        m.burn_sol -
        m.team_sol -
        m.final_pool_sol;
      if (free < m.stock_sol) throw new Error("machine_underfunded");
      result.spendableSol = free < m.stock_sol ? free : m.stock_sol;
      const accounts = async (
        header: typeof pullHeaderLayout | typeof binderHeaderLayout,
      ) =>
        this.connection.getProgramAccounts(this.deployment.programId, {
          commitment: "confirmed",
          minContextSlot: snapshot.slot,
          filters: [
            {
              memcmp: {
                offset: 0,
                bytes: header.encode({}).subarray(0, 8).toString("base64"),
                encoding: "base64",
              },
            },
          ],
        });
      for (const { account } of await accounts(pullHeaderLayout)) {
        if (!account.owner.equals(this.deployment.programId))
          throw new Error("pull_owner");
        const pull = decodePull(account.data);
        if (pull.status === PULL_STATUS.pending)
          result.buyBlockReason = "pending_pull";
        if (pull.status === PULL_STATUS.revealed) {
          if (pull.settled_mask !== (1 << pull.qty) - 1)
            result.buyBlockReason = "unsettled_reveal";
          if (
            result.lastReveal === null ||
            pull.revealed_ts > result.lastReveal
          )
            result.lastReveal = pull.revealed_ts;
        } else if (pull.status !== PULL_STATUS.pending)
          throw new Error("pull_status_unreadable");
      }
      // Owed SOL is escrowed in each Binder, never in the Machine spendable pot.
      for (const { account } of await accounts(binderHeaderLayout)) {
        if (
          !account.owner.equals(this.deployment.programId) ||
          !Number.isSafeInteger(account.lamports)
        )
          throw new Error("binder_unreadable");
        const binder = decodeBinder(account.data);
        const minimum = BigInt(
          await this.connection.getMinimumBalanceForRentExemption(
            account.data.length,
          ),
        );
        if (BigInt(account.lamports) - minimum < binder.sol_owed)
          throw new Error("owed_sol_underfunded");
        result.owedSol += binder.sol_owed;
      }
      for (const b of m.buckets) {
        if (!b.class) continue;
        if (b.reserved > b.cost) throw new Error("reserved_stock_unreadable");
        const mint = await this.read(b.mint, snapshot.slot);
        if (
          !mint.owner.equals(EXTERNAL_IDS.splToken) &&
          !mint.owner.equals(EXTERNAL_IDS.token2022)
        )
          throw new Error("stock_mint_owner");
        const vault = await this.read(
          vaultAta(this.deployment.programId, b.mint, mint.owner),
          snapshot.slot,
        );
        if (
          !vault.owner.equals(mint.owner) ||
          vault.data.length < 165 ||
          !new PublicKey(vault.data.slice(0, 32)).equals(b.mint) ||
          !new PublicKey(vault.data.slice(32, 64)).equals(
            vaultAuthPda(this.deployment.programId)[0],
          ) ||
          vault.data[108] !== 1 ||
          Buffer.from(vault.data).readBigUInt64LE(64) < b.amount
        )
          throw new Error("stock_vault_unreadable");
      }
      if (m.pending_pulls > 0) result.buyBlockReason ??= "pending_pull";
      if (m.unsettled_reveals > 0n)
        result.buyBlockReason ??= "unsettled_reveal";
      if (m.keeper_history_version !== 1n && m.last_reveal_ts === 0n)
        result.buyBlockReason ??= "keeper_history_unactivated";
      const hour = now / 3600n;
      const payoutWindow = BigInt(KEEPER_POLICY.solReserveExtraMinutes * 60);
      if (
        now < 0n ||
        m.hour_index > hour ||
        m.keeper_history_version > 2n ||
        (m.phase !== PHASE.poweredOn &&
          m.keeper_history_version === 0n &&
          hour === m.hour_index &&
          now - payoutWindow < hour * 3600n)
      )
        throw new Error("payout_reserve_unavailable");
      const current = rotateHour(m, now);
      result.payoutReserve =
        current.sb_paid_hour +
        (now - payoutWindow < hour * 3600n ? current.sb_paid_prev_hour : 0n);
      const inventory = keeperWindowBounds(
        m,
        now,
        BigInt(KEEPER_POLICY.inventoryTargetMinutes * 60),
      );
      if (inventory)
        result.inventoryInflowBound = inventory.inflows.reduce(
          (sum, n) => sum + n,
          0n,
        );
    } catch (error) {
      result.buyBlockReason =
        error instanceof Error ? error.message : "stock_limits_unavailable";
    }
    return result;
  }
  async evidence(
    state: StockState,
    request: StockRequest,
  ): Promise<{ args: ExecBeginInput; readings: ExecReadings }> {
    const { programId } = this.deployment,
      b = state.machine.buckets[request.bucket]!;
    const mint = await this.read(b.mint, state.slot),
      native = new PublicKey(WSOL_MINT),
      sell = request.kind === EXEC_KIND.stockSell;
    const oracle0 =
      b.class === 1 ? sponsoredAccount(b.oracle.toBytes()) : b.oracle;
    const o0 = await this.read(oracle0, state.slot);
    const oracleKeys: ExecBeginInput["oracles"] =
      b.class === 1
        ? [
            oracle0,
            sponsoredAccount(Buffer.from(HIT_LIST.solUsdPythFeedId, "hex")),
            SystemProgram.programId,
            SystemProgram.programId,
          ]
        : [
            oracle0,
            new PublicKey(o0.data.slice(139, 171)),
            new PublicKey(o0.data.slice(171, 203)),
            SystemProgram.programId,
          ];
    const oracles = (await Promise.all(
      oracleKeys.map((key) =>
        key.equals(SystemProgram.programId)
          ? unusedAccount()
          : this.read(key, state.slot),
      ),
    )) as unknown as ExecReadings["oracles"];
    const args: ExecBeginInput = {
      signer: state.config.keeper,
      mint: b.mint,
      tokenProgram: mint.owner,
      kind: request.kind,
      bucket: request.bucket,
      amount: request.amount,
      oracles: oracleKeys,
    };
    const srcKey = userAta(
      args.signer,
      sell ? b.mint : native,
      sell ? mint.owner : EXTERNAL_IDS.splToken,
    );
    const dest = vaultAta(programId, native, EXTERNAL_IDS.splToken);
    const keys = [
      ledgerPda(programId, b.mint)[0],
      vaultAta(programId, b.mint, mint.owner),
      srcKey,
      dest,
      machinePda(programId)[0],
      configPda(programId)[0],
    ];
    const observed = await this.connection.getMultipleAccountsInfoAndContext(
      keys,
      {
        commitment: "confirmed",
        minContextSlot: state.slot,
      },
    );
    if (state.slot !== undefined && observed.context.slot < state.slot)
      throw new Error("stock_snapshot_changed");
    const accounts = observed.value;
    const machine = accounts[4],
      config = accounts[5];
    if (
      !machine ||
      !config ||
      !machine.owner.equals(programId) ||
      !config.owner.equals(programId) ||
      !Number.isSafeInteger(machine.lamports)
    )
      throw new Error("machine_unavailable");
    // Compare decoded state, including reveal counters, pending draws, all pots,
    // bucket reservations/caps and execution flags. Any change requires a replan.
    if (
      !encodeMachine(decodeMachine(machine.data)).equals(
        encodeMachine(state.machine),
      ) ||
      !encodeConfig(decodeConfig(config.data)).equals(
        encodeConfig(state.config),
      )
    )
      throw new Error("stock_snapshot_changed");
    const read = (index: number): ExecAccountReading => {
      const a = accounts[index];
      if (!a) throw new Error("stock_account_missing");
      return { address: keys[index]!, owner: a.owner, data: a.data };
    };
    const rent = BigInt(
      await this.connection.getMinimumBalanceForRentExemption(165),
    );
    return {
      args,
      readings: {
        mint,
        ledger: read(0),
        vault: read(1),
        src: accounts[2]
          ? read(2)
          : preparedAta(
              srcKey,
              sell ? b.mint : native,
              args.signer,
              sell ? mint.owner : EXTERNAL_IDS.splToken,
              rent,
            ),
        solDest: !sell
          ? unusedAccount()
          : accounts[3]
            ? read(3)
            : preparedAta(
                dest,
                native,
                vaultAuthPda(programId)[0],
                EXTERNAL_IDS.splToken,
                rent,
              ),
        oracles,
        machineLamports: BigInt(machine.lamports),
        machineRentMinimum: BigInt(
          await this.connection.getMinimumBalanceForRentExemption(
            machine.data.length,
          ),
        ),
        execution: { stackHeight: 1, currentIndex: 0, instructions: [] },
      },
    };
  }
  async read(
    address: PublicKey,
    minContextSlot?: number,
  ): Promise<ExecAccountReading> {
    const account = await this.connection.getAccountInfo(address, {
      commitment: "confirmed",
      minContextSlot,
    });
    if (!account) throw new Error("stock_account_missing");
    return { address, owner: account.owner, data: account.data };
  }
}
