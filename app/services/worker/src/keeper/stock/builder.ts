import {
  BPS_DENOMINATOR,
  MARKET,
  SERVICES,
  STOCK,
  WSOL_MINT,
} from "@onepercent/config";
import {
  composeExecTransaction,
  EXEC_KIND,
  execBeginIx,
  execEndIx,
  EXTERNAL_IDS,
  vaultAta,
} from "@onepercent/sdk";
import { toTransactionInstruction } from "@onepercent/market";
import type { JupiterSwapClient, SwapBuild } from "@onepercent/market";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  TransactionMessage,
} from "@solana/web3.js";
import type { TransactionInstruction } from "@solana/web3.js";
import { checkStockQuote } from "./planner.js";
import type { StockState, StockTrade } from "./planner.js";
export interface StockRoute {
  setup: TransactionInstruction[];
  swap: TransactionInstruction | readonly TransactionInstruction[];
  cleanup: TransactionInstruction[];
  lookupTables: AddressLookupTableAccount[];
  outAmount: bigint;
  minOut: bigint;
}
export async function buildRoute(
  state: StockState,
  trade: StockTrade,
  swap: Pick<JupiterSwapClient, "build">,
  lookup: (key: PublicKey) => Promise<AddressLookupTableAccount>,
): Promise<StockRoute> {
  const sell = trade.kind === EXEC_KIND.stockSell,
    args = trade.args;
  const result: SwapBuild = await swap.build({
    inputMint: sell ? args.mint.toBase58() : WSOL_MINT,
    outputMint: sell ? WSOL_MINT : args.mint.toBase58(),
    amount: trade.amount,
    taker: args.signer.toBase58(),
    slippageBps:
      state.machine.buckets[trade.bucket]!.class === 1
        ? STOCK.majorMinOutSlipBps
        : STOCK.trendingMinOutSlipBps,
    wrapAndUnwrapSol: false,
    destinationTokenAccount: vaultAta(
      state.deployment.programId,
      sell ? new PublicKey(WSOL_MINT) : args.mint,
      sell ? EXTERNAL_IDS.splToken : args.tokenProgram,
    ).toBase58(),
    maxAccounts: MARKET.jupiter.buildMaxAccounts,
  });
  if (
    result.inAmount !== trade.amount ||
    result.outAmount < trade.outAmount ||
    result.minOut < trade.onchainMinOut
  )
    throw new Error("route_min_out");
  // Resolve real LUT bytes; never trust the address list supplied by a router.
  const lookupTables = await Promise.all(
    Object.keys(result.lookupTables).map((key) => lookup(new PublicKey(key))),
  );
  return {
    setup: [...result.otherInstructions, ...result.setupInstructions].map(
      toTransactionInstruction,
    ),
    swap: toTransactionInstruction(result.swapInstruction),
    cleanup: result.cleanupInstruction
      ? [toTransactionInstruction(result.cleanupInstruction)]
      : [],
    lookupTables,
    outAmount: result.outAmount,
    minOut: result.minOut,
  };
}
export function buildStockTransaction(input: {
  state: StockState;
  trade: StockTrade;
  route: StockRoute;
  now: bigint;
  blockhash: string;
  protocolLut: AddressLookupTableAccount;
  units: number;
  priorityMicroLamports?: bigint;
  tip?: { recipient: PublicKey; dontFront: PublicKey };
}) {
  const { state, trade, route } = input;
  const checked = checkStockQuote(
    state,
    { ...trade, minOut: route.minOut, outAmount: route.outAmount },
    input.now,
  );
  if (!checked.ok) throw new Error(checked.error);
  const extraIxs: TransactionInstruction[] = [];
  if (input.tip) {
    const ix = SystemProgram.transfer({
      fromPubkey: trade.args.signer,
      toPubkey: input.tip.recipient,
      lamports: SERVICES.landing.tipLamports!,
    });
    ix.keys.push({
      pubkey: input.tip.dontFront,
      isSigner: false,
      isWritable: false,
    });
    extraIxs.push(ix);
  }
  const computeBudget = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: input.units }),
  ];
  if (input.priorityMicroLamports !== undefined)
    computeBudget.push(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: input.priorityMicroLamports,
      }),
    );
  const result = composeExecTransaction({
    deployment: state.deployment,
    payer: trade.args.signer,
    beginIx: execBeginIx(state.deployment.programId, trade.args),
    endIx: execEndIx(state.deployment.programId, trade.args),
    swap: route,
    computeBudget,
    extraIxs,
    protocolLut: input.protocolLut,
    blockhash: input.blockhash,
  });
  const lookupTables = [input.protocolLut, ...route.lookupTables];
  const instructions = TransactionMessage.decompile(
    result.transaction.message,
    { addressLookupTableAccounts: lookupTables },
  ).instructions.filter(
    (ix) => !ix.programId.equals(ComputeBudgetProgram.programId),
  );
  return { ...result, instructions, lookupTables };
}
export function measuredUnits(consumed: number) {
  return Math.ceil(
    (consumed * (BPS_DENOMINATOR + SERVICES.landing.cuMarginBps)) /
      BPS_DENOMINATOR,
  );
}
