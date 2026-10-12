import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { HIT_LIST, STOCK, WSOL_MINT } from "@onepercent/config";
import {
  createDeploymentSelector,
  encodeConfig,
  decodeConfig,
  encodeMachine,
  decodeMachine,
  encodeMintLedger,
  EXTERNAL_IDS,
  PHASE,
  EXEC_KIND,
  PYTH_PRICE_UPDATE_V2_DISCRIMINATOR,
  ledgerPda,
  vaultAta,
  vaultAuthPda,
  userAta,
  execBeginIx,
  execEndIx,
} from "@onepercent/sdk";
import { checkExecBegin } from "@onepercent/sdk/server";
import type { ExecBeginInput, ClusterDeployment } from "@onepercent/sdk";
import type { ExecAccountReading, ExecReadings } from "@onepercent/sdk/server";
import type { StockState } from "./planner.js";
const DEPLOYMENT = createDeploymentSelector({
  localnet: new PublicKey(new Uint8Array(32).fill(91)),
})("localnet");
const NATIVE_MINT = new PublicKey(WSOL_MINT);
type Mutable<T> = T extends
  PublicKey | Uint8Array | ClusterDeployment | ReadonlyMap<unknown, unknown>
  ? T
  : { -readonly [K in keyof T]: Mutable<T[K]> };
const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));
const empty = (): ExecAccountReading => ({
  address: SystemProgram.programId,
  owner: SystemProgram.programId,
  data: Buffer.alloc(0),
});
function token(
  address: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  amount = 0n,
  native = false,
): ExecAccountReading {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  if (native) data.writeUInt32LE(1, 109);
  return { address, owner: EXTERNAL_IDS.splToken, data };
}
function pyth(
  address: PublicKey,
  feed: Uint8Array,
  price: bigint,
  now: bigint,
): ExecAccountReading {
  const data = Buffer.alloc(133);
  data.set(PYTH_PRICE_UPDATE_V2_DISCRIMINATOR);
  data[40] = 1;
  data.set(feed, 41);
  data.writeBigInt64LE(price, 73);
  data.writeBigUInt64LE(1n, 81);
  data.writeInt32LE(-8, 89);
  data.writeBigInt64LE(now, 93);
  return { address, owner: EXTERNAL_IDS.pythReceiver, data };
}
export function fixture(
  sell = false,
  deployment: ClusterDeployment = DEPLOYMENT,
) {
  const programId = deployment.programId;
  const now = 7200n,
    signer = Keypair.generate().publicKey,
    mint = key(2),
    feed = key(3);
  const state: Mutable<StockState> = {
    buyBlockReason: null,
    spendableSol: 100_000_000_000n,
    budget: { bought: 0n, sold: 0n, mints: new Map() },
    buckets: new Map([[0, { failing: false, listedAt: 0n }]]),
    payoutReserve: 0n,
    inventoryInflowBound: 0n,
    lastReveal: null,
    revealDelaySeconds: 30,
    deployment,
    config: decodeConfig(
      encodeConfig({ keeper: signer, executor: key(4), token_mint: key(5) }),
    ),
    machine: decodeMachine(
      encodeMachine({
        phase: PHASE.onAir,
        keeper_history_version: 1n,
        end_ts: now + 10000n,
        stock_sol: 100_000_000_000n,
        hour_index: 2n,
        stock_hour_index: 2n,
        buckets: [
          {
            mint,
            oracle: feed,
            amount: 1_000_000_000n,
            cost: 8_000_000_000n,
            cap: 100_000_000_000n,
            enabled: 1,
            class: 1,
            decimals: 6,
          },
          ...Array.from({ length: STOCK.maxBuckets - 1 }, () => ({})),
        ],
      }),
    ),
  };
  const args: ExecBeginInput = {
    signer,
    mint,
    kind: sell ? EXEC_KIND.stockSell : EXEC_KIND.stockBuy,
    bucket: 0,
    amount: sell ? 100_000_000n : 1_000_000_000n,
    tokenProgram: EXTERNAL_IDS.splToken,
    oracles: [key(6), key(7), SystemProgram.programId, SystemProgram.programId],
  };
  const mintData = Buffer.alloc(82);
  mintData[44] = 6;
  mintData[45] = 1;
  const readings: ExecReadings = {
    mint: { address: mint, owner: EXTERNAL_IDS.splToken, data: mintData },
    ledger: {
      address: ledgerPda(programId, mint)[0],
      owner: programId,
      data: encodeMintLedger({ mint, accounted: 1_000_000_000n }),
    },
    vault: token(
      vaultAta(programId, mint, EXTERNAL_IDS.splToken),
      mint,
      vaultAuthPda(programId)[0],
      1_000_000_000n,
    ),
    src: token(
      userAta(signer, sell ? mint : NATIVE_MINT, EXTERNAL_IDS.splToken),
      sell ? mint : NATIVE_MINT,
      signer,
      0n,
      !sell,
    ),
    solDest: sell
      ? token(
          vaultAta(programId, NATIVE_MINT, EXTERNAL_IDS.splToken),
          NATIVE_MINT,
          vaultAuthPda(programId)[0],
          777n,
          true,
        )
      : empty(),
    oracles: [
      pyth(key(6), feed.toBytes(), 85_000_000n, now),
      pyth(
        key(7),
        Buffer.from(HIT_LIST.solUsdPythFeedId, "hex"),
        10_901_000_000n,
        now,
      ),
      empty(),
      empty(),
    ],
    execution: {
      stackHeight: 1,
      currentIndex: 0,
      instructions: [execBeginIx(programId, args), execEndIx(programId, args)],
    },
    machineLamports: 200_000_000_000n,
    machineRentMinimum: 1_000_000n,
  };
  const run = () => {
    readings.execution.instructions = [
      execBeginIx(programId, args),
      execEndIx(programId, args),
    ];
    return checkExecBegin(state, args, readings, now);
  };
  return { state, args, readings, now, run };
}
