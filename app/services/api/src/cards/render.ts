import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import satori, { type Font } from "satori";
import { renderAsync } from "@resvg/resvg-js";
import { XRAY } from "@onepercent/eligibility";
import { MemoryCache, type CacheStore } from "../xray/cache.js";
import {
  CARD_SIZE,
  XrayCard,
  type CardFormat,
  type CardModel,
} from "./xray-card.js";

const require = createRequire(import.meta.url);
export const FONT_FILES = [
  {
    path: "@fontsource/fraunces/files/fraunces-latin-700-normal.woff",
    name: "Fraunces",
    weight: 700,
    style: "normal",
  },
  {
    path: "@fontsource/fraunces/files/fraunces-latin-600-normal.woff",
    name: "Fraunces",
    weight: 600,
    style: "normal",
  },
  {
    path: "@fontsource/fraunces/files/fraunces-latin-600-italic.woff",
    name: "Fraunces",
    weight: 600,
    style: "italic",
  },
  {
    path: "@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff",
    name: "DM Sans",
    weight: 400,
    style: "normal",
  },
  {
    path: "@fontsource/dm-sans/files/dm-sans-latin-500-normal.woff",
    name: "DM Sans",
    weight: 500,
    style: "normal",
  },
] as const;
let fonts: Promise<Font[]> | undefined;
export function loadFonts(): Promise<Font[]> {
  fonts ??= Promise.all(
    FONT_FILES.map(async ({ path, ...font }) => ({
      ...font,
      data: await readFile(require.resolve(path)),
    })),
  );
  return fonts;
}
export async function renderCardSvg(
  model: CardModel,
  format: CardFormat,
): Promise<string> {
  return satori(XrayCard({ model, format }), {
    ...CARD_SIZE[format],
    fonts: await loadFonts(),
  });
}

export function createCardRenderer(
  cache: CacheStore<Uint8Array> = new MemoryCache<Uint8Array>(500),
) {
  const pending = new Map<string, Promise<Uint8Array>>();
  return async (model: CardModel, format: CardFormat): Promise<Uint8Array> => {
    const key = `${model.result.address}:${format}:${model.result.scannedAt}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const rendering = (async () => {
      const svg = await renderCardSvg(model, format);
      const png = (
        await renderAsync(svg, { font: { loadSystemFonts: false } })
      ).asPng();
      cache.set(key, png, XRAY.cacheSeconds);
      return png;
    })();
    pending.set(key, rendering);
    try {
      return await rendering;
    } finally {
      pending.delete(key);
    }
  };
}
export const renderCardPng = createCardRenderer();
