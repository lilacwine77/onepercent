import { quoteLog, type Database } from "@onepercent/db";
import { SERVICES, TX_LIMITS } from "@onepercent/config";
import {
  createExitCapClient,
  createJupiterSwapClient,
  createValueClient,
  type ChainRpc,
  type MarketEnv,
  type MarketLogger,
  type ValueNow,
} from "@onepercent/market";
import type { JsonRpcClient } from "@onepercent/service-kit";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import {
  decodeBinder,
  decodeMachine,
  decodeQuoteConfig,
  type QuoteState,
} from "./draft-sdk.js";
import {
  base64Schema,
  publicKeySchema,
  timestampSchema,
  u16Schema,
  u32Schema,
  u64Schema,
} from "./schema.js";
import type { QuoteLogRow } from "./service.js";

const accountSchema = z
  .object({
    owner: publicKeySchema,
    executable: z.boolean(),
    data: z.tuple([base64Schema, z.literal("base64")]),
  })
  .passthrough();
const stateResponseSchema = z
  .object({
    context: z.object({ slot: timestampSchema }).passthrough(),
    value: z.tuple([
      accountSchema.nullable(),
      accountSchema.nullable(),
      accountSchema.nullable(),
    ]),
  })
  .passthrough();

export function createQuoteStateReader(
  rpc: Pick<JsonRpcClient, "request">,
  programId: PublicKey,
): (owner: PublicKey) => Promise<QuoteState> {
  const [machine, machineBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("machine")],
    programId,
  );
  // Preserve the role's account validation and string-key projections.
  const [config, configBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  );
  return async (owner) => {
    const [binder, binderBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("binder"), owner.toBuffer()],
      programId,
    );
    const response = await rpc.request(
      "getMultipleAccounts",
      [
        [config.toBase58(), machine.toBase58(), binder.toBase58()],
        { commitment: "confirmed", encoding: "base64" },
      ],
      stateResponseSchema,
    );
    const [configAccount, machineAccount, binderAccount] = response.value;
    if (
      !configAccount ||
      !machineAccount ||
      !binderAccount ||
      [configAccount, machineAccount, binderAccount].some(
        (account) =>
          account.owner !== programId.toBase58() || account.executable,
      )
    )
      throw new Error("chain_unavailable");
    const configData = Buffer.from(configAccount.data[0], "base64"),
      machineData = Buffer.from(machineAccount.data[0], "base64"),
      binderData = Buffer.from(binderAccount.data[0], "base64");
    if (
      configData[737] !== configBump ||
      machineData[9] !== machineBump ||
      binderData[110] !== binderBump
    )
      throw new Error("chain_unavailable");
    const state = {
      asOfSlot: response.context.slot,
      ...decodeQuoteConfig(configData),
      machine: decodeMachine(machineData),
      binder: decodeBinder(binderData),
    };
    if (state.binder.owner !== owner.toBase58())
      throw new Error("chain_unavailable");
    return state;
  };
}

/** This instance is constructed in the quote role using its own provider credentials. */
export function createQuoteValueClient(options: {
  env: MarketEnv;
  fetch: typeof fetch;
  rpc: Pick<JsonRpcClient, "request">;
  logger?: MarketLogger;
}): ValueNow {
  if (!options.env.jupiterApiKey?.trim())
    throw new Error("quote_jupiter_key_unavailable");
  const swap = createJupiterSwapClient(options);
  const rpc: ChainRpc = {
    call: (schema, method, params) =>
      options.rpc.request(method, params, schema),
  };
  const cap = createExitCapClient({ ...options, rpc });
  let failures = 0;
  let openUntil = 0;
  return createValueClient({
    async quoteSell(mint, amount) {
      if (performance.now() < openUntil)
        throw new Error("quote_provider_unavailable");
      try {
        const quote = await swap.quoteSell(mint, amount);
        failures = 0;
        openUntil = 0;
        return quote;
      } catch (error) {
        if (++failures >= SERVICES.transport.breakerFailureThreshold)
          openUntil =
            performance.now() + SERVICES.transport.breakerOpenSeconds * 1000;
        throw error;
      }
    },
    getExitCap: (mint) => cap.getExitCap(mint),
  }).valueNow;
}

export function createQuoteLogWriter(
  db: Pick<Database, "insert">,
): (row: QuoteLogRow) => Promise<void> {
  return async (row) => {
    const validated = quoteLogRowSchema.parse(row);
    // The message is the immutable natural key. Retries only attempt another insert.
    await db
      .insert(quoteLog)
      .values({ ...validated, nonce: BigInt(validated.nonce) })
      .onConflictDoNothing({ target: quoteLog.messageSha256 });
  };
}

const quoteLogRowSchema = z
  .object({
    messageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    owner: publicKeySchema,
    mint: publicKeySchema,
    cardIndices: z.array(u16Schema).min(1).max(TX_LIMITS.redeemPerTx),
    amounts: z.array(u64Schema).min(1).max(TX_LIMITS.redeemPerTx),
    totalAmount: u64Schema,
    quoteLamports: u64Schema,
    valueLamports: u64Schema,
    payoutLamports: u64Schema,
    expiry: z.date(),
    nonce: u32Schema,
    router: z.string(),
    requestId: z.string(),
    signer: publicKeySchema,
    ipHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine(
    (row) =>
      row.cardIndices.length === row.amounts.length &&
      row.cardIndices.every(
        (index, position) =>
          position === 0 || index < row.cardIndices[position - 1]!,
      ) &&
      row.amounts.reduce((sum, amount) => sum + amount, 0n) === row.totalAmount,
  );
