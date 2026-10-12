import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { inspectFilm, installFilmProbes } from "./film-qa-helpers.mjs";
const url = process.env.QA_URL || "http://127.0.0.1:4173";
const out = process.env.QA_OUT || "artifacts/film-tv-v10/preparation";
await mkdir(out, { recursive: true });
const report = {
  url,
  at: new Date().toISOString(),
  runs: [],
  failures: [],
  errors: [],
  expectedBlockedErrors: [],
};
const check = (condition, message) => {
  if (!condition) report.failures.push(message);
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const playing = (page) =>
  page.waitForFunction(
    () => {
      const v = document.querySelector("#concept-film");
      return (
        !v.paused &&
        v.currentTime > 0.1 &&
        document.querySelector("#concept-video-dialog").dataset.state ===
          "playing"
      );
    },
    null,
    { timeout: 18000 },
  );
const close = async (page) => {
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector("#concept-video-dialog").open,
  );
};
try {
  for (const name of [
    "held-media-close-reopen",
    "media-error-retry",
    "hidden-during-preparation",
  ]) {
    const context = await browser.newContext({
      viewport: { width: 910, height: 773 },
    });
    const run = { name };
    report.runs.push(run);
    let release;
    try {
      await context.addInitScript(() =>
        sessionStorage.setItem("onepercent-v2-seen", "1"),
      );
      const page = await context.newPage();
      await installFilmProbes(page);
      page.on("pageerror", (e) => report.errors.push(`${name}: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        if (
          name === "media-error-retry" &&
          /503|ERR|media|video/i.test(m.text())
        )
          report.expectedBlockedErrors.push(m.text());
        else report.errors.push(`${name}: ${m.text()}`);
      });
      if (name === "held-media-close-reopen") {
        const held = new Promise((resolve) => {
          release = resolve;
        });
        await page.route(
          "**/media/onepercent-explained.mp4*",
          async (route) => {
            await held;
            await route.continue();
          },
        );
      }
      if (name === "media-error-retry")
        await page.route("**/media/onepercent-explained.mp4*", (route) =>
          route.fulfill({ status: 503, body: "Temporary QA media failure" }),
        );
      await page.goto(url);
      await page.waitForFunction(() => window.crtTelevision?.renderReady);
      await page.locator("[data-watch-film]").click();
      if (name === "held-media-close-reopen") {
        await page.waitForTimeout(300);
        run.preparing = await inspectFilm(page);
        check(
          run.preparing.media.paused &&
            run.preparing.media.time === 0 &&
            run.preparing.television.uniforms.video === 0,
          "Held media: preparation advances or removes Pepe before first frame",
        );
        await close(page);
        release();
        release = null;
        await page.waitForTimeout(500);
        run.closedAfterRelease = await inspectFilm(page);
        check(
          !run.closedAfterRelease.open &&
            run.closedAfterRelease.media.paused &&
            run.closedAfterRelease.media.time === 0,
          "Held media: resolving a cancelled preload starts playback",
        );
        await page.locator("[data-watch-film]").click();
        await playing(page);
        run.reopened = await inspectFilm(page);
        await close(page);
        await page.locator("[data-watch-film]").click();
        await page.waitForTimeout(100);
        await close(page);
        await page.locator("[data-watch-film]").click();
        await playing(page);
        run.rapidReopen = await inspectFilm(page);
      }
      if (name === "media-error-retry") {
        await page
          .locator("[data-concept-error]")
          .waitFor({ state: "visible", timeout: 15000 });
        run.error = await inspectFilm(page);
        check(
          run.error.media.paused && run.error.open,
          "Failed media: no controllable paused error state",
        );
        await page.unroute("**/media/onepercent-explained.mp4*");
        await page.locator("[data-film-play]").click();
        await playing(page);
        run.retried = await inspectFilm(page);
        await page.screenshot({ path: `${out}/retried.png` });
      }
      if (name === "hidden-during-preparation") {
        await page.waitForTimeout(250);
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", {
            configurable: true,
            get: () => true,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await page.waitForTimeout(1300);
        run.hidden = await inspectFilm(page);
        check(
          run.hidden.media.paused && run.hidden.media.time === 0,
          "Hidden preparing film starts audio/video in the background",
        );
        await page.evaluate(() => {
          delete document.hidden;
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await playing(page);
        run.visible = await inspectFilm(page);
        run.visibilityMechanism =
          "Synthetic document visibility change during preparation; separate real tabs remain visible in headless Chrome.";
      }
      await close(page);
      run.final = await inspectFilm(page);
      check(
        run.final.media.paused &&
          run.final.media.time === 0 &&
          !run.final.television.isFilmActive &&
          run.final.focus.watch,
        `${name}: closing leaves playback, zoom or focus behind`,
      );
      run.events = await page.evaluate(() => window.__filmQAEvents);
    } catch (error) {
      report.failures.push(`${name}: ${error.stack || error}`);
    } finally {
      release?.();
      await context.close();
    }
  }
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
