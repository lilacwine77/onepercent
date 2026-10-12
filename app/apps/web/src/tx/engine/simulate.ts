import {
  VersionedTransaction,
  type Connection,
  type Transaction,
} from "@solana/web3.js";
import { EngineError } from "./errors";
export async function simulate(rpc: Connection, transaction: Transaction) {
  const result = await rpc.simulateTransaction(
    new VersionedTransaction(transaction.compileMessage()),
    { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" },
  );
  if (result.value.err) throw new EngineError("errors.simulation");
}
