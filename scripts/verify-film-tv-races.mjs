import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { inspectFilm } from "./film-qa-helpers.mjs";

const url = process.env.QA_URL || "http://127.0.0.1:4173";
const out = process.env.QA_OUT || "artifacts/film-tv-v10/races";
await mkdir(out, { recursive: true });
const report = {
  url,
  at: new Date().toISOString(),
  failures: [],
  errors: [],
  runs: [],
};
const check = (condition, message) => {
  if (!condition) report.failures.push(message);
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 910, height: 773 },
  });
  await context.addInitScript(() =>
    sessionStorage.setItem("onepercent-v2-seen", "1"),
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") report.errors.push(m.text());
  });
  await page.goto(url);
  report.bundle = await page.evaluate(() =>
    [...document.scripts]
      .map((s) => s.src)
      .find((src) => /\/assets\/index-/.test(src)),
  );
  await page.waitForFunction(() => window.crtTelevision?.renderReady);
  await page.locator("[data-watch-film]").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#concept-video-dialog").dataset.state ===
      "playing",
  );
  await page.locator("[data-concept-close]").click();
  await page.waitForTimeout(90);
  const returning = await inspectFilm(page);
  await page.evaluate(() => {
    window.__filmRaceContext = window.crtTelevision.renderer
      .getContext()
      .getExtension("WEBGL_lose_context");
    window.__filmRaceContext.loseContext();
  });
  await page.waitForFunction(
    () => !document.querySelector("#concept-video-dialog").open,
    null,
    { timeout: 5000 },
  );
  const closed = await inspectFilm(page);
  check(
    closed.media.paused &&
      closed.media.time < 0.05 &&
      !closed.television.isFilmActive &&
      !closed.stageInPanel,
    "Context loss during return strands film/zoom/audio state",
  );
  report.runs.push({ name: "context-loss-during-return", returning, closed });
  await page.evaluate(() => window.__filmRaceContext.restoreContext());
  await page.waitForFunction(
    () => window.crtTelevision.renderReady && !window.crtTelevision.contextLost,
    null,
    { timeout: 30000 },
  );
  await page.locator("[data-watch-film]").click();
  await page.waitForTimeout(90);
  const before = await inspectFilm(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(100);
  const reduced = await inspectFilm(page);
  const animations = await page.evaluate(() =>
    document
      .querySelector("#crt-stage")
      .getAnimations()
      .map((a) => ({
        playState: a.playState,
        currentTime: a.currentTime,
        duration: a.effect.getTiming().duration,
      })),
  );
  check(
    reduced.television.reduced && reduced.television.film?.progress === 1,
    "Motion preference change does not finish camera zoom",
  );
  check(
    !animations.some((a) => a.playState === "running"),
    "Motion preference change leaves the stage zoom animation running",
  );
  report.runs.push({
    name: "reduced-motion-during-entry",
    before,
    reduced,
    animations,
  });
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector("#concept-video-dialog").open,
    null,
    { timeout: 5000 },
  );
  await page.waitForTimeout(150);
  const idle = await inspectFilm(page);
  check(
    idle.media.paused &&
      !idle.television.isFilmActive &&
      idle.television.frame === 0,
    "Motion preference change fails to return to static idle",
  );
  report.idle = idle;
  await page.screenshot({ path: `${out}/returned-reduced.png` });
  await context.close();
} catch (error) {
  report.failures.push(error.stack || String(error));
} finally {
  await browser.close();
  report.passed = !report.failures.length && !report.errors.length;
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        failures: report.failures,
        errors: report.errors,
        out,
      },
      null,
      2,
    ),
  );
  if (!report.passed) process.exitCode = 1;
}
