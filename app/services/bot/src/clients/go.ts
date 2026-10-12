import { BOT_OPS, type PackEdition } from "@onepercent/config";
import { z } from "zod";
import type { ReferralCode } from "../referral.js";
export interface GoInput {
  telegramUserId: number;
  action: "feed" | "rip" | "cards";
  edition?: PackEdition["id"];
  n?: number;
  ref?: ReferralCode;
}
export interface GoClient {
  create(
    input: GoInput,
    count: 1 | 2 | 3,
  ): Promise<{ id: string; expiresAt: string }[]>;
}
const responseSchema = z.strictObject({
  sessions: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[0-9a-f]{32}$/),
        expiresAt: z.iso.datetime(),
      }),
    )
    .min(1)
    .max(3),
});
export function createGoClient(apiUrl: string, bearer?: string): GoClient {
  return {
    async create(input, count) {
      if (!bearer) throw new Error("go unavailable");
      const response = await fetch(new URL("/api/go", apiUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...input, count }),
        signal: AbortSignal.timeout(BOT_OPS.apiTimeoutMs),
        redirect: "error",
      });
      if (response.status !== 201) throw new Error("go unavailable");
      const parsed = responseSchema.parse(await response.json());
      if (
        parsed.sessions.length !== count ||
        new Set(parsed.sessions.map((s) => s.id)).size !== count
      )
        throw new Error("go invalid response");
      return parsed.sessions;
    },
  };
}
