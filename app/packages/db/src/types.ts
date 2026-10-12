import { customType } from "drizzle-orm/pg-core";
import { z } from "zod";

// This is the u64 representation bound, not a product parameter.
export const U64_MAX = (1n << 64n) - 1n;
export const u64Schema = z.bigint().min(0n).max(U64_MAX);
export const u64StringSchema = z
  .string()
  .regex(/^\d{1,20}$/)
  .refine(
    (value) => /^\d{1,20}$/.test(value) && BigInt(value) <= U64_MAX,
    "Value exceeds u64",
  );

export function encodeU64(value: bigint): string {
  return u64Schema.parse(value).toString();
}

export function decodeU64(value: string): bigint {
  return BigInt(u64StringSchema.parse(value));
}

export const u64 = customType<{ data: bigint; driverData: string }>({
  dataType: () => "numeric(20,0)",
  toDriver: encodeU64,
  fromDriver: decodeU64,
});

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z
      .number()
      .finite()
      .refine(
        (value) => !Number.isInteger(value) || Number.isSafeInteger(value),
        "Unsafe integer; use a decimal string",
      ),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

// JSON boundaries contain decimal strings, never a JS bigint or lossy integer.
export function validatedJson<T>(schema: z.ZodType<T>) {
  return customType<{ data: T; driverData: string }>({
    dataType: () => "jsonb",
    toDriver: (value) => JSON.stringify(schema.parse(value)),
    // node-postgres has already decoded JSONB, including primitive strings.
    fromDriver: (value) => schema.parse(value),
  });
}

export const objectJson = validatedJson(jsonObjectSchema);
export const valueJson = validatedJson(jsonValueSchema);
export const attestationBagsSchema = z.array(
  z
    .object({
      mint: z.string().min(1),
      amount: u64StringSchema,
      path: z.enum(["self", "hop"]),
      via: z.string().min(1).nullable(),
    })
    .strict(),
);
export const attestationBagsJson = validatedJson(attestationBagsSchema);
