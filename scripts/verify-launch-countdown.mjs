import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { MACHINE_OPENS_AT } from "../src/launch-countdown.js";

const url = process.env.QA_URL || "http://127.0.0.1:4173";
const output = "docs/codex/reports";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
});
const errors = [];

try {
  for (const [name, width, height] of [
    ["desktop", 1440, 900],
    ["mobile", 375, 812],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: name === "mobile",
      hasTouch: name === "mobile",
    });
    await context.addInitScript(() =>
      sessionStorage.setItem("onepercent-v2-seen", "1"),
    );
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
    await page.clock.setFixedTime(new Date(MACHINE_OPENS_AT - 10_927_000));
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page
      .locator("#crt-stage[data-ready='true']")
      .waitFor({ timeout: 60_000 });
    await page.locator(".hero-copy h1.revealed").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    const timer = page.locator("[data-countdown-timer]");
    assert.equal(
      await timer.getAttribute("aria-label"),
      "03 hours, 02 minutes, 07 seconds until the Machine opens",
    );
    assert.equal(await timer.getAttribute("aria-live"), "off");
    const dimensions = await page.evaluate(() => {
      const box = document
        .querySelector("[data-countdown]")
        .getBoundingClientRect();
      const title = document
        .querySelector(".hero-copy h1")
        .getBoundingClientRect();
      const actions = document
        .querySelector(".hero-actions")
        .getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        titleTop: title.top,
        actionsBottom: actions.bottom,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    assert.ok(
      dimensions.left >= 0 && dimensions.right <= width,
      `${name}: countdown fits horizontally`,
    );
    assert.ok(
      dimensions.top >= 70 && dimensions.bottom < dimensions.titleTop,
      `${name}: countdown fits above title and below header`,
    );
    assert.ok(
      dimensions.actionsBottom <= height,
      `${name}: hero actions fit the viewport`,
    );
    assert.ok(dimensions.overflow <= 1, `${name}: no horizontal overflow`);
    await page.screenshot({
      path: `${output}/countdown-${name}.png`,
      animations: "disabled",
    });

    // Simulate a delayed/background update and verify it uses the current time.
    await page.clock.setFixedTime(new Date(MACHINE_OPENS_AT - 61_000));
    await page.waitForFunction(() =>
      document
        .querySelector("[data-countdown-timer]")
        .getAttribute("aria-label")
        .startsWith("00 hours, 01 minutes, 01 seconds"),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.setFixedTime(new Date(MACHINE_OPENS_AT - 1000));
    await page.waitForFunction(() =>
      document
        .querySelector("[data-countdown-timer]")
        .getAttribute("aria-label")
        .startsWith("00 hours, 00 minutes, 01 seconds"),
    );
    assert.equal(
      await page.locator("[data-countdown-link]").isVisible(),
      false,
    );
    assert.equal(
      await timer.evaluate(
        (element) => element.getAnimations({ subtree: true }).length,
      ),
      0,
    );
    await page.clock.setFixedTime(new Date(MACHINE_OPENS_AT));
    await page.locator("[data-countdown-link]").waitFor({ state: "visible" });
    assert.equal(
      await page.locator("[data-countdown-label]").innerText(),
      "The Machine is live",
    );
    assert.equal(
      await page.locator("[data-countdown-link]").getAttribute("href"),
      "/",
    );
    assert.equal(await timer.isVisible(), false);
    console.log(
      `${name}: responsive layout, wall-clock update, reduced motion and live transition passed`,
    );
    await context.close();
  }
  assert.deepEqual(errors, [], "no browser errors");
} finally {
  await browser.close();
}
