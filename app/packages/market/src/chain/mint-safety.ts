import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { MarketError } from "../errors.js";
import { FEED_RULES, PROGRAM_IDS } from "../params.js";
import {
  createChainRpc,
  rpcContextSchema,
  type ChainClientOptions,
} from "./exit-cap.js";

const mintInfoSchema = z
  .object({
    decimals: z.number().int().nonnegative(),
    mintAuthority: z.string().nullable(),
    freezeAuthority: z.string().nullable(),
    extensions: z
      .array(z.object({ extension: z.string().min(1) }).passthrough())
      .optional(),
  })
  .passthrough();
const resultSchema = z
  .object({
    context: rpcContextSchema,
    value: z
      .object({
        owner: z.string(),
        data: z
          .object({
            parsed: z
              .object({ type: z.literal("mint"), info: mintInfoSchema })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();
export interface MintSafety {
  ownerProgram: string;
  decimals: number;
  mintAuthorityDisabled: boolean;
  freezeAuthorityDisabled: boolean;
  extensions: string[];
  safe: boolean;
  slot: number;
}
export interface MintSafetyClient {
  getMintSafety(mint: string): Promise<MintSafety>;
}
export function createMintSafetyClient(
  opts: ChainClientOptions,
): MintSafetyClient {
  const rpc = createChainRpc(opts);
  return {
    async getMintSafety(mint) {
      try {
        new PublicKey(mint);
      } catch {
        throw new MarketError("INVALID_INPUT");
      }
      const result = await rpc.call(resultSchema, "getAccountInfo", [
        mint,
        { encoding: "jsonParsed", commitment: "confirmed" },
      ]);
      const info = result.value.data.parsed.info;
      const extensions = (info.extensions ?? []).map(
        ({ extension }) => extension[0]!.toUpperCase() + extension.slice(1),
      );
      const ownerProgram = result.value.owner;
      const mintAuthorityDisabled = info.mintAuthority === null;
      const freezeAuthorityDisabled = info.freezeAuthority === null;
      const supportedProgram =
        ownerProgram === PROGRAM_IDS.splToken ||
        ownerProgram === PROGRAM_IDS.token2022;
      const allowed = new Set<string>(FEED_RULES.allowedToken2022Extensions);
      return {
        ownerProgram,
        decimals: info.decimals,
        mintAuthorityDisabled,
        freezeAuthorityDisabled,
        extensions,
        safe:
          supportedProgram &&
          info.decimals <= FEED_RULES.maxMintDecimals &&
          mintAuthorityDisabled &&
          freezeAuthorityDisabled &&
          (ownerProgram === PROGRAM_IDS.token2022
            ? extensions.every((extension) => allowed.has(extension))
            : extensions.length === 0),
        slot: result.context.slot,
      };
    },
  };
}
