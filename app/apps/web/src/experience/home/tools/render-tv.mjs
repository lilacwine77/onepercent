/**
 * The two TV renders behind the home hero (DA §17.1), from sources in the repository.
 * The hero shows the landing's own TV (public/models/onepercent-crt.glb, synced to
 * /landing/ by scripts/sync-landing-assets.mjs) and its "Find your 1%." broadcast.
 *
 *   node app/apps/web/src/experience/home/tools/render-tv.mjs screen <out-dir>
 *     Only for an app-specific broadcast: the DA §9.1 template on the CRT screen,
 *     1536 × 1152 (Fraunces 700, the landing's Pepe from public/assets, unchanged)
 *     → <out-dir>/crt-screen.png. Then
 *       python3 …/tools/make-assets.py screen <out-dir>/crt-screen.png   (WebP q88)
 *       node …/tools/patch-crt-glb.mjs <out-dir>/crt-screen.webp
 *     and point tv/experience-3d.ts at the patched model.
 *
 *   node app/apps/web/src/experience/home/tools/render-tv.mjs poster <out-dir> [dev-url]
 *     With `pnpm --filter web dev` running (default http://localhost:5173): the TV
 *     poster from the live module (same model, studio and pose as the 3D hero), 720 CSS
 *     px at DPR 2 → <out-dir>/tv-poster.png. Then
 *       python3 …/tools/make-assets.py poster <out-dir>/tv-poster.png
 *
 * The poster needs a GPU-backed Chromium (on macOS: ANGLE over Metal).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "../../../..");
const repo = resolve(web, "../../..");
const require = createRequire(resolve(web, "package.json"));
const { chromium } = require("@playwright/test");
const [mode, outArgument, devUrl = "http://localhost:5173"] =
  process.argv.slice(2);
if (!["screen", "poster"].includes(mode) || !outArgument)
  throw new Error("Usage: render-tv.mjs screen|poster <out-dir> [dev-url]");
const out = resolve(outArgument);
mkdirSync(out, { recursive: true });

if (mode === "screen") {
  const font = pathToFileURL(
    require.resolve("@fontsource/fraunces/files/fraunces-latin-700-normal.woff2"),
  ).href;
  const pepe = pathToFileURL(
    resolve(repo, "public/assets/pepe-mascot-white.png"),
  ).href;
  const page = resolve(out, "crt-screen.html");
  writeFileSync(
    page,
    `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Fraunces; font-weight: 700; src: url(${font}) format("woff2"); }
html, body { margin: 0; background: transparent; } svg { display: block; }
</style>
<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1152" viewBox="0 0 1536 1152">
  <defs><radialGradient id="paper"><stop stop-color="#fff9ee"/><stop offset="1" stop-color="#f1dfd5"/></radialGradient></defs>
  <rect width="1536" height="1152" fill="url(#paper)"/>
  <path d="M0 0h1536v146Q760 187 0 146Z" fill="#d5a2f1"/>
  <g fill="#26062e" font-family="Fraunces" font-weight="700">
    <text x="70" y="104" font-size="76" letter-spacing="-6">1%</text>
    <text x="1460" y="100" font-size="48" text-anchor="end" letter-spacing="-1.5">Onepercent.</text>
  </g>
  <ellipse cx="802" cy="966" rx="325" ry="32" fill="#603167" opacity=".1"/>
  <image href="${pepe}" x="331" y="152" width="905" height="905"/>
  <path d="M0 1043Q750 1090 1536 1024V1152H0Z" fill="#d5a2f1"/>
  <text x="768" y="1120" text-anchor="middle" font-family="Fraunces" font-weight="700" font-size="55" letter-spacing="0" fill="#26062e">Find your 1%.</text>
</svg>`,
  );
  const browser = await chromium.launch({
    args: ["--allow-file-access-from-files"],
  });
  const tab = await browser.newPage({
    viewport: { width: 1536, height: 1152 },
    deviceScaleFactor: 1,
  });
  await tab.goto(pathToFileURL(page).href);
  await tab.evaluate(() => document.fonts.ready);
  await tab.waitForTimeout(500);
  await tab.locator("svg").screenshot({ path: resolve(out, "crt-screen.png") });
  await browser.close();
  console.log(resolve(out, "crt-screen.png"));
} else {
  const size = 720;
  const browser = await chromium.launch({
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  });
  const tab = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 2,
  });
  tab.on("pageerror", (error) => console.error(error.message));
  // Any light route of the dev server: the page is replaced by a bare stage.
  await tab.goto(`${devUrl}/fairness`);
  await tab.evaluate(async (size) => {
    document.body.replaceChildren();
    document.documentElement.style.background = "transparent";
    document.body.style.cssText = "margin:0;background:transparent";
    const stage = document.createElement("div");
    stage.style.cssText = `width:${size}px;height:${size}px`;
    document.body.append(stage);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync("canvas{display:block;width:100%;height:100%}");
    document.adoptedStyleSheets = [sheet];
    const { CRTTelevision } = await import("/src/experience/home/tv/crt.ts");
    const tv = new CRTTelevision(stage, {
      modelUrl: "/landing/onepercent-crt.glb",
      reducedMotion: true,
      maxPixels: 4 * size * size,
    });
    await tv.ready;
    await new Promise((done) => setTimeout(done, 800));
  }, size);
  await tab
    .locator("canvas")
    .screenshot({ path: resolve(out, "tv-poster.png"), omitBackground: true });
  await browser.close();
  console.log(resolve(out, "tv-poster.png"));
}
