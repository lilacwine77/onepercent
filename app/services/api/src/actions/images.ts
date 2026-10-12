import { warnCause } from "@onepercent/service-kit";
import type { Context, Hono } from "hono";
import { BLINKS, BLINKS_OPS, PACK_EDITIONS } from "@onepercent/config";
import { sol, t, timeUtc } from "@onepercent/copy";
import { BlinkRipCard, type BlinkRipCardProps } from "../cards/blink-rip.js";
import {
  createRipService,
  type RipDependencies,
  type RipSnapshot,
} from "./rip.js";

type RipService = ReturnType<typeof createRipService>;
class ImageRateLimitError extends Error {
  constructor(readonly retryAfterS: number) {
    super("blink_image_rate_limit");
  }
}
export function ripImageProps(
  snapshot: RipSnapshot,
  index: number | null,
  service: RipService,
): BlinkRipCardProps {
  const edition = index === null ? null : PACK_EDITIONS[index];
  const states = PACK_EDITIONS.map((e) => service.state(snapshot, e.index));
  const state =
    index === null
      ? states.includes("covered")
        ? "covered"
        : states[0]!
      : states[index]!;
  return {
    edition: edition?.id ?? null,
    name: edition?.name ?? null,
    priceSol: edition ? sol(edition.priceLamports) : null,
    state,
    upTo:
      state === "covered" && index !== null
        ? (snapshot.machine?.coverage.maxQty[index] ?? null)
        : null,
    // M5 §1.3: specials remain absent until M4 supplies their live-state interface.
    jackpot: null,
    onePct: null,
    asOf: timeUtc(Math.floor(snapshot.asOfMs / 60_000) * 60_000),
  };
}

export async function renderBlinkRipSvg(
  props: BlinkRipCardProps,
): Promise<string> {
  const [{ default: satori }, { loadFonts }] = await Promise.all([
    import("satori"),
    import("../cards/render.js"),
  ]);
  return satori(BlinkRipCard(props), {
    width: BLINKS.imagePx,
    height: BLINKS.imagePx,
    fonts: await loadFonts(),
  });
}
export async function renderBlinkRipPng(
  props: BlinkRipCardProps,
): Promise<Uint8Array> {
  const { renderAsync } = await import("@resvg/resvg-js");
  return (
    await renderAsync(await renderBlinkRipSvg(props), {
      font: { loadSystemFonts: false },
    })
  ).asPng();
}

export function registerBlinkImages(
  app: Hono,
  deps: RipDependencies,
  service: RipService,
  render: (props: BlinkRipCardProps) => Promise<Uint8Array> = renderBlinkRipPng,
): void {
  const cache = new Map<string, { png: Uint8Array; expires: number }>();
  const pending = new Map<
    string,
    Promise<{ png: Uint8Array; expires: number }>
  >();
  const lifetimeMs = BLINKS.liveNumbersMaxAgeSeconds * 1_000;

  app.get("/api/og/blink/rip.png", handle);
  app.get("/api/og/blink/rip/:image", handle);
  async function handle(context: Context) {
    context.header("Cache-Control", "no-store");
    const image = context.req.param("image");
    const index =
      image === undefined
        ? null
        : PACK_EDITIONS.findIndex((e) => `${e.id}.png` === image);
    if (index === -1)
      return context.json({ message: t("common.notFound") }, 404);
    const minuteInput = context.req.query("m");
    if (minuteInput !== undefined && !/^\d{1,16}$/.test(minuteInput))
      return context.json({ message: t("errors.generic") }, 400);
    try {
      const now = deps.clock();
      const key = `rip:${index ?? "all"}:${Math.floor(now / 60_000)}`;
      let entry = cache.get(key);
      if (entry && entry.expires <= now) {
        cache.delete(key);
        entry = undefined;
      }
      if (!entry) {
        for (
          let rendering = pending.get(key);
          rendering;
          rendering = pending.get(key)
        ) {
          try {
            entry = await rendering;
            break;
          } catch (error) {
            // A quota denial belongs to its caller. Waiting clients must
            // check their own quota before starting a replacement render.
            if (!(error instanceof ImageRateLimitError)) throw error;
            warnCause("action_image_limited", error);
          }
        }
        if (!entry) {
          const rendering = (async () => {
            // Install the in-flight read before awaiting quota so concurrent
            // callers share one charge as well as one render.
            const rate = await deps.limiter.consume(
              `blink:image:${deps.clientIp(context)}`,
              {
                limit: BLINKS_OPS.imagesPerMinutePerIp,
                windowMs: 60_000,
              },
            );
            if (!rate.ok)
              throw new ImageRateLimitError(Math.max(1, rate.retryAfterS ?? 1));
            const snapshot = await service.snapshot();
            if (
              snapshot.asOfMs > deps.clock() ||
              snapshot.asOfMs + lifetimeMs <= deps.clock()
            )
              throw new Error("blink_snapshot_expired");
            const png = await render(ripImageProps(snapshot, index, service));
            const fresh = { png, expires: snapshot.asOfMs + lifetimeMs };
            if (fresh.expires <= deps.clock())
              throw new Error("blink_render_expired");
            cache.set(key, fresh);
            while (cache.size > BLINKS_OPS.imageCacheEntries)
              cache.delete(cache.keys().next().value!);
            return fresh;
          })().finally(() => pending.delete(key));
          pending.set(key, rendering);
          entry = await rendering;
        }
      } else {
        cache.delete(key);
        cache.set(key, entry);
      }
      const remaining = Math.max(
        0,
        Math.floor((entry.expires - deps.clock()) / 1_000),
      );
      context.header("Content-Type", "image/png");
      context.header("Cache-Control", `public, max-age=${remaining}`);
      return context.body(new Uint8Array(entry.png), 200);
    } catch (error) {
      warnCause("action_image_failed", error);
      if (error instanceof ImageRateLimitError) {
        context.header("Retry-After", String(error.retryAfterS));
        return context.json(
          {
            message: t("errors.rateLimited", {
              s: String(error.retryAfterS),
            }),
          },
          429,
        );
      }
      return context.json({ message: t("common.networkError") }, 503);
    }
  }
}
