import { BOT_OPS, TOKEN_1PCT } from "@onepercent/config";
import { z } from "zod";
import { PACK_EDITIONS } from "../limits.js";
import { isAddress } from "../referral.js";
// D24: keep local S4 wire schemas; the bot consumes JSON, never chain accounts.
const uint = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const u64 = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((v) => BigInt(v) <= 18_446_744_073_709_551_615n);
// M1 constants.rs phase and PAUSE_BITS encodings, without importing chain code.
const phases = [
  "Setup",
  "StockUp",
  "PoweredOn",
  "OnAir",
  "BuysClosed",
  "FinalPull",
  "Done",
] as const;
const phase = uint.max(6).transform((value) => phases[value]!);
const timestamp = uint
  .nullable()
  .transform((value) => (value === 0 ? null : value));
const flags = z.object({ FEED: z.boolean(), PACKS: z.boolean() });
const deployedConfigResponse = z.object({
  phase,
  flags,
  paused: uint.max(255).transform((value) => ({
    rip: (value & 1) !== 0,
    feed: (value & 2) !== 0,
  })),
  season: z.object({
    stockUpTs: timestamp,
    onAirTs: timestamp,
    endTs: timestamp,
  }),
});
const predeployConfigResponse = z.strictObject({
  cluster: z.enum(["mainnet-beta", "devnet", "localnet"]),
  programId: z.string().refine(isAddress),
  flags,
  paramsHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  asOfSlot: uint.nullable(),
  phase: z.null(),
  roles: z.null(),
  vrf: z.null(),
  season: z.null(),
  paused: z.null(),
});
export const ConfigResponse = z.union([
  deployedConfigResponse,
  predeployConfigResponse,
]);
export const MachineResponse = z.object({
  deck: z.object({ len: uint, free: uint }),
  coverage: z.object({
    maxQty: z
      .tuple([
        uint.max(PACK_EDITIONS[0].maxPerRip),
        uint.max(PACK_EDITIONS[1].maxPerRip),
        uint.max(PACK_EDITIONS[2].maxPerRip),
        uint.max(PACK_EDITIONS[3].maxPerRip),
      ])
      .transform((values) => ({
        original: values[0],
        blue_shift: values[1],
        signature: values[2],
        after_hours: values[3],
      })),
  }),
  vrf: z.object({ busy: z.boolean() }),
  jackpot: z.object({ tokens: u64, cost: u64 }),
  tokenMint: z.string().refine(isAddress).optional(),
  onePctLiveIndex: z
    .number()
    .int()
    .min(-1)
    .max(TOKEN_1PCT.onePctCardCount - 1)
    .nullable()
    .optional(),
  onePct: z
    .array(
      z.object({
        state: uint
          .max(3)
          .transform((value) => ["locked", "live", "pulled", "final"][value]!),
        releaseTs: uint.optional(),
      }),
    )
    .length(TOKEN_1PCT.onePctCardCount)
    .optional(),
});
export const ValueResponse = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    lamports: u64,
    capped: z.boolean(),
    label: z.literal("if_sold_now"),
  }),
  z.object({ status: z.literal("unavailable"), reason: z.string() }),
]);
export type ConfigSnapshot = z.infer<typeof ConfigResponse>;
export type MachineSnapshot = z.infer<typeof MachineResponse>;
export type ValueSnapshot = z.infer<typeof ValueResponse>;
export interface MachineClient {
  config(): Promise<ConfigSnapshot>;
  machine(): Promise<MachineSnapshot>;
  value(mint: string, amount: string): Promise<ValueSnapshot>;
}
export function createMachineClient(
  apiUrl: string,
  now = Date.now,
): MachineClient {
  const cache = new Map<string, { value: unknown; until: number }>();
  const pending = new Map<string, Promise<unknown>>();
  async function get<T>(
    path: string,
    schema: z.ZodType<T>,
    ttl: number,
  ): Promise<T> {
    const hit = cache.get(path);
    if (hit && hit.until > now()) return hit.value as T;
    if (pending.has(path)) return pending.get(path) as Promise<T>;
    const load = (async () => {
      const response = await fetch(new URL(path, apiUrl), {
        signal: AbortSignal.timeout(BOT_OPS.apiTimeoutMs),
        redirect: "error",
      });
      if (!response.ok) throw new Error("machine unavailable");
      const result = schema.parse(await response.json());
      // Only the current config, machine and one current pot quote are retained.
      if (path.startsWith("/api/value"))
        for (const key of cache.keys())
          if (key.startsWith("/api/value")) cache.delete(key);
      cache.set(path, { value: result, until: now() + ttl });
      return result;
    })();
    pending.set(path, load);
    try {
      return await load;
    } finally {
      pending.delete(path);
    }
  }
  return {
    config: () => get("/api/config", ConfigResponse, BOT_OPS.machineCacheMs),
    machine: () => get("/api/machine", MachineResponse, BOT_OPS.machineCacheMs),
    value: (mint, amount) =>
      get(
        `/api/value?${new URLSearchParams({ mint, amount })}`,
        ValueResponse,
        BOT_OPS.valueCacheMs,
      ),
  };
}
