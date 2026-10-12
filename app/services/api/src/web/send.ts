import { createPublicKey, verify } from "node:crypto";
import { warnCause } from "@onepercent/service-kit";
import { TX_LIMITS } from "@onepercent/config";
import { VersionedTransaction } from "@solana/web3.js";
import type { ServiceRuntime } from "@onepercent/service-kit";
import {
  SendRequest,
  SendResponse,
  SignatureString,
} from "@onepercent/web-api";

export class InvalidSignedTransaction extends Error {
  constructor() {
    super("invalid_signed_transaction");
  }
}

function signatureString(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let encoded = "";
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)]! + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = "1" + encoded;
  }
  return encoded;
}

export function checkSignedTransaction(tx: string): string {
  try {
    SendRequest.parse({ tx });
    const bytes = Buffer.from(tx, "base64");
    const transaction = VersionedTransaction.deserialize(bytes);
    const count = transaction.message.header.numRequiredSignatures;
    if (
      bytes.length > TX_LIMITS.maxTxBytes ||
      bytes.toString("base64") !== tx ||
      !Buffer.from(transaction.serialize()).equals(bytes) ||
      count < 1 ||
      transaction.signatures.length !== count
    )
      throw new Error();
    const message = transaction.message.serialize();
    for (let index = 0; index < count; index += 1) {
      const signer = transaction.message.staticAccountKeys[index];
      const signature = transaction.signatures[index];
      if (!signer || !signature || signature.every((byte) => byte === 0))
        throw new Error();
      const publicKey = createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          signer.toBuffer(),
        ]),
        format: "der",
        type: "spki",
      });
      if (!verify(null, message, publicKey, signature)) throw new Error();
    }
    return signatureString(transaction.signatures[0]!);
  } catch (error) {
    warnCause("web_transaction_invalid", error);
    throw new InvalidSignedTransaction();
  }
}

export class SignedTransactionSender {
  constructor(private readonly rpc?: Pick<ServiceRuntime["rpc"], "request">) {}

  async send(tx: string): Promise<string> {
    const expected = checkSignedTransaction(tx);
    if (!this.rpc) throw new Error("Transaction transport unavailable");
    const signature = await this.rpc.request(
      "sendTransaction",
      [
        tx,
        {
          encoding: "base64",
          preflightCommitment: "confirmed",
          skipPreflight: false,
          maxRetries: 0,
        },
      ],
      SignatureString,
    );
    if (signature !== expected)
      throw new Error("Transaction signature mismatch");
    return signature;
  }
}

export { InvalidSignedTransaction as SendValidationError };

/** Both live flows use the same signature validation and relay contract. */
export async function relaySignedTransaction(
  rpc: Pick<ServiceRuntime["rpc"], "request">,
  base64: string,
) {
  return SendResponse.parse({
    signature: await new SignedTransactionSender(rpc).send(base64),
  });
}
