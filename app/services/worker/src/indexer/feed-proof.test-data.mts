import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { PROGRAM_IDS, PUMP_LAYOUTS } from "@onepercent/config";
import { PublicKey } from "@solana/web3.js";
import {
  ledgerAddress,
  singletonAddress,
  TOKEN_PROGRAMS,
  vaultAddress,
} from "./accounts.js";
import type { FeedProofOptions } from "./feed-proof.js";
import type { IndexedTransaction } from "./store.js";

export function encodeFeedInstructionData(bytes: Buffer): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${bytes.toString("hex") || "0"}`);
  let result = "";
  while (value > 0n) {
    result = alphabet[Number(value % 58n)] + result;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = "1" + result;
  }
  return result;
}

export function feedProofFixture(
  input: { count?: number; token2022?: boolean } = {},
) {
  const count = input.count ?? 1;
  const programId = new PublicKey(Buffer.alloc(32, 8)).toBase58();
  const owner = new PublicKey(Buffer.alloc(32, 9)).toBase58();
  const mints = Array.from({ length: count }, (_, index) =>
    new PublicKey(Buffer.alloc(32, 10 + index)).toBase58(),
  );
  const amounts = mints.map((_, index) => BigInt(12 + index));
  const tokenProgram = TOKEN_PROGRAMS[input.token2022 ? 1 : 0];
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signerBytes = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  const signer = new PublicKey(signerBytes).toBase58();
  const expiry = 1_000n;
  const nonce = 3;
  const attestationIxIndex = count;
  const ixIndex = count + 1;
  const feed = Buffer.alloc(25 + count * 8);
  Buffer.from([46, 213, 237, 176, 190, 113, 182, 94]).copy(feed);
  feed.writeUInt32LE(count, 8);
  amounts.forEach((amount, index) =>
    feed.writeBigUInt64LE(amount, 12 + index * 8),
  );
  const tailOffset = 12 + count * 8;
  feed.writeBigInt64LE(expiry, tailOffset);
  feed.writeUInt32LE(nonce, tailOffset + 8);
  feed[tailOffset + 12] = attestationIxIndex;
  const message = Buffer.concat([
    Buffer.from("1PCT-FEED-v1"),
    new PublicKey(programId).toBuffer(),
    new PublicKey(owner).toBuffer(),
    feed.subarray(tailOffset + 8, tailOffset + 12),
    feed.subarray(tailOffset, tailOffset + 8),
    Buffer.from([count]),
    createHash("sha256")
      .update(
        Buffer.concat(
          mints.flatMap((mint, index) => [
            new PublicKey(mint).toBuffer(),
            feed.subarray(12 + index * 8, 20 + index * 8),
          ]),
        ),
      )
      .digest(),
  ]);
  const ed25519 = Buffer.alloc(112 + message.length);
  ed25519[0] = 1;
  ed25519.writeUInt16LE(16, 2);
  ed25519.writeUInt16LE(65_535, 4);
  ed25519.writeUInt16LE(80, 6);
  ed25519.writeUInt16LE(65_535, 8);
  ed25519.writeUInt16LE(112, 10);
  ed25519.writeUInt16LE(message.length, 12);
  ed25519.writeUInt16LE(65_535, 14);
  sign(null, message, privateKey).copy(ed25519, 16);
  signerBytes.copy(ed25519, 80);
  message.copy(ed25519, 112);
  const vaults = mints.map((mint) =>
    vaultAddress(programId, mint, tokenProgram),
  );
  const transfers = mints.map((mint, index) => {
    const data = Buffer.alloc(10);
    data[0] = 12;
    data.writeBigUInt64LE(amounts[index]!, 1);
    data[9] = 6;
    return {
      programId: tokenProgram,
      data: encodeFeedInstructionData(data),
      accounts: [
        new PublicKey(Buffer.alloc(32, 100 + index)).toBase58(),
        mint,
        vaults[index]!,
        owner,
      ],
    };
  });
  const tx: IndexedTransaction = {
    signature: "confirmed-feed",
    slot: 10n,
    txIndex: 2n,
    blockTime: 900,
    err: null,
    truncated: true,
    events: [],
    accountKeys: [],
    instructions: [
      ...transfers,
      {
        programId: "Ed25519SigVerify111111111111111111111111111",
        data: encodeFeedInstructionData(ed25519),
        accounts: [],
      },
      {
        programId,
        data: encodeFeedInstructionData(feed),
        accounts: [
          owner,
          singletonAddress(programId, "config"),
          singletonAddress(programId, "machine"),
          singletonAddress(programId, "deck"),
          PublicKey.findProgramAddressSync(
            [Buffer.from("binder"), new PublicKey(owner).toBuffer()],
            new PublicKey(programId),
          )[0].toBase58(),
          "Sysvar1nstructions1111111111111111111111111",
          PublicKey.default.toBase58(),
          ...mints.flatMap((mint, index) => [
            mint,
            vaults[index]!,
            ledgerAddress(programId, mint),
            PublicKey.findProgramAddressSync(
              [
                Buffer.from(PUMP_LAYOUTS.bondingCurveSeed),
                new PublicKey(mint).toBuffer(),
              ],
              new PublicKey(PROGRAM_IDS.pumpFun),
            )[0].toBase58(),
          ]),
        ],
      },
    ],
  };
  const options: FeedProofOptions & {
    intakeSigner: NonNullable<FeedProofOptions["intakeSigner"]>;
  } = {
    programId,
    intakeSigner: {
      address: signer,
      source: "historical",
      position: { slot: tx.slot, txIndex: tx.txIndex, ixIndex },
    },
  };
  return {
    tx,
    options,
    feed,
    ed25519,
    message,
    privateKey,
    signer,
    owner,
    mints,
    amounts,
    vaults,
    expiry,
    nonce,
    ixIndex,
    attestationIxIndex,
  };
}
