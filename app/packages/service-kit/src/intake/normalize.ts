import { SystemProgram } from "@solana/web3.js";
import { PROGRAM_IDS, WSOL_MINT } from "@onepercent/config";
import { TOKEN_2022_NATIVE_MINT } from "./constants.js";
import { z } from "zod";
import {
  EvidenceUnavailableError,
  type IntakeTokenBalance,
  type IntakeTransaction,
} from "./types.js";

const integer = z.number().int().nonnegative().safe();
const amount = z.union([
  integer.transform((value) => BigInt(value)),
  z
    .string()
    .regex(/^\d+$/)
    .transform((value) => BigInt(value)),
]);
const tokenBalance = z.object({
  accountIndex: integer,
  owner: z.string().min(1),
  mint: z.string().min(1),
  uiTokenAmount: z.object({ amount: z.string().regex(/^\d+$/) }),
});
const instruction = z.object({
  programId: z.string().optional(),
  programIdIndex: integer.optional(),
  parsed: z.unknown().optional(),
});
const historyEnvelope = z.object({
  slot: integer,
  transaction: z.object({ signatures: z.array(z.string().min(1)).min(1) }),
  meta: z.object({ err: z.unknown() }),
});
const schema = z.object({
  slot: integer,
  transactionIndex: integer.nullable().optional(),
  blockTime: integer.nullable(),
  transaction: z.object({
    signatures: z.array(z.string().min(1)).min(1),
    message: z.object({
      accountKeys: z
        .array(
          z.union([
            z.string().min(1),
            z.object({ pubkey: z.string().min(1), signer: z.boolean() }),
          ]),
        )
        .min(1),
      header: z.object({ numRequiredSignatures: integer }).optional(),
      instructions: z.array(instruction),
    }),
  }),
  meta: z.object({
    err: z.unknown(),
    fee: amount,
    preBalances: z.array(amount),
    postBalances: z.array(amount),
    preTokenBalances: z.array(tokenBalance),
    postTokenBalances: z.array(tokenBalance),
    innerInstructions: z.array(
      z.object({ instructions: z.array(instruction) }),
    ),
    loadedAddresses: z
      .object({
        writable: z.array(z.string()),
        readonly: z.array(z.string()),
      })
      .optional(),
  }),
});

export interface CreatedAccountRentRequest {
  payer: string;
  account: string;
  space: number;
  funding: bigint;
  slot: number;
  /** The observed token owner; null when history cannot establish ownership. */
  tokenOwner: string | null;
}

export interface NormalizeHistoryOptions {
  /** Exact rent paid, established from chain evidence; never a fixed rent rate. */
  rentForCreatedAccount?: (
    creation: CreatedAccountRentRequest,
  ) => bigint | null;
}

/**
 * Accept Helius full jsonParsed transactions, with all inner instructions.
 * Unresolved creation funding is retained as a conservative rent upper bound.
 */
export function normalizeHistoryTransaction(
  raw: unknown,
  options: NormalizeHistoryOptions = {},
): IntakeTransaction | null {
  const envelope = historyEnvelope.safeParse(raw);
  if (!envelope.success || envelope.data.meta.err === undefined)
    throw new EvidenceUnavailableError();
  // Failed transactions have no committed token effects. RPC may omit their
  // balance and inner-instruction metadata, so only successes require it.
  if (envelope.data.meta.err !== null) return null;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new EvidenceUnavailableError();
  const tx = parsed.data;
  const message = tx.transaction.message;
  const rawKeys = message.accountKeys;
  const keys = rawKeys.map((key) =>
    typeof key === "string" ? key : key.pubkey,
  );
  const parsedKeys = rawKeys.every((key) => typeof key !== "string");
  if (!parsedKeys && rawKeys.some((key) => typeof key !== "string"))
    throw new EvidenceUnavailableError();
  if (!parsedKeys && tx.meta.loadedAddresses) {
    keys.push(
      ...tx.meta.loadedAddresses.writable,
      ...tx.meta.loadedAddresses.readonly,
    );
  }
  const required = message.header?.numRequiredSignatures;
  if (!parsedKeys && (required === undefined || required > rawKeys.length))
    throw new EvidenceUnavailableError();
  const signers = rawKeys.flatMap((key, index) =>
    typeof key === "string"
      ? index < (required ?? 0)
        ? [key]
        : []
      : key.signer
        ? [key.pubkey]
        : [],
  );
  const feePayer = keys[0];
  if (
    !feePayer ||
    !signers.includes(feePayer) ||
    new Set(keys).size !== keys.length ||
    tx.meta.preBalances.length !== keys.length ||
    tx.meta.postBalances.length !== keys.length
  )
    throw new EvidenceUnavailableError();
  const balances = (
    rows: z.infer<typeof tokenBalance>[],
  ): IntakeTokenBalance[] => {
    const seen = new Set<number>();
    return rows.map((row) => {
      const account = keys[row.accountIndex];
      if (!account || seen.has(row.accountIndex))
        throw new EvidenceUnavailableError();
      seen.add(row.accountIndex);
      return {
        account,
        accountIndex: row.accountIndex,
        owner: row.owner,
        mint: row.mint,
        amount: BigInt(row.uiTokenAmount.amount),
      };
    });
  };
  const preTokenBalances = balances(tx.meta.preTokenBalances);
  const postTokenBalances = balances(tx.meta.postTokenBalances);
  const creationCosts = new Map<
    string,
    { rent: bigint; unresolvedFunding: bigint }
  >();
  const instructions = [
    ...message.instructions,
    ...tx.meta.innerInstructions.flatMap((group) => group.instructions),
  ];
  const systems: { type: string; info: Record<string, unknown> }[] = [];
  const initializedOwners = new Map<string, string>();
  const nativeInitializations = new Map<string, number>();
  const nativeCloses = new Map<string, string[]>();
  for (const ix of instructions) {
    const programId =
      ix.programId ??
      (ix.programIdIndex === undefined ? undefined : keys[ix.programIdIndex]);
    if (!programId) throw new EvidenceUnavailableError();
    if (
      programId === PROGRAM_IDS.splToken ||
      programId === PROGRAM_IDS.token2022
    ) {
      const token = z
        .object({ type: z.string(), info: z.unknown() })
        .safeParse(ix.parsed);
      if (
        token.success &&
        [
          "initializeAccount",
          "initializeAccount2",
          "initializeAccount3",
        ].includes(token.data.type)
      ) {
        const initialization = z
          .object({ account: z.string().min(1), owner: z.string().min(1) })
          .safeParse(token.data.info);
        if (
          !initialization.success ||
          !keys.includes(initialization.data.account)
        )
          throw new EvidenceUnavailableError();
        const { account, owner } = initialization.data;
        const previous = initializedOwners.get(account);
        const postOwner = postTokenBalances.find(
          (row) => row.account === account,
        )?.owner;
        if (
          (previous !== undefined && previous !== owner) ||
          (postOwner !== undefined && postOwner !== owner)
        )
          throw new EvidenceUnavailableError();
        initializedOwners.set(account, owner);
        const nativeMint =
          programId === PROGRAM_IDS.splToken
            ? WSOL_MINT
            : TOKEN_2022_NATIVE_MINT;
        if (
          z.object({ mint: z.literal(nativeMint) }).safeParse(token.data.info)
            .success
        )
          nativeInitializations.set(
            account,
            (nativeInitializations.get(account) ?? 0) + 1,
          );
      }
      if (token.success && token.data.type === "closeAccount") {
        const close = z
          .object({
            account: z.string().min(1),
            destination: z.string().min(1),
          })
          .safeParse(token.data.info);
        if (!close.success) throw new EvidenceUnavailableError();
        const destinations = nativeCloses.get(close.data.account) ?? [];
        destinations.push(close.data.destination);
        nativeCloses.set(close.data.account, destinations);
      }
    }
    if (programId !== SystemProgram.programId.toBase58()) continue;
    const system = z
      .object({ type: z.string(), info: z.record(z.string(), z.unknown()) })
      .safeParse(ix.parsed);
    if (!system.success) throw new EvidenceUnavailableError();
    systems.push(system.data);
  }
  const allocated = new Set<string>();
  const created = new Set<string>();
  for (const system of systems) {
    if (
      ![
        "createAccount",
        "createAccountWithSeed",
        "transfer",
        "transferWithSeed",
        "allocate",
        "allocateWithSeed",
        "assign",
        "assignWithSeed",
        "advanceNonce",
        "withdrawFromNonce",
        "initializeNonce",
        "authorizeNonce",
        "upgradeNonce",
      ].includes(system.type)
    )
      throw new EvidenceUnavailableError();
    if (system.type === "allocate" || system.type === "allocateWithSeed") {
      const account = z.string().safeParse(system.info.account);
      if (!account.success) throw new EvidenceUnavailableError();
      allocated.add(account.data);
    }
    if (
      system.type !== "createAccount" &&
      system.type !== "createAccountWithSeed"
    )
      continue;
    const creation = z
      .object({
        source: z.string(),
        newAccount: z.string(),
        lamports: amount,
        space: integer,
      })
      .safeParse(system.info);
    if (!creation.success) throw new EvidenceUnavailableError();
    const { source, newAccount, lamports: funding, space } = creation.data;
    if (!keys.includes(source) || !keys.includes(newAccount))
      throw new EvidenceUnavailableError();
    created.add(newAccount);
    const tokenOwner =
      initializedOwners.get(newAccount) ??
      postTokenBalances.find((row) => row.account === newAccount)?.owner ??
      null;
    const accountIndex = keys.indexOf(newAccount);
    const closedTo = nativeCloses.get(newAccount);
    if (
      tokenOwner === source &&
      nativeInitializations.get(newAccount) === 1 &&
      closedTo?.length === 1 &&
      closedTo[0] === source &&
      tx.meta.preBalances[accountIndex] === 0n &&
      tx.meta.postBalances[accountIndex] === 0n &&
      systems.filter(
        (item) =>
          (item.type === "createAccount" ||
            item.type === "createAccountWithSeed") &&
          item.info.newAccount === newAccount,
      ).length === 1
    )
      continue; // D22: returned native-account rent is already absent from net spending.
    // Funding an account provably owned by someone else is value spent, not
    // rent of an account created for the paying wallet.
    if (tokenOwner !== null && tokenOwner !== source) continue;
    const knownRent =
      options.rentForCreatedAccount?.({
        payer: source,
        account: newAccount,
        funding,
        space,
        slot: tx.slot,
        tokenOwner,
      }) ?? null;
    if (knownRent !== null && (knownRent < 0n || knownRent > funding))
      throw new EvidenceUnavailableError();
    const current = creationCosts.get(source) ?? {
      rent: 0n,
      unresolvedFunding: 0n,
    };
    // Only known wallet-owned creations can subtract exact rent. Unknown owners
    // remain an upper bound, so funding them cannot incorrectly prove a purchase.
    if (knownRent !== null && tokenOwner === source) current.rent += knownRent;
    else current.unresolvedFunding += funding;
    creationCosts.set(source, current);
  }
  // Existing, prefunded system accounts can become token accounts through
  // transfer + allocate + assign instead of createAccount (including inner CPI).
  for (const system of systems) {
    if (system.type !== "transfer" && system.type !== "transferWithSeed")
      continue;
    const transfer = z
      .object({ source: z.string(), destination: z.string(), lamports: amount })
      .safeParse(system.info);
    if (!transfer.success) throw new EvidenceUnavailableError();
    const { source, destination, lamports } = transfer.data;
    if (!allocated.has(destination) || created.has(destination)) continue;
    const current = creationCosts.get(source) ?? {
      rent: 0n,
      unresolvedFunding: 0n,
    };
    current.unresolvedFunding += lamports;
    creationCosts.set(source, current);
  }
  return {
    signature: tx.transaction.signatures[0]!,
    slot: tx.slot,
    transactionIndex: tx.transactionIndex ?? null,
    blockTime: tx.blockTime,
    signers,
    feePayer,
    fee: tx.meta.fee,
    preTokenBalances,
    postTokenBalances,
    lamports: new Map(
      keys.map((key, index) => [
        key,
        {
          pre: tx.meta.preBalances[index]!,
          post: tx.meta.postBalances[index]!,
        },
      ]),
    ),
    creationCosts,
  };
}
