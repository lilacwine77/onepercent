import { z } from "zod";

const scalar = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const value = z.union([scalar, z.array(scalar), z.record(z.string(), scalar)]);
export const listingCriterionSchema = z
  .object({
    id: z.string(),
    pass: z.boolean(),
    observed: value,
    threshold: value,
    source: z.string(),
  })
  .strict();
export type ListingCriterion = z.infer<typeof listingCriterionSchema>;
export const listingReportSchema = z
  .object({
    version: z.literal("x2-listing-v1"),
    mint: z.string(),
    class: z.enum(["MAJOR", "TRENDING"]),
    checkedAt: z.number().int().nonnegative(),
    pass: z.boolean(),
    criteria: z.array(listingCriterionSchema),
    info: z
      .object({
        capLamports: z.string().regex(/^\d+$/).nullable(),
        excludedHolders: z
          .array(
            z
              .object({
                address: z.string(),
                owner: z.string(),
                amount: z.string().regex(/^\d+$/),
                reason: z.string(),
              })
              .strict(),
          )
          .nullable(),
        jupiterTopHoldersPercentage: z.number().finite().nullable(),
      })
      .strict(),
  })
  .strict();
export type ListingReport = z.infer<typeof listingReportSchema>;
export function serializeListingReport(report: ListingReport): string {
  return JSON.stringify(listingReportSchema.parse(report));
}
export function parseListingReport(json: string): ListingReport {
  return listingReportSchema.parse(JSON.parse(json));
}
