import { warnCause } from "@onepercent/service-kit";
import { Connection } from "@solana/web3.js";
import {
  DomainDoesNotExist,
  DomainExpired,
  resolve,
} from "@bonfida/spl-name-service";
import type { NameResolver } from "./provider-types.js";
import { ChainSourceError } from "./helius.js";

export class SnsNameResolver implements NameResolver {
  private readonly connection?: Connection;
  constructor(
    rpcUrl: string,
    private readonly enabled = false,
  ) {
    if (!enabled) return;
    this.connection = new Connection(rpcUrl, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
      fetch: async (url, options) => {
        try {
          return await fetch(url, {
            ...options,
            signal: AbortSignal.timeout(5000),
          });
        } catch (error) {
          warnCause("xray_name_rpc_failed", error);
          // web3.js errors may otherwise include the provider URL and its key.
          throw new ChainSourceError();
        }
      },
    });
  }
  async resolve(input: string): Promise<string | null> {
    const name = input.toLowerCase();
    if (!this.enabled || !this.connection || !/^[^\s/]{1,100}\.sns$/.test(name))
      return null;
    try {
      return (
        await resolve(this.connection, name, { allowPda: false })
      ).toBase58();
    } catch (error) {
      warnCause("xray_name_resolution_failed", error);
      // The approved beta uses name="SNSError" for every domain error.
      if (error instanceof DomainDoesNotExist || error instanceof DomainExpired)
        return null;
      const code = error instanceof Error ? error.name : "";
      if (
        code === "DomainDoesNotExist" ||
        code === "DomainExpired" ||
        code === "DomainDoesNotExistError" ||
        code === "DomainExpiredError"
      )
        return null;
      throw new ChainSourceError();
    }
  }
}
