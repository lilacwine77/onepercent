import { webDeployment } from "../../data/deployment";
import { TX_LIMITS } from "@onepercent/config";
import {
  FEED_BYTE_BUDGET,
  buildMergeTransactions,
  configPda,
  deckPda,
  machinePda,
  planFeedTransactions,
  serializedSize,
  vaultAuthPda,
  type PlannedFeedBag,
  type BuiltTransaction,
} from "@onepercent/sdk/browser";
import { createCloseAccountInstruction } from "@solana/spl-token";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  PublicKey,
  SIGNATURE_LENGTH_IN_BYTES,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
  type AddressLookupTableAccount,
  type Connection,
} from "@solana/web3.js";
import type { ChainBag, ChainTokenAccount } from "../../data/feed-chain";
import type { AttestedChunk } from "./attest";

export async function readProtocolLut(
  rpc: Connection,
  address: string | null,
): Promise<AddressLookupTableAccount | undefined> {
  if (!address) return undefined;
  try {
    const key = new PublicKey(address);
    const info = await rpc.getAccountInfo(key, "confirmed");
    if (
      !info ||
      info.executable ||
      !info.owner.equals(AddressLookupTableProgram.programId)
    )
      return undefined;
    const { value } = await rpc.getAddressLookupTable(key);
    const expected = [
      configPda(webDeployment().programId)[0],
      machinePda(webDeployment().programId)[0],
      deckPda(webDeployment().programId)[0],
      vaultAuthPda(webDeployment().programId)[0],
      SystemProgram.programId,
      SYSVAR_INSTRUCTIONS_PUBKEY,
    ];
    if (
      !value ||
      value.state.authority ||
      !value.isActive() ||
      expected.some(
        (pubkey) =>
          !value.state.addresses.some((address) => pubkey.equals(address)),
      )
    )
      return undefined;
    return value;
  } catch {
    return undefined;
  }
}
export function plannedBags(bags: readonly ChainBag[]): PlannedFeedBag[] {
  return bags.map((bag) => {
    if (!bag.feedable || bag.decimals === null)
      throw new Error("Unsafe Feed bag");
    return {
      mint: bag.mint,
      amount: bag.amount,
      tokenProgram: bag.tokenProgram,
      decimals: bag.decimals,
      source: bag.source,
      vaultExists: bag.vaultExists,
      closeSource: true,
    };
  });
}
export function mergePlan(wallet: PublicKey, bags: readonly ChainBag[]) {
  return bags.flatMap((bag) => {
    if (!bag.feedable || bag.decimals === null) return [];
    return buildMergeTransactions(
      wallet,
      {
        address: bag.mint,
        decimals: bag.decimals,
        tokenProgram: bag.tokenProgram,
      },
      bag.accounts.map((account) => ({
        address: account.address,
        mint: bag.mint,
        owner: wallet,
        tokenProgram: bag.tokenProgram,
        amount: account.amount,
        closeAuthority: account.closeAuthority,
      })),
      bag.source,
    ).map((transaction, index) => ({
      id: `merge:${bag.mint.toBase58()}:${index}`,
      bag,
      transaction,
    }));
  });
}
export function closePlan(
  wallet: PublicKey,
  accounts: readonly ChainTokenAccount[],
  blockhash: string,
): Transaction[] {
  const result: Transaction[] = [];
  const make = () =>
    new Transaction({ feePayer: wallet, recentBlockhash: blockhash }).add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0n }),
    );
  let current = make();
  for (const account of accounts) {
    if (
      account.amount !== 0n ||
      !account.closable ||
      !account.owner.equals(wallet) ||
      (account.closeAuthority && !account.closeAuthority.equals(wallet))
    )
      throw new Error("Unsafe empty account");
    const ix = createCloseAccountInstruction(
      account.address,
      wallet,
      wallet,
      [],
      account.tokenProgram,
    );
    current.add(ix);
    if (serializedSize(current) > FEED_BYTE_BUDGET) {
      current.instructions.pop();
      result.push(current);
      current = make().add(ix);
    }
  }
  if (current.instructions.length > 2) result.push(current);
  return result;
}
export async function feedChunks(input: {
  wallet: PublicKey;
  bags: readonly PlannedFeedBag[];
  signer: PublicKey;
  nonceBase: number;
  nonceBits: number;
  lut?: AddressLookupTableAccount;
  price: bigint;
  blockhash: string;
}) {
  // Preview the complete selection without reserving the finite nonce window.
  // Only the current approval batch receives real nonces from the intake signer.
  if (
    new Set(input.bags.map((bag) => bag.mint.toBase58())).size !==
    input.bags.length
  )
    throw new Error("Duplicate Feed mint");
  type Chunk = Awaited<ReturnType<typeof planFeedTransactions>>[number];
  const result: Chunk[] = [];
  let current: Chunk | undefined;
  for (const bag of input.bags) {
    const planned = await planFeedTransactions(webDeployment().programId, {
      wallet: input.wallet,
      blockhash: input.blockhash,
      bags: [...(current?.bags ?? []), bag],
      intakeSigner: input.signer,
      nonceBase: 0,
      nonceBits: 0,
      lut: input.lut,
      priorityFeeMicroLamports: input.price,
      attest: () => ({
        expiry: 0n,
        signature: new Uint8Array(SIGNATURE_LENGTH_IN_BYTES),
      }),
    });
    if (planned.length > 1) result.push(planned[0]!);
    current = planned.at(-1);
  }
  if (current) result.push(current);
  return result;
}
export async function buildAttested(input: {
  wallet: PublicKey;
  signer: PublicKey;
  attestation: AttestedChunk;
  lut?: AddressLookupTableAccount;
  price: bigint;
  blockhash: string;
}): Promise<BuiltTransaction> {
  const plans = await planFeedTransactions(webDeployment().programId, {
    wallet: input.wallet,
    blockhash: input.blockhash,
    bags: input.attestation.bags,
    intakeSigner: input.signer,
    nonceBase: input.attestation.nonce,
    nonceBits: 0,
    lut: input.lut,
    priorityFeeMicroLamports: input.price,
    attest: ({ bags, nonce }) => {
      if (
        nonce !== input.attestation.nonce ||
        bags.length !== input.attestation.bags.length
      )
        throw new Error("Signed chunk no longer fits");
      return input.attestation;
    },
  });
  if (plans.length !== 1) throw new Error("Signed chunk must be atomic");
  return plans[0]!.transaction;
}
export const approvalCount = (transactions: number, batchSize: number) =>
  Math.ceil(transactions / Math.min(batchSize, TX_LIMITS.txPerSignAll));
