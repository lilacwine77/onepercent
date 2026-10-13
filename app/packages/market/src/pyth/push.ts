import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { rpcContextSchema, type ChainRpc } from "../chain/exit-cap.js";
import { MarketError } from "../errors.js";
import { CHAIN_LAYOUT, PROGRAM_IDS, PYTH_PUSH_LAYOUT } from "../params.js";
import { type PythHermesClient, type PythPriceUpdate } from "./hermes.js";

const discriminator = Buffer.from(PYTH_PUSH_LAYOUT.discriminatorHex, "hex");
const accountResult = z.object({
  context: rpcContextSchema,
  value: z
    .object({
      owner: z.string(),
      data: z.tuple([z.string(), z.literal("base64")]),
    })
    .nullable(),
});

function normalizedFeedId(input: string): string {
  const feedId = input.replace(/^0x/i, "").toLowerCase();
  if (
    feedId.length !== CHAIN_LAYOUT.publicKeyBytes * 2 ||
    !/^[\da-f]+$/.test(feedId)
  )
    throw new MarketError("INVALID_INPUT", {
      provider: "pyth",
      message: "Invalid Pyth feed id",
    });
  return feedId;
}

/** Same sponsored shard-0 derivation as the stock keeper. */
export function derivePythPushAccount(feedId: string): string {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.alloc(CHAIN_LAYOUT.u16Bytes),
      Buffer.from(normalizedFeedId(feedId), "hex"),
    ],
    new PublicKey(PROGRAM_IDS.pythPushOracle),
  )[0].toBase58();
}

/** Mirrors the keeper's SDK Full PriceUpdateV2 parser, without an SDK dependency. */
export function decodePythPushPrice(
  account: { owner: string; data: Uint8Array },
  expectedFeedId: string,
): PythPriceUpdate {
  const feedId = normalizedFeedId(expectedFeedId);
  const data = Buffer.from(account.data);
  const p = PYTH_PUSH_LAYOUT;
  if (
    account.owner !== PROGRAM_IDS.pythReceiver ||
    data.length < p.minimumBytes ||
    !data.subarray(0, CHAIN_LAYOUT.discriminatorBytes).equals(discriminator) ||
    data[p.verificationLevel] !== 1 ||
    !data
      .subarray(p.feedId, p.feedId + CHAIN_LAYOUT.publicKeyBytes)
      .equals(Buffer.from(feedId, "hex"))
  )
    throw new MarketError("PROVIDER_SCHEMA", {
      provider: "pyth",
      message: "Invalid Pyth push feed account",
    });
  const price = data.readBigInt64LE(p.price);
  const conf = data.readBigUInt64LE(p.conf);
  const expo = data.readInt32LE(p.exponent);
  const publishTime = data.readBigInt64LE(p.publishTime);
  if (
    price <= 0n ||
    expo < p.minimumExponent ||
    expo > 0 ||
    publishTime < 0n ||
    publishTime > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new MarketError("PROVIDER_SCHEMA", {
      provider: "pyth",
      message: "Invalid Pyth push feed price",
    });
  // Freshness and confidence remain listing criteria, preserving their observed values.
  return {
    id: feedId,
    price: {
      price: price.toString(),
      conf: conf.toString(),
      expo,
      publish_time: Number(publishTime),
    },
  };
}

export function createPythPushClient(opts: {
  rpc: ChainRpc;
}): Pick<PythHermesClient, "getLatest"> {
  const active = new Map<string, Promise<PythPriceUpdate | undefined>>();
  async function load(feedId: string): Promise<PythPriceUpdate | undefined> {
    const result = await opts.rpc.call(accountResult, "getAccountInfo", [
      derivePythPushAccount(feedId),
      { encoding: "base64", commitment: "confirmed" },
    ]);
    if (!result.value) return undefined;
    return {
      ...decodePythPushPrice(
        {
          owner: result.value.owner,
          data: Buffer.from(result.value.data[0], "base64"),
        },
        feedId,
      ),
      metadata: { slot: result.context.slot },
    };
  }
  return {
    async getLatest(input) {
      const feedId = normalizedFeedId(input);
      const pending = active.get(feedId);
      if (pending) return pending;
      const work = load(feedId);
      active.set(feedId, work);
      try {
        return await work;
      } finally {
        active.delete(feedId);
      }
    },
  };
}
