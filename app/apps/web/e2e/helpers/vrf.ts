import { PROGRAM_ID } from "../../../../packages/sdk/tests/program-id.js";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import {
  ComputeBudgetProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
  type Keypair,
  type PublicKey,
} from "@solana/web3.js";
import {
  consumeRandomnessInstruction,
  fetchPull,
  EXTERNAL_IDS,
  scopedVrfIdentity,
} from "@onepercent/sdk";
/** Chosen test randomness is only accepted by the local mock VRF program. */
export async function fulfillLocal(
  rpc: Connection,
  signer: Keypair,
  queue: PublicKey,
  pull: PublicKey,
  requestIndex: number,
  randomness: Uint8Array,
) {
  assert.equal(new URL(rpc.rpcEndpoint).hostname, "127.0.0.1");
  const pending = await fetchPull(PROGRAM_ID, rpc, pull);
  assert(pending?.status === 1);
  const callback = consumeRandomnessInstruction(PROGRAM_ID, {
    pull,
    buyer: signer.publicKey,
    seq: pending.seq,
    randomness,
  });
  const data = Buffer.alloc(37);
  data[0] = 0xf0;
  data.writeUInt32LE(requestIndex, 1);
  data.set(randomness, 5);
  const transaction = new Transaction({
    feePayer: signer.publicKey,
    recentBlockhash: (await rpc.getLatestBlockhash("confirmed")).blockhash,
  }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    new TransactionInstruction({
      programId: EXTERNAL_IDS.magicblockVrf,
      data,
      keys: [
        { pubkey: queue, isSigner: false, isWritable: true },
        {
          pubkey: scopedVrfIdentity(PROGRAM_ID)[0],
          isSigner: false,
          isWritable: false,
        },
        { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
        ...callback.keys.slice(1),
      ],
    }),
  );
  transaction.sign(signer);
  const signature = await rpc.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 0,
  });
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    const result = (await rpc.getSignatureStatuses([signature])).value[0];
    assert(!result?.err, JSON.stringify(result?.err));
    if (
      result?.confirmationStatus === "confirmed" ||
      result?.confirmationStatus === "finalized"
    )
      return signature;
    await delay(100);
  }
  throw new Error("Mock callback did not confirm");
}
