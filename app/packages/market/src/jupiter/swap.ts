import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { z } from "zod";
import { defaultClock } from "../clock.js";
import { MarketError } from "../errors.js";
import { HTTP_STATUS } from "../http/status.js";
import {
  BPS_DENOMINATOR,
  JUPITER_BUILD_MAX_ACCOUNTS,
  MARKET,
  U64_MAX,
  WSOL_MINT,
} from "../params.js";
import {
  jupiterHeaders,
  jupiterHttp,
  validateMints,
  type JupiterClientOptions,
} from "./price.js";

const amountSchema = z
  .string()
  .regex(/^\d+$/)
  .transform(BigInt)
  .pipe(z.bigint().nonnegative().max(U64_MAX));
const publicKeySchema = z.string().refine((value) => {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
});
const decimalSchema = z
  .union([
    z.number().finite(),
    z.string().regex(/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i),
  ])
  .transform(String);
const orderSchema = z
  .object({
    inAmount: amountSchema,
    outAmount: amountSchema,
    otherAmountThreshold: amountSchema,
    inputMint: publicKeySchema.optional(),
    outputMint: publicKeySchema.optional(),
    swapMode: z.literal("ExactIn").optional(),
    router: z.string(),
    requestId: z.string(),
    feeBps: z.number().int().nonnegative().max(BPS_DENOMINATOR),
    priceImpact: decimalSchema,
    routePlan: z.array(z.unknown()),
  })
  .passthrough();

export interface SwapQuote {
  inAmount: bigint;
  outAmount: bigint;
  minOut: bigint;
  router: string;
  requestId: string;
  feeBps: number;
  priceImpact: string;
  fetchedAtMs: number;
}
export interface SwapQuoteInput {
  inputMint: string;
  outputMint: string;
  amount: bigint;
  excludeRouters?: readonly string[];
}
export const swapInstructionSchema = z
  .object({
    programId: publicKeySchema,
    accounts: z.array(
      z
        .object({
          pubkey: publicKeySchema,
          isSigner: z.boolean(),
          isWritable: z.boolean(),
        })
        .passthrough(),
    ),
    data: z
      .string()
      .refine(
        (data) =>
          /^[A-Za-z\d+/]*={0,2}$/.test(data) &&
          Buffer.from(data, "base64").toString("base64").replace(/=+$/, "") ===
            data.replace(/=+$/, ""),
      ),
  })
  .passthrough();
export type SwapInstruction = z.infer<typeof swapInstructionSchema>;
const buildSchema = z
  .object({
    computeBudgetInstructions: z.array(swapInstructionSchema).nullish(),
    setupInstructions: z.array(swapInstructionSchema).nullish(),
    swapInstruction: swapInstructionSchema,
    cleanupInstruction: swapInstructionSchema.nullish(),
    otherInstructions: z.array(swapInstructionSchema).nullish(),
    addressesByLookupTableAddress: z.record(
      publicKeySchema,
      z.array(publicKeySchema),
    ),
    inAmount: amountSchema,
    outAmount: amountSchema,
    otherAmountThreshold: amountSchema,
    inputMint: publicKeySchema.optional(),
    outputMint: publicKeySchema.optional(),
    swapMode: z.literal("ExactIn").optional(),
  })
  .passthrough();
export interface SwapBuildInput extends Omit<SwapQuoteInput, "excludeRouters"> {
  taker: string;
  wrapAndUnwrapSol?: boolean;
  slippageBps: number;
  maxAccounts?: number;
  destinationTokenAccount?: string;
  nativeDestinationAccount?: string;
  payer?: string;
}
export interface SwapBuild {
  computeBudgetInstructions: SwapInstruction[];
  setupInstructions: SwapInstruction[];
  swapInstruction: SwapInstruction;
  cleanupInstruction: SwapInstruction | null;
  otherInstructions: SwapInstruction[];
  lookupTables: Record<string, string[]>;
  inAmount: bigint;
  outAmount: bigint;
  minOut: bigint;
}
export interface JupiterSwapClient {
  quote(input: SwapQuoteInput): Promise<SwapQuote>;
  quoteSell(mint: string, amount: bigint): Promise<SwapQuote>;
  quoteBuy(mint: string, lamports: bigint): Promise<SwapQuote>;
  build(input: SwapBuildInput): Promise<SwapBuild>;
}

function validateQuote(input: SwapQuoteInput): void {
  validateMints([input.inputMint, input.outputMint]);
  if (
    typeof input.amount !== "bigint" ||
    input.amount <= 0n ||
    input.amount > U64_MAX
  ) {
    throw new MarketError("INVALID_INPUT", {
      message: "Swap amount must be a positive u64",
    });
  }
}

export function toTransactionInstruction(
  input: SwapInstruction,
): TransactionInstruction {
  const result = swapInstructionSchema.safeParse(input);
  if (!result.success)
    throw new MarketError("PROVIDER_SCHEMA", { provider: "jupiter" });
  return new TransactionInstruction({
    programId: new PublicKey(result.data.programId),
    keys: result.data.accounts.map((account) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Buffer.from(result.data.data, "base64"),
  });
}

export function createJupiterSwapClient(
  opts: JupiterClientOptions,
): JupiterSwapClient {
  const http = jupiterHttp(opts);
  const clock = opts.clock ?? defaultClock;
  async function quote(input: SwapQuoteInput): Promise<SwapQuote> {
    validateQuote(input);
    const url = new URL("/swap/v2/order", MARKET.jupiter.baseUrl);
    url.searchParams.set("inputMint", input.inputMint);
    url.searchParams.set("outputMint", input.outputMint);
    url.searchParams.set("amount", input.amount.toString());
    url.searchParams.set("swapMode", "ExactIn");
    if (input.excludeRouters?.length)
      url.searchParams.set("excludeRouters", input.excludeRouters.join(","));
    try {
      const response = await http.fetchJson(orderSchema, {
        url: url.href,
        headers: jupiterHeaders(opts.env),
      });
      if (
        response.inAmount !== input.amount ||
        (response.inputMint !== undefined &&
          response.inputMint !== input.inputMint) ||
        (response.outputMint !== undefined &&
          response.outputMint !== input.outputMint)
      )
        throw new MarketError("PROVIDER_SCHEMA", { provider: "jupiter" });
      return {
        inAmount: response.inAmount,
        outAmount: response.outAmount,
        minOut: response.otherAmountThreshold,
        router: response.router,
        requestId: response.requestId,
        feeBps: response.feeBps,
        priceImpact: response.priceImpact,
        fetchedAtMs: clock.nowMs(),
      };
    } catch (error) {
      if (
        error instanceof MarketError &&
        error.status === HTTP_STATUS.badRequest &&
        error.routeUnavailable
      ) {
        throw new MarketError("NO_ROUTE", {
          provider: "jupiter",
          status: error.status,
        });
      }
      throw error;
    }
  }
  return {
    quote,
    quoteSell: (mint, amount) =>
      quote({ inputMint: mint, outputMint: WSOL_MINT, amount }),
    quoteBuy: (mint, amount) =>
      quote({ inputMint: WSOL_MINT, outputMint: mint, amount }),
    async build(input) {
      validateQuote(input);
      validateMints([
        input.taker,
        ...[
          input.destinationTokenAccount,
          input.nativeDestinationAccount,
          input.payer,
        ].filter((value): value is string => value !== undefined),
      ]);
      const maxAccounts = input.maxAccounts ?? MARKET.jupiter.buildMaxAccounts;
      if (
        !Number.isSafeInteger(input.slippageBps) ||
        input.slippageBps < 0 ||
        input.slippageBps > BPS_DENOMINATOR ||
        !Number.isSafeInteger(maxAccounts) ||
        maxAccounts < 1 ||
        maxAccounts > JUPITER_BUILD_MAX_ACCOUNTS
      ) {
        throw new MarketError("INVALID_INPUT", {
          message: "Invalid swap build bounds",
        });
      }
      const url = new URL("/swap/v2/build", MARKET.jupiter.baseUrl);
      for (const [key, value] of Object.entries({
        inputMint: input.inputMint,
        outputMint: input.outputMint,
        amount: input.amount.toString(),
        taker: input.taker,
        slippageBps: String(input.slippageBps),
        maxAccounts: String(maxAccounts),
        platformFeeBps: "0",
        destinationTokenAccount: input.destinationTokenAccount,
        nativeDestinationAccount: input.nativeDestinationAccount,
        payer: input.payer,
        wrapAndUnwrapSol:
          input.wrapAndUnwrapSol === undefined
            ? undefined
            : String(input.wrapAndUnwrapSol),
      }))
        if (value !== undefined) url.searchParams.set(key, value);
      const response = await http.fetchJson(buildSchema, {
        url: url.href,
        headers: jupiterHeaders(opts.env),
      });
      const floor =
        (response.outAmount * BigInt(BPS_DENOMINATOR - input.slippageBps)) /
        BigInt(BPS_DENOMINATOR);
      if (
        response.inAmount !== input.amount ||
        response.otherAmountThreshold < floor ||
        (response.inputMint !== undefined &&
          response.inputMint !== input.inputMint) ||
        (response.outputMint !== undefined &&
          response.outputMint !== input.outputMint)
      ) {
        throw new MarketError("PROVIDER_SCHEMA", { provider: "jupiter" });
      }
      return {
        computeBudgetInstructions: response.computeBudgetInstructions ?? [],
        setupInstructions: response.setupInstructions ?? [],
        swapInstruction: response.swapInstruction,
        cleanupInstruction: response.cleanupInstruction ?? null,
        otherInstructions: response.otherInstructions ?? [],
        lookupTables: response.addressesByLookupTableAddress,
        inAmount: response.inAmount,
        outAmount: response.outAmount,
        minOut: response.otherAmountThreshold,
      };
    },
  };
}
