import { PACK_EDITIONS } from "@onepercent/config";
import { z } from "zod";
export const GoId = z.string().regex(/^[0-9a-f]{32}$/);
export const ReferralCode = z
  .string()
  .regex(/^([1-9A-HJ-NP-Za-km-z]{32,44}|[a-z0-9_]{3,16})$/);
export const GoInputSchema = z
  .object({
    telegramUserId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    action: z.enum(["feed", "rip", "cards"]),
    edition: z
      .enum(["original", "blue_shift", "signature", "after_hours"])
      .optional(),
    n: z.number().int().positive().optional(),
    ref: ReferralCode.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.action !== "rip" &&
        (value.edition !== undefined || value.n !== undefined)) ||
      (value.n !== undefined &&
        (!value.edition ||
          value.n >
            (PACK_EDITIONS.find((edition) => edition.id === value.edition)
              ?.maxPerRip ?? 0)))
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid edition or quantity",
      });
    }
  });
export const GoCreateSchema = GoInputSchema.safeExtend({
  count: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
export type GoInput = z.infer<typeof GoInputSchema>;
export function goTarget(session: GoInput): string {
  if (session.action === "cards") return "/cards";
  const query = new URLSearchParams();
  if (session.action === "rip") {
    if (session.edition !== undefined) query.set("edition", session.edition);
    if (session.n !== undefined) query.set("n", String(session.n));
  }
  if (session.ref !== undefined) query.set("ref", session.ref);
  return `/${session.action}${query.size ? `?${query}` : ""}`;
}
