import * as namespace from "@anchor-lang/core";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type {
  AccountInfo,
  Connection,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createDeploymentSelector,
  buildLaunchTransaction,
  launchLookupAddresses,
} from "@onepercent/sdk";
import { describe, expect, it, vi } from "vitest";
import { validateLaunchAttemptIdentity } from "./journal.js";
import type { LaunchAttempt } from "./send.js";

const anchor =
  (Reflect.get(namespace, "default") as typeof namespace | undefined) ??
  namespace;
const key = (byte: number) => new PublicKey(Buffer.alloc(32, byte));
function fixture() {
  const wallet = Keypair.fromSeed(Buffer.alloc(32, 7));
  const mint = Keypair.fromSeed(Buffer.alloc(32, 8));
  const input = {
    deployment: createDeploymentSelector({ devnet: key(54) })("devnet"),
    wallet: wallet.publicKey,
    mint: mint.publicKey,
    lookupTable: key(11),
    tipRecipient: key(12),
  };
  const options = {
    ...input,
    lookupTable: undefined,
    name: "Rehearsal",
    symbol: "TEST",
    uri: "https://example.com/coin.json",
    blockhash: key(13).toBase58(),
    maxSolCost: 1_500_000_000n,
    computeUnitLimit: 250_000,
    computeUnitPriceMicroLamports: 10n,
    tip: { recipient: input.tipRecipient, lamports: 0n },
  };
  const addresses = launchLookupAddresses(options);
  const table = new AddressLookupTableAccount({
    key: input.lookupTable,
    state: {
      addresses,
      deactivationSlot: (1n << 64n) - 1n,
      lastExtendedSlot: 50,
      lastExtendedSlotStartIndex: 0,
      authority: undefined,
    },
  });
  const bytes = Buffer.alloc(56 + addresses.length * 32);
  bytes.writeUInt32LE(1);
  bytes.writeBigUInt64LE((1n << 64n) - 1n, 4);
  bytes.writeBigUInt64LE(50n, 12);
  addresses.forEach((address, index) =>
    address.toBuffer().copy(bytes, 56 + index * 32),
  );
  const account: AccountInfo<Buffer> = {
    owner: AddressLookupTableProgram.programId,
    data: bytes,
    lamports: 1_000_000,
    executable: false,
    rentEpoch: 0,
  };
  const getAccountInfoAndContext = vi
    .fn<Connection["getAccountInfoAndContext"]>()
    .mockResolvedValue({ context: { slot: 100 }, value: account });
  const connection = { getAccountInfoAndContext };
  const tx = buildLaunchTransaction({ ...options, lookupTable: table });
  const attemptFor = (transaction: VersionedTransaction): LaunchAttempt => {
    transaction.sign([wallet, mint]);
    return {
      form: "single",
      signatures: [anchor.utils.bytes.bs58.encode(transaction.signatures[0]!)],
      encodedTransactions: [
        Buffer.from(transaction.serialize()).toString("base64"),
      ],
      lastValidBlockHeight: 200,
    };
  };
  const mutate = (fn: (instructions: TransactionInstruction[]) => void) => {
    const message = TransactionMessage.decompile(tx.message, {
      addressLookupTableAccounts: [table],
    });
    fn(message.instructions);
    return attemptFor(
      new VersionedTransaction(message.compileToV0Message([table])),
    );
  };
  return {
    input,
    connection,
    account,
    tx,
    attemptFor,
    attempt: attemptFor(tx),
    mutate,
  };
}

describe("persisted launch identity binding", () => {
  it("accepts the signed canonical message and rereads the exact frozen table at finality", async () => {
    const f = fixture();
    await expect(
      validateLaunchAttemptIdentity(f.connection, f.attempt, f.input),
    ).resolves.toBeUndefined();
    expect(
      f.connection.getAccountInfoAndContext,
    ).toHaveBeenCalledExactlyOnceWith(f.input.lookupTable, {
      commitment: "finalized",
    });
  });
  it("rejects journal replay against an unpinned cluster", async () => {
    const f = fixture();
    await expect(
      validateLaunchAttemptIdentity(f.connection, f.attempt, {
        ...f.input,
        deployment: createDeploymentSelector({ mainnet: key(54) })("mainnet"),
      }),
    ).rejects.toThrow("launch_journal_invalid");
  });
  it.each(["mint", "wallet", "lookupTable"] as const)(
    "rejects changed %s identity",
    async (field) => {
      const f = fixture();
      await expect(
        validateLaunchAttemptIdentity(f.connection, f.attempt, {
          ...f.input,
          [field]: key(90),
        }),
      ).rejects.toThrow("launch_journal_identity_mismatch");
    },
  );
  it("rejects a changed program identity", async () => {
    const f = fixture();
    await expect(
      validateLaunchAttemptIdentity(f.connection, f.attempt, {
        ...f.input,
        deployment: createDeploymentSelector({ devnet: key(90) })("devnet"),
      }),
    ).rejects.toThrow("launch_journal_invalid");
  });
  it("verifies both signatures before any table read", async () => {
    const f = fixture();
    const tx = VersionedTransaction.deserialize(
      Buffer.from(f.attempt.encodedTransactions[0]!, "base64"),
    );
    tx.signatures[1]![0] = tx.signatures[1]![0]! ^ 1;
    f.attempt.encodedTransactions[0] = Buffer.from(tx.serialize()).toString(
      "base64",
    );
    await expect(
      validateLaunchAttemptIdentity(f.connection, f.attempt, f.input),
    ).rejects.toThrow("launch_journal_signature_invalid");
    expect(f.connection.getAccountInfoAndContext).not.toHaveBeenCalled();
  });
  it("rejects an extra signed transfer", async () => {
    const f = fixture();
    const attempt = f.mutate((instructions) =>
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: f.input.wallet,
          toPubkey: key(91),
          lamports: 1,
        }),
      ),
    );
    await expect(
      validateLaunchAttemptIdentity(f.connection, attempt, f.input),
    ).rejects.toThrow("launch_journal_instruction_count");
  });
  it.each(["program", "deposit", "power-on"])(
    "rejects signed %s changes to the canonical launch",
    async (kind) => {
      const f = fixture();
      const attempt = f.mutate((instructions) => {
        if (kind === "program") instructions[11]!.programId = key(91);
        if (kind === "deposit") instructions[10]!.data.writeBigUInt64LE(1n, 1);
        if (kind === "power-on")
          [instructions[11]!.keys[4], instructions[11]!.keys[5]] = [
            instructions[11]!.keys[5]!,
            instructions[11]!.keys[4]!,
          ];
      });
      await expect(
        validateLaunchAttemptIdentity(f.connection, attempt, f.input),
      ).rejects.toThrow("launch_journal_message_mismatch");
    },
  );
  it("rejects a mutable or non-warmed lookup table", async () => {
    const f = fixture();
    f.account.data[21] = 1;
    key(91).toBuffer().copy(f.account.data, 22);
    await expect(
      validateLaunchAttemptIdentity(f.connection, f.attempt, f.input),
    ).rejects.toThrow("launch_journal_invalid");
    f.account.data[21] = 0;
    f.account.data.writeBigUInt64LE(100n, 12);
    await expect(
      validateLaunchAttemptIdentity(f.connection, f.attempt, f.input),
    ).rejects.toThrow("launch_journal_invalid");
  });
  it("rejects a foreign lookup-table owner", async () => {
    const f = fixture();
    f.account.owner = SystemProgram.programId;
    await expect(
      validateLaunchAttemptIdentity(f.connection, f.attempt, f.input),
    ).rejects.toThrow("launch_journal_lookup_owner");
  });
});
