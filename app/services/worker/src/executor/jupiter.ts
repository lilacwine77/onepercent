import { warnCause } from "@onepercent/service-kit";
import { MARKET, WSOL_MINT, SERVICES } from "@onepercent/config";
import { vaultAta, EXTERNAL_IDS } from "@onepercent/sdk";
import {
  PublicKey,
  TransactionInstruction,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import { z } from "zod";
import type { ExecutorPlan } from "./policy.js";
import { executorSlippage, type ExecutorSwap } from "./compose.js";
const address = z.string().refine((value) => {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch (error) {
    warnCause("executor_address_invalid", error);
    return false;
  }
});
const amount = z
  .string()
  .regex(/^\d+$/)
  .transform(BigInt)
  .pipe(
    z
      .bigint()
      .nonnegative()
      .max((1n << 64n) - 1n),
  );
const instruction = z.object({
  programId: address,
  accounts: z.array(
    z.object({
      pubkey: address,
      isSigner: z.boolean(),
      isWritable: z.boolean(),
    }),
  ),
  data: z
    .string()
    .refine(
      (value) => Buffer.from(value, "base64").toString("base64") === value,
    ),
});
const schema = z.object({
  inAmount: amount,
  outAmount: amount,
  otherAmountThreshold: amount,
  inputMint: address,
  outputMint: address,
  setupInstructions: z.array(instruction).nullish(),
  swapInstruction: instruction,
  cleanupInstruction: instruction.nullish(),
  otherInstructions: z.array(instruction).nullish(),
  addressesByLookupTableAddress: z.record(address, z.array(address)),
});
const decode = (ix: z.infer<typeof instruction>) =>
  new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((meta) => ({
      ...meta,
      pubkey: new PublicKey(meta.pubkey),
    })),
    data: Buffer.from(ix.data, "base64"),
  });

/** X2's installed build interface predates B11. Keep this exact-in boundary local. */
export async function jupiterSwap(options: {
  plan: ExecutorPlan;
  signer: PublicKey;
  apiKey: string;
  lookupTable(
    address: PublicKey,
    signal?: AbortSignal,
  ): Promise<AddressLookupTableAccount>;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}): Promise<ExecutorSwap> {
  if (!options.apiKey) throw new Error("executor_jupiter_key_missing");
  const mint = options.plan.snapshot.config.token_mint;
  const url = new URL("/swap/v2/build", MARKET.jupiter.baseUrl);
  for (const [key, value] of Object.entries({
    inputMint: WSOL_MINT,
    outputMint: mint.toBase58(),
    amount: options.plan.amount.toString(),
    taker: options.signer.toBase58(),
    slippageBps: String(executorSlippage(options.plan.kind)),
    wrapAndUnwrapSol: "false",
    destinationTokenAccount: vaultAta(
      options.plan.snapshot.deployment.programId,
      mint,
      EXTERNAL_IDS.splToken,
    ).toBase58(),
    platformFeeBps: "0",
    maxAccounts: String(MARKET.jupiter.buildMaxAccounts),
  }))
    url.searchParams.set(key, value);
  const response = await (options.fetch ?? fetch)(url, {
    headers: { "x-api-key": options.apiKey },
    signal: AbortSignal.any([
      AbortSignal.timeout(SERVICES.transport.rpcTimeoutMs),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
  if (!response.ok) throw new Error("executor_jupiter_unavailable");
  const body = schema.parse(await response.json());
  if (
    body.inAmount !== options.plan.amount ||
    body.inputMint !== WSOL_MINT ||
    body.outputMint !== mint.toBase58()
  )
    throw new Error("executor_jupiter_binding");
  // Lookup table data is read from chain, never fabricated from a provider list.
  const lookupTables = await Promise.all(
    Object.keys(body.addressesByLookupTableAddress).map((value) =>
      options.lookupTable(new PublicKey(value), options.signal),
    ),
  );
  return {
    minOut: body.otherAmountThreshold,
    outAmount: body.outAmount,
    setup: [
      ...(body.otherInstructions ?? []),
      ...(body.setupInstructions ?? []),
    ].map(decode),
    swap: decode(body.swapInstruction),
    cleanup: body.cleanupInstruction ? [decode(body.cleanupInstruction)] : [],
    lookupTables,
  };
}
