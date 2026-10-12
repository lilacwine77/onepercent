import { z } from "zod";

const GoRedeemedSchema = z.strictObject({ target: z.string() });

export class GoApiError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super("Go request failed");
  }
}

export async function redeemGo(id: string): Promise<string> {
  const apiUrl = window.location.origin;
  const response = await fetch(new URL("/api/go/redeem", apiUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    redirect: "error",
  });
  if (response.status !== 200) {
    const retryAfter = response.headers.get("Retry-After");
    const seconds =
      retryAfter !== null && /^\d+$/.test(retryAfter)
        ? Number(retryAfter)
        : null;
    throw new GoApiError(
      response.status,
      seconds !== null && Number.isSafeInteger(seconds) ? seconds : null,
    );
  }
  const result = GoRedeemedSchema.safeParse(await response.json());
  if (!result.success) throw new GoApiError(502);
  return result.data.target;
}
