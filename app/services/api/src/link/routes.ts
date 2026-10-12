import { warnCause } from "@onepercent/service-kit";
import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { COPY } from "../actions/copy.js";
import type { ApiDependencies } from "./index.js";
import { isBotAuthorized } from "./auth.js";
import { publicKeyBytes } from "./base58.js";
import { buildLinkMessage } from "./message.js";
import { LINK_LIMITS, clientIpKey, type RateRule } from "./ratelimit.js";

const UserId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const Nonce = z.string().regex(/^[0-9a-f]{32}$/);
const NonceRequest = z.object({
  telegramUserId: UserId,
  botUsername: z.string().regex(/^[A-Za-z0-9_]{5,32}$/),
});

async function readBody(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch (error) {
    warnCause("link_body_invalid", error);
    return null;
  }
}

export function registerLinkRoutes(app: Hono, deps: ApiDependencies): void {
  const auth: MiddlewareHandler = async (context, next) => {
    if (!deps.secret) return context.json({ message: COPY.linkDisabled }, 503);
    if (!isBotAuthorized(context.req.header("Authorization"), deps.secret))
      return context.json({ message: COPY.unauthorized }, 401);
    await next();
  };
  const limit = async (context: Context, key: string, rule: RateRule) => {
    const consumed = await deps.linkRateLimiter.consume(key, rule);
    if (consumed.ok) return null;
    context.header("Retry-After", String(consumed.retryAfterS));
    return context.json({ message: COPY.rateLimited }, 429);
  };
  app.use("/api/link/*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    await next();
  });
  app.post("/api/link/nonce", auth, async (context) => {
    const parsed = NonceRequest.safeParse(await readBody(context));
    if (!parsed.success)
      return context.json({ message: COPY.invalidRequest }, 400);
    const limited = await limit(
      context,
      `nonce:${parsed.data.telegramUserId}`,
      LINK_LIMITS.nonce,
    );
    if (limited) return limited;
    try {
      const session = await deps.linkStore.createNonce(
        parsed.data.telegramUserId,
        parsed.data.botUsername,
      );
      return context.json(
        { nonce: session.nonce, expiresAt: session.expiresAt },
        201,
      );
    } catch (error) {
      warnCause("link_session_unavailable", error);
      return context.json({ message: COPY.unavailable }, 503);
    }
  });
  app.get("/api/link/session/:nonce", async (context) => {
    const limited = await limit(
      context,
      `session:${clientIpKey(context, deps)}`,
      LINK_LIMITS.session,
    );
    if (limited) return limited;
    const result = await deps.linkStore.peekNonce(context.req.param("nonce"));
    if (result.status !== "open")
      return context.json(
        {
          message: result.status === "gone" ? COPY.linkExpired : COPY.notFound,
        },
        result.status === "gone" ? 410 : 404,
      );
    const address = context.req.query("address");
    return context.json({
      status: "open",
      expiresAt: result.session.expiresAt,
      botUsername: result.session.botUsername,
      ...(address && publicKeyBytes(address)
        ? { message: buildLinkMessage(deps.webOrigin, result.session, address) }
        : {}),
    });
  });
  app.post("/api/link/verify", async (context) => {
    const limited = await limit(
      context,
      `verify:${clientIpKey(context, deps)}`,
      LINK_LIMITS.verify,
    );
    if (limited) return limited;
    const body = z
      .object({ nonce: Nonce })
      .passthrough()
      .safeParse(await readBody(context));
    if (!body.success)
      return context.json({ message: COPY.invalidRequest }, 400);
    // Take before validating the rest of the body: naming a nonce burns it even on failure.
    const result = await deps.linkStore.takeNonce(body.data.nonce);
    if (result.status !== "open")
      return context.json(
        {
          message: result.status === "gone" ? COPY.linkExpired : COPY.notFound,
        },
        result.status === "gone" ? 410 : 404,
      );
    const bytes = publicKeyBytes(body.data.address);
    const signature = body.data.signature;
    if (
      !bytes ||
      typeof signature !== "string" ||
      !/^[A-Za-z0-9+/]{86}==$/.test(signature)
    )
      return context.json({ message: COPY.mismatch }, 401);
    const decoded = Buffer.from(signature, "base64");
    if (decoded.length !== 64 || decoded.toString("base64") !== signature)
      return context.json({ message: COPY.mismatch }, 401);
    const address = body.data.address as string;
    const key = createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: Buffer.from(bytes).toString("base64url"),
      },
      format: "jwk",
    });
    const message = buildLinkMessage(deps.webOrigin, result.session, address);
    if (!verify(null, Buffer.from(message, "utf8"), key, decoded))
      return context.json({ message: COPY.mismatch }, 401);
    try {
      await deps.linkStore.bind(result.session.telegramUserId, address);
    } catch (error) {
      warnCause("link_bind_unavailable", error);
      return context.json({ message: COPY.unavailable }, 503);
    }
    return context.json({
      ok: true,
      wallet: address,
      botUsername: result.session.botUsername,
    });
  });
  app.post("/api/link/unbind", auth, async (context) => {
    const parsed = z
      .object({ telegramUserId: UserId })
      .strict()
      .safeParse(await readBody(context));
    if (!parsed.success)
      return context.json({ message: COPY.invalidRequest }, 400);
    try {
      return context.json({
        removed: await deps.linkStore.unbind(parsed.data.telegramUserId),
      });
    } catch (error) {
      warnCause("link_unbind_unavailable", error);
      return context.json({ message: COPY.unavailable }, 503);
    }
  });
  app.get("/api/link/telegram/:telegramUserId", auth, async (context) => {
    const input = context.req.param("telegramUserId");
    const user = /^[1-9]\d*$/.test(input)
      ? UserId.safeParse(Number(input))
      : null;
    if (!user?.success)
      return context.json({ message: COPY.invalidRequest }, 400);
    const binding = await deps.linkStore.walletOf(user.data);
    return context.json(binding ?? { wallet: null, linkedAt: null });
  });
}
