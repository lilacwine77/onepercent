import { PublicKey } from "@solana/web3.js";

export interface FixtureAccount {
  executable: boolean;
  owner: string;
  lamports: number;
  rentEpoch: number;
  data: string[];
}
/** Null is an explicit absent account; unknown addresses and methods are errors. */
export function fixtureRpcResult(
  method: string,
  params: unknown[],
  accounts: Map<string, FixtureAccount | null>,
) {
  const context = { slot: 100 };
  const read = (address: string) => {
    if (!accounts.has(address))
      throw new Error(`Unrecorded account ${address}`);
    return accounts.get(address)!;
  };
  switch (method) {
    case "getAccountInfo":
      return { context, value: read(String(params[0])) };
    case "getMultipleAccounts":
      return { context, value: (params[0] as string[]).map(read) };
    case "getLatestBlockhash":
      return {
        context,
        value: {
          blockhash: PublicKey.default.toBase58(),
          lastValidBlockHeight: 1000,
        },
      };
    case "getMinimumBalanceForRentExemption":
      return 1000 + Number(params[0]);
    case "getFeeForMessage":
      return { context, value: 5000 };
    case "getBalance":
      return { context, value: 10_000_000_000 };
    case "getSlot":
    case "getBlockTime":
      return 100;
    default:
      throw new Error(`Unrecorded RPC method ${method}`);
  }
}
