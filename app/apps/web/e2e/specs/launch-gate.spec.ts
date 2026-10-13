import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const launchAt = Date.parse(process.env.VITE_LAUNCH_AT!);
const owner = "ATXnDZiLoMMsMGvmWdKRFxhCSLPX8UvzC7UKLt5wBbyM";
const lockedRoutes = [
  "/rip",
  "/packs?edition=original",
  "/feed",
  "/x",
  `/x/${owner}`,
  "/cards",
  "/me",
  "/verify",
  "/verify/42",
  `/verify/${owner}`,
  "/live",
  "/go",
  "/go/0123456789abcdef0123456789abcdef",
  "/link/0123456789abcdef0123456789abcdef",
];

test.use({ reducedMotion: "reduce" });

test("the launch gate redirects flows and keeps Docs available", async ({
  page,
}) => {
  await page.clock.setFixedTime(launchAt - 3_661_000);
  for (const path of lockedRoutes) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("timer")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
  await expect(
    page.getByRole("button", { name: "Connect wallet" }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(
        'a[href="/rip"], a[href^="/rip?"], a[href="/feed"], a[href="/x"], a[href="/cards"], a[href="/live"], a[href="#packs"]',
      )
      .filter({ visible: true }),
  ).toHaveCount(0);
  await page
    .locator("footer")
    .getByRole("link", { name: "Docs", exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Docs");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Docs");
  await expect(
    page.getByRole("button", { name: "Connect wallet" }),
  ).toHaveCount(0);
});

test("the opening timer restores flows without a reload", async ({ page }) => {
  await page.clock.install({ time: launchAt - 60_000 });
  await page.goto("/");
  await expect(page.getByRole("timer")).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.launchDocument = "same-document";
  });
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documentRequests++;
  });
  await page.clock.pauseAt(launchAt - 1_000);
  await page.clock.runFor(999);
  await expect(page.getByRole("timer")).toBeVisible();
  await page.clock.runFor(1);
  await expect(page.getByRole("timer")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Connect wallet" }),
  ).toBeVisible();
  await expect(page.locator('a[href="#packs"]')).toBeVisible();
  for (const path of ["/x", "/feed", "/rip", "/cards", "/live"])
    await expect(page.locator(`a[href="${path}"]`).first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "data-launch-document",
    "same-document",
  );
  await page.clock.resume();
  await page.getByRole("link", { name: "X-ray", exact: true }).first().click();
  await expect(page).toHaveURL(/\/x$/);
  await expect(page.getByRole("textbox")).toBeVisible();
  expect(documentRequests).toBe(0);
});

for (const width of [1440, 375]) {
  test(`the locked home fits ${width}px with reduced motion`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 812 });
    await page.clock.setFixedTime(launchAt - 3_661_000);
    await page.goto("/");
    const timer = page.getByRole("timer");
    await expect(timer).toBeVisible();
    await expect(
      page.getByText("The Machine opens in", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".launch-countdown-part")).toHaveText([
      "01",
      "01",
      "01",
    ]);
    await expect(page.locator("html")).toHaveAttribute(
      "data-motion",
      "reduced",
    );
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    const bounds = (await timer.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(
      await page
        .locator(".launch-countdown-part")
        .first()
        .evaluate((element) => getComputedStyle(element).fontVariantNumeric),
    ).toContain("tabular-nums");
    expect(
      await page
        .locator(".launch-countdown-part")
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe("none");
    if (process.env.GATE_SCREENSHOTS_DIR) {
      await expect(page.locator("#packs")).toBeVisible();
      for (const image of await page.locator("main img:visible").all()) {
        await image.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            image.evaluate(
              (element: HTMLImageElement) =>
                element.complete && element.naturalWidth > 0,
            ),
          )
          .toBe(true);
      }
      await page.locator("footer").scrollIntoViewIfNeeded();
      await expect(page.locator(".footer-pepe img")).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      const directory = resolve(process.env.GATE_SCREENSHOTS_DIR);
      await mkdir(directory, { recursive: true });
      await page.screenshot({
        path: resolve(
          directory,
          width === 1440 ? "gate-desktop.png" : "gate-mobile.png",
        ),
        fullPage: true,
      });
    }
  });
}
