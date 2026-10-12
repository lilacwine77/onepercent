export interface LinkSession {
  status: "open";
  expiresAt: string;
  botUsername: string;
  message?: string;
}

export interface LinkVerified {
  ok: true;
  wallet: string;
  botUsername: string;
}

export class LinkApiError extends Error {
  constructor(readonly status: number) {
    super("Link request failed");
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function botUsername(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_]{5,32}$/.test(value);
}

async function request(
  path: string,
  signal: AbortSignal,
  body?: object,
): Promise<unknown> {
  const apiUrl = window.location.origin;
  const response = await fetch(new URL(path, apiUrl), {
    method: body ? "POST" : "GET",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    redirect: "error",
  });
  if (!response.ok) throw new LinkApiError(response.status);
  return response.json() as Promise<unknown>;
}

export async function getLinkSession(
  nonce: string,
  signal: AbortSignal,
  address?: string,
): Promise<LinkSession> {
  const query = address ? `?address=${encodeURIComponent(address)}` : "";
  const result = await request(
    `/api/link/session/${encodeURIComponent(nonce)}${query}`,
    signal,
  );
  if (
    !record(result) ||
    result.status !== "open" ||
    typeof result.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(result.expiresAt)) ||
    !botUsername(result.botUsername) ||
    (result.message !== undefined && typeof result.message !== "string") ||
    (address !== undefined &&
      (typeof result.message !== "string" || !result.message))
  ) {
    throw new LinkApiError(502);
  }
  return {
    status: "open",
    expiresAt: result.expiresAt,
    botUsername: result.botUsername,
    ...(typeof result.message === "string" ? { message: result.message } : {}),
  };
}

export async function verifyLink(
  body: { nonce: string; address: string; signature: string },
  signal: AbortSignal,
): Promise<LinkVerified> {
  const result = await request("/api/link/verify", signal, body);
  if (
    !record(result) ||
    result.ok !== true ||
    result.wallet !== body.address ||
    !botUsername(result.botUsername)
  ) {
    throw new LinkApiError(502);
  }
  return { ok: true, wallet: body.address, botUsername: result.botUsername };
}
