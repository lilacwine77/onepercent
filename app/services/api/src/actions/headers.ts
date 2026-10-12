import type { MiddlewareHandler } from "hono";

export const ACTION_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids",
  "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
  "X-Action-Version": "2.4",
  "X-Blockchain-Ids": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
} as const;
export function actionHeaders(
  cluster: "mainnet-beta" | "devnet" | "localnet" = "mainnet-beta",
): MiddlewareHandler {
  return async (context, next) => {
    for (const [name, value] of Object.entries(ACTION_HEADERS))
      context.header(name, value);
    if (
      !context.req.path.startsWith("/api/actions/xray") &&
      cluster !== "mainnet-beta"
    )
      context.header(
        "X-Blockchain-Ids",
        "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      );
    if (context.req.method === "POST")
      context.header("Cache-Control", "no-store");
    if (context.req.method === "OPTIONS") return context.body(null, 204);
    context.header("Content-Type", "application/json");
    await next();
  };
}
