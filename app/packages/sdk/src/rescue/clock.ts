import { Buffer } from "buffer";
import { SERVICES } from "@onepercent/config";
import { PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";

export class RescueRpcTimeoutError extends Error {
  readonly code = "rpc_timeout";
  constructor() {
    super(
      "The RPC did not answer within the configured timeout; retry explicitly.",
    );
    this.name = "RescueRpcTimeoutError";
  }
}

/** No automatic retries or provider fallback: every read uses the supplied RPC. */
export async function rpcCall<T>(operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new RescueRpcTimeoutError()),
          SERVICES.transport.rpcTimeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface RescueClock {
  slot: number;
  unixTimestamp: bigint;
}

/** Clock time is signed chain data, never the operating system's time. */
export async function readClock(
  rpc: Pick<Connection, "getAccountInfoAndContext">,
  minContextSlot?: number,
): Promise<RescueClock> {
  const result = await rpcCall(() =>
    rpc.getAccountInfoAndContext(SYSVAR_CLOCK_PUBKEY, {
      commitment: "confirmed",
      ...(minContextSlot === undefined ? {} : { minContextSlot }),
    }),
  );
  const info = result.value;
  if (
    !info ||
    info.executable ||
    !info.owner.equals(
      new PublicKey("Sysvar1111111111111111111111111111111111111"),
    ) ||
    info.data.length !== 40
  )
    throw new Error("Invalid Clock sysvar account");
  return {
    slot: result.context.slot,
    unixTimestamp: Buffer.from(info.data).readBigInt64LE(32),
  };
}
