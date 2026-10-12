import { z } from "zod";
const Sol = z.string().regex(/^\d+(\.\d{1,9})?$/);
const B58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const N = z.number().int().nonnegative();
export const BucketSchema = z.enum([
  "feedable",
  "not_feedable_season",
  "sell",
  "close",
  "not_in_set",
]);
const MintFailureCodeSchema = z.enum([
  "unknown_program",
  "mint_unparseable",
  "decimals",
  "mint_authority",
  "freeze_authority",
  "token_extensions",
]);
export const ReasonCodeSchema = z.enum([
  ...MintFailureCodeSchema.options,
  "excluded",
  "mint_missing",
  "not_pump_fun",
  "snapshot_not_held",
  "snapshot_at_feed",
]);
// DECISIONS.md D8: an unreadable amount retains its precise safety failure.
const nullableAmountReasons: ReadonlySet<string> = new Set([
  ...MintFailureCodeSchema.options,
  "mint_missing",
]);
export const ConditionSchema = z.enum([
  "Mint",
  "Near Mint",
  "Lightly Played",
  "Played",
  "Heavily Played",
  "Damaged",
]);
export const XrayResultSchema = z.object({
  address: B58,
  chain: z.literal("solana"),
  scannedAt: z.iso.datetime(),
  cached: z.boolean(),
  valuesPartial: z.boolean().optional(),
  counts: z.object({
    bags: N,
    feedable: N,
    checkAtFeed: N,
    notFeedable: N,
    sellable: N,
    empty: N,
    notInSet: N,
  }),
  totals: z.object({ sellValueSol: Sol, rentBackSol: Sol }),
  worst: z
    .object({
      symbol: z.string(),
      mint: B58,
      drawdownPct: z.number().min(0).max(100),
    })
    .nullable(),
  bags: z.array(
    z
      .object({
        mint: B58,
        symbol: z.string().max(16),
        name: z.string().max(32),
        logoUrl: z.url().nullable(),
        amountUi: z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .nullable(),
        decimals: z.number().int().min(0).max(255).nullable(),
        tokenProgram: z.enum(["spl", "token2022"]),
        buckets: z.array(BucketSchema).min(1),
        reason: z.string().max(80).optional(),
        reasonCode: ReasonCodeSchema.optional(),
        valueSol: Sol.optional(),
        priceAgeSlots: N.optional(),
      })
      .superRefine((bag, context) => {
        if (bag.decimals === null || bag.amountUi === null) {
          if (
            bag.decimals !== null ||
            bag.amountUi !== null ||
            bag.buckets.length !== 1 ||
            bag.buckets[0] !== "not_in_set" ||
            bag.valueSol !== undefined ||
            !bag.reasonCode ||
            !nullableAmountReasons.has(bag.reasonCode)
          )
            context.addIssue({
              code: "custom",
              message:
                "An unreadable amount needs a not-in-set mint failure and no estimate",
            });
        } else if (bag.reasonCode === "mint_missing") {
          context.addIssue({
            code: "custom",
            message: "An absent mint cannot supply decimals or an amount",
          });
        }
      }),
  ),
  emptyAccounts: z.array(
    z.object({ address: B58, mint: B58, rentLamports: N }),
  ),
  card: z.object({
    title: z.string(),
    condition: ConditionSchema,
    oneLiner: z.string(),
  }),
  share: z.object({
    landscapeUrl: z.url(),
    squareUrl: z.url(),
    xIntentUrl: z.url(),
  }),
});
export type XrayResult = z.infer<typeof XrayResultSchema>;
export type Bucket = z.infer<typeof BucketSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
