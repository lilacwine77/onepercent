import * as namespace from "@anchor-lang/core";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import { OpsError } from "../input.js";
import type { LaunchAttempt } from "./send.js";

const anchor =
  (Reflect.get(namespace, "default") as typeof namespace | undefined) ??
  namespace;
type EvidenceConnection = Pick<
  Connection,
  "getSignatureStatuses" | "getTransaction" | "getAccountInfoAndContext"
>;
const requireEvidence = (condition: boolean, code: string) => {
  if (!condition) throw new OpsError(code);
};

/** Bind the published transaction and LUT to the message finalized on chain. */
export async function verifyLandedLaunchEvidence(
  connection: EvidenceConnection,
  attempt: LaunchAttempt,
  lookupTable: PublicKey,
) {
  requireEvidence(attempt.form === "single", "launch_evidence_form");
  requireEvidence(
    attempt.signatures.length === 1 && attempt.encodedTransactions.length === 1,
    "launch_evidence_signature_count",
  );
  const status = await connection.getSignatureStatuses(attempt.signatures, {
    searchTransactionHistory: true,
  });
  requireEvidence(
    Number.isSafeInteger(status.context.slot) &&
      status.context.slot >= 0 &&
      status.value.length === 1 &&
      status.value.every(
        (value) =>
          value !== null &&
          value.err === null &&
          value.confirmationStatus === "finalized" &&
          Number.isSafeInteger(value.slot) &&
          value.slot >= 0,
      ),
    "launch_signature_not_finalized",
  );
  const landedSlot = status.value[0]!.slot;
  const usedTableIndexes = new Set<number>();
  const signed = VersionedTransaction.deserialize(
    Buffer.from(attempt.encodedTransactions[0]!, "base64"),
  );
  requireEvidence(
    signed.message.version === 0 &&
      signed.message.addressTableLookups.length === 1 &&
      signed.message.addressTableLookups[0]!.accountKey.equals(lookupTable),
    "launch_lookup_table_provenance",
  );
  const lookup = signed.message.addressTableLookups[0]!;
  for (const position of [...lookup.writableIndexes, ...lookup.readonlyIndexes])
    usedTableIndexes.add(position);
  const publicSignatures = signed.signatures.map((signature) =>
    anchor.utils.bytes.bs58.encode(signature),
  );
  requireEvidence(
    publicSignatures[0] === attempt.signatures[0],
    "launch_journal_signature_mismatch",
  );
  const finalized = await connection.getTransaction(attempt.signatures[0]!, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  requireEvidence(
    finalized !== null &&
      finalized.meta !== null &&
      finalized.meta.err === null &&
      finalized.slot === landedSlot,
    "launch_finalized_transaction_unavailable",
  );
  requireEvidence(
    finalized!.transaction.message.version === 0 &&
      Buffer.from(finalized!.transaction.message.serialize()).equals(
        Buffer.from(signed.message.serialize()),
      ),
    "launch_finalized_message_mismatch",
  );
  requireEvidence(
    finalized!.transaction.signatures.length === publicSignatures.length &&
      finalized!.transaction.signatures.every(
        (signature, position) => signature === publicSignatures[position],
      ),
    "launch_finalized_signatures_mismatch",
  );
  // Signature status response context is not a finalized bank. Only the
  // transaction slot proven finalized is a valid floor for this finalized read.
  const observed = await connection.getAccountInfoAndContext(lookupTable, {
    commitment: "finalized",
    minContextSlot: landedSlot,
  });
  requireEvidence(
    observed.context.slot >= landedSlot &&
      observed.value !== null &&
      observed.value.owner.equals(AddressLookupTableProgram.programId) &&
      !observed.value.executable,
    "launch_lookup_table_account_invalid",
  );
  const table = new AddressLookupTableAccount({
    key: lookupTable,
    state: AddressLookupTableAccount.deserialize(observed.value!.data),
  });
  requireEvidence(
    table.isActive() && table.state.authority === undefined,
    "launch_lookup_table_not_frozen_active",
  );
  requireEvidence(
    Number.isSafeInteger(table.state.lastExtendedSlot) &&
      table.state.lastExtendedSlot < landedSlot,
    "launch_lookup_table_not_warmed_at_landing",
  );
  requireEvidence(
    table.state.addresses.length === usedTableIndexes.size &&
      table.state.addresses.every((_, index) => usedTableIndexes.has(index)) &&
      new Set(table.state.addresses.map(String)).size ===
        table.state.addresses.length,
    "launch_lookup_table_contains_unreferenced_or_duplicate_addresses",
  );
  return {
    landedSlot,
    lookupTable: table,
    observedSlot: observed.context.slot,
    signatures: attempt.signatures,
  };
}
