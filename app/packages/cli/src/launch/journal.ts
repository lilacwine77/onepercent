import type { ClusterDeployment } from "@onepercent/sdk";
import { verify } from "node:crypto";
import * as namespace from "@anchor-lang/core";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import {
  buildLaunchCandidates,
  DBC_INSTRUCTION_CODER,
  fromMeteoraWire,
  launchLookupAddresses,
} from "@onepercent/sdk";
import { z } from "zod";
import { OpsError } from "../input.js";
import { checkLaunchLookupTable } from "./checks.js";
import type { LaunchAttempt } from "./send.js";

const anchor =
  (Reflect.get(namespace, "default") as typeof namespace | undefined) ??
  namespace;
const metadataSchema = z.object({
  params: z.object({ name: z.string(), symbol: z.string(), uri: z.string() }),
});
const ed25519SpkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
const requireJournal = (condition: boolean, code: string) => {
  if (!condition) throw new OpsError(code);
};

/** Bind persisted signatures to the current identities and the complete launch intent. */
export async function validateLaunchAttemptIdentity(
  connection: Pick<Connection, "getAccountInfoAndContext">,
  attempt: LaunchAttempt,
  input: {
    deployment: ClusterDeployment;
    wallet: PublicKey;
    mint: PublicKey;
    lookupTable: PublicKey;
    tipRecipient: PublicKey;
  },
): Promise<void> {
  requireJournal(
    attempt.form === "single" &&
      attempt.signatures.length === 1 &&
      attempt.encodedTransactions.length === 1,
    "launch_journal_invalid",
  );
  try {
    const tx = VersionedTransaction.deserialize(
      Buffer.from(attempt.encodedTransactions[0]!, "base64"),
    );
    requireJournal(
      tx.message.version === 0 &&
        tx.message.header.numRequiredSignatures === 2 &&
        tx.signatures.length === 2 &&
        tx.message.staticAccountKeys[0]!.equals(input.wallet) &&
        tx.message.staticAccountKeys[1]!.equals(input.mint) &&
        tx.message.addressTableLookups.length === 1 &&
        tx.message.addressTableLookups[0]!.accountKey.equals(input.lookupTable),
      "launch_journal_identity_mismatch",
    );
    requireJournal(
      anchor.utils.bytes.bs58.encode(tx.signatures[0]!) ===
        attempt.signatures[0],
      "launch_journal_signature_mismatch",
    );
    const message = Buffer.from(tx.message.serialize());
    for (const [index, signer] of [input.wallet, input.mint].entries())
      requireJournal(
        verify(
          null,
          message,
          {
            key: Buffer.concat([ed25519SpkiPrefix, signer.toBuffer()]),
            format: "der",
            type: "spki",
          },
          tx.signatures[index]!,
        ),
        "launch_journal_signature_invalid",
      );
    const observed = await connection.getAccountInfoAndContext(
      input.lookupTable,
      {
        commitment: "finalized",
      },
    );
    requireJournal(
      observed.value !== null &&
        observed.value.owner.equals(AddressLookupTableProgram.programId) &&
        !observed.value.executable,
      "launch_journal_lookup_owner",
    );
    const table = new AddressLookupTableAccount({
      key: input.lookupTable,
      state: AddressLookupTableAccount.deserialize(observed.value!.data),
    });
    const expectedOptions = {
      deployment: input.deployment,
      wallet: input.wallet,
      mint: input.mint,
      name: "Rehearsal",
      symbol: "TEST",
      uri: "https://example.invalid/launch.json",
      maxSolCost: 1n,
      blockhash: tx.message.recentBlockhash,
      computeUnitLimit: 1,
      computeUnitPriceMicroLamports: 0n,
      tip: { recipient: input.tipRecipient, lamports: 0n },
    };
    checkLaunchLookupTable({
      table,
      expectedAddresses: launchLookupAddresses(expectedOptions),
      currentSlot: observed.context.slot,
    });
    const decompiled = TransactionMessage.decompile(tx.message, {
      addressLookupTableAccounts: [table],
    });
    const instructions = decompiled.instructions;
    const noTip = input.deployment.cluster === "devnet";
    requireJournal(
      instructions.length === (noTip ? 13 : 14),
      "launch_journal_instruction_count",
    );
    const creation = DBC_INSTRUCTION_CODER.decode(instructions[2]!.data);
    requireJournal(
      creation?.name === "initialize_virtual_pool_with_spl_token",
      "launch_journal_creation_instruction",
    );
    const metadata = metadataSchema.parse(
      fromMeteoraWire(creation!.data),
    ).params;
    requireJournal(
      instructions[0]!.data.length === 5 &&
        instructions[1]!.data.length === 9 &&
        instructions[5]!.data.length === 12 &&
        (noTip || instructions[13]!.data.length === 12),
      "launch_journal_instruction_layout",
    );
    // Decode variable values from the signed bytes, then reconstruct every account,
    // program, discriminator and amount from the current launch identity. This also
    // rejects extra instructions and a header edited to name a different DBC config.
    const canonical = buildLaunchCandidates({
      ...expectedOptions,
      ...metadata,
      lookupTable: table,
      computeUnitLimit: instructions[0]!.data.readUInt32LE(1),
      computeUnitPriceMicroLamports: instructions[1]!.data.readBigUInt64LE(1),
      maxSolCost: instructions[5]!.data.readBigUInt64LE(4),
      tip: {
        recipient: input.tipRecipient,
        lamports: noTip ? 0n : instructions[13]!.data.readBigUInt64LE(4),
      },
    });
    requireJournal(
      canonical.singleFits &&
        message.equals(Buffer.from(canonical.single.message.serialize())),
      "launch_journal_message_mismatch",
    );
  } catch (error) {
    if (error instanceof OpsError) throw error;
    throw new OpsError("launch_journal_invalid");
  }
}
