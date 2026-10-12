import { BOT_OPS } from "@onepercent/config";
import { z } from "zod";
export interface LinkClient {
  createNonce(
    userId: number,
    botUsername: string,
  ): Promise<{ nonce: string; expiresAt: string }>;
  walletOf(userId: number): Promise<string | null>;
  unbind(userId: number): Promise<boolean>;
}
const nonceResponse = z.object({
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  expiresAt: z.iso.datetime(),
});
const walletResponse = z.object({
  wallet: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    .nullable(),
  linkedAt: z.iso.datetime().nullable(),
});
export function createLinkClient(apiUrl: string, bearer?: string): LinkClient {
  async function request(path: string, body?: object): Promise<unknown> {
    if (!bearer) throw new Error("link disabled");
    const response = await fetch(new URL(path, apiUrl), {
      redirect: "error",
      method: body ? "POST" : "GET",
      signal: AbortSignal.timeout(BOT_OPS.apiTimeoutMs),
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error("link unavailable");
    return response.json();
  }
  return {
    async createNonce(telegramUserId, botUsername) {
      return nonceResponse.parse(
        await request("/api/link/nonce", { telegramUserId, botUsername }),
      );
    },
    async unbind(telegramUserId) {
      return z
        .strictObject({ removed: z.boolean() })
        .parse(await request("/api/link/unbind", { telegramUserId })).removed;
    },
    async walletOf(userId) {
      return walletResponse.parse(await request(`/api/link/telegram/${userId}`))
        .wallet;
    },
  };
}
