import { z } from "zod";

// Transcribed from @solana/actions-spec@2.4.2/index.d.ts; X3 adds its UI limits.
// https://www.npmjs.com/package/@solana/actions-spec/v/2.4.2
export const ActionErrorSchema = z.object({ message: z.string() });
const Label = z
  .string()
  .refine(
    (value) => value.trim().split(/\s+/).length <= 5,
    "At most five words",
  );
const ActionParameter = z.object({
  type: z
    .enum([
      "text",
      "email",
      "url",
      "number",
      "date",
      "datetime-local",
      "textarea",
      "select",
      "radio",
      "checkbox",
    ])
    .optional(),
  name: z.string(),
  label: z.string().optional(),
  required: z.boolean().optional(),
  pattern: z.string().optional(),
  patternDescription: z.string().optional(),
  min: z.union([z.number(), z.string()]).optional(),
  max: z.union([z.number(), z.string()]).optional(),
  options: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        selected: z.boolean().optional(),
      }),
    )
    .optional(),
});
const LinkedActionType = z.enum([
  "transaction",
  "message",
  "post",
  "external-link",
]);
const LinkedAction = z.object({
  type: LinkedActionType,
  href: z.string(),
  label: Label,
  parameters: z.array(ActionParameter).optional(),
});
const ActionFields = {
  icon: z.url(),
  title: z.string().max(40),
  description: z.string().max(140),
  label: Label,
  disabled: z.boolean().optional(),
  error: ActionErrorSchema.optional(),
};
export const ActionGetResponseSchema = z.object({
  type: z.literal("action").optional(),
  ...ActionFields,
  links: z.object({ actions: z.array(LinkedAction) }).optional(),
});
export const ActionPostRequestSchema = z.object({
  type: LinkedActionType.optional(),
  account: z.string(),
  data: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional(),
});
const NextAction = z.union([
  ActionGetResponseSchema.extend({ type: z.literal("action") }),
  z.object({ type: z.literal("completed"), ...ActionFields }),
]);
export const ExternalLinkResponseSchema = z.object({
  type: z.literal("external-link"),
  externalLink: z.url(),
  message: z.string().optional(),
  links: z
    .object({
      next: z.union([
        z.object({ type: z.literal("post"), href: z.string() }),
        z.object({ type: z.literal("inline"), action: NextAction }),
      ]),
    })
    .optional(),
});
export const ActionsJsonSchema = z.object({
  rules: z.array(z.object({ pathPattern: z.string(), apiPath: z.string() })),
});

export const TransactionResponseSchema = z.object({
  type: z.literal("transaction"),
  transaction: z
    .string()
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
    .min(1),
  message: z.string().optional(),
});
