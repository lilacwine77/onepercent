import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { enforceProductionCsp, readCspViolations } from "../helpers/csp";

test("Docs opens from the footer and survives a direct reload", async ({
  page,
}) => {
  await page.goto("/x");
  await page
    .locator("footer")
    .getByRole("link", { name: "Docs", exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.locator("h1")).toHaveText("Docs");
  await expect(page.locator("h1")).toBeFocused();
  await expect(page).toHaveTitle(/Docs.*Onepercent/);
  await page.reload();
  await expect(page.locator("main section")).toHaveCount(6);
  await expect(
    page.locator('main section a[href^="https://solscan.io/account/"]'),
  ).toHaveCount(3);
  const addresses = page.locator("main details");
  await expect(addresses).not.toHaveAttribute("open");
  await addresses.locator("summary").click();
  await expect(
    addresses.locator('a[href^="https://solscan.io/account/"]'),
  ).toHaveCount(4);
  await expect(addresses.locator("code")).toHaveText([
    "7H19ieb7A8s8re2fxoh4bd3jf51XXefLroougKLHvreH",
    "35kjYpFKkNfViR9sNfcS3ZuocHor8Ju3xB5WTHybrWdS",
    "AtRkb16chRvFRokhpwefiNkAQCeGyb1jNe1jfnnQLexN",
    "9oKigMfhYcYjX2vHzMwQZoU5JLPQuvK75JfomdnXwfs9",
  ]);
});

for (const width of [1440, 375]) {
  test(`Docs stays readable at ${width}px with the API offline`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await enforceProductionCsp(page);
    await page.route("**/api/**", (route) => route.abort());
    await page.goto("/docs");
    await expect(page.locator("h1")).toHaveText("Docs");
    await expect(page.locator("main section")).toHaveCount(6);
    await page.evaluate(() => document.fonts.ready);
    const images = page.locator("main figure img");
    await expect(images).toHaveCount(2);
    for (const image of await images.all()) {
      await expect(image).toHaveAttribute("loading", "lazy");
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
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    if (width < 760) {
      const comparison = page.getByRole("region", { name: "Chance per pack" });
      await comparison.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      expect(
        await comparison.evaluate((element) => element.scrollLeft),
      ).toBeGreaterThan(0);
      const bounds = (await comparison.boundingBox())!;
      const lastColumn = (await page
        .getByRole("columnheader", { name: /After Hours/ })
        .boundingBox())!;
      expect(lastColumn.x).toBeGreaterThanOrEqual(bounds.x);
      expect(lastColumn.x + lastColumn.width).toBeLessThanOrEqual(
        bounds.x + bounds.width,
      );
      await comparison.evaluate((element) => {
        element.scrollLeft = 0;
      });
    }
    expect(await page.locator("main").innerText()).not.toContain("\u2014");
    const audit = await new AxeBuilder({ page }).include("main").analyze();
    expect(audit.violations).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
    if (process.env.DOCS_SCREENSHOTS_DIR) {
      await page.unroute("**/api/**");
      await Promise.all([
        page.waitForResponse(
          (response) => response.url().endsWith("/api/config") && response.ok(),
        ),
        page.reload(),
      ]);
      await expect(page.locator('aside[role="status"]')).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      for (const image of await images.all()) {
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
      const docs = page.locator(".docs-page");
      const words = async () =>
        (await docs.innerText()).trim().split(/\s+/).length;
      const collapsed = await words();
      await docs.locator("summary").click();
      const expanded = await words();
      await docs.locator("summary").click();
      console.log(
        `Docs words at ${width}px: ${collapsed} collapsed, ${expanded} expanded`,
      );
      await page.evaluate(() => window.scrollTo(0, 0));
      const directory = resolve(process.env.DOCS_SCREENSHOTS_DIR);
      await mkdir(directory, { recursive: true });
      await page.screenshot({
        path: resolve(
          directory,
          width === 1440 ? "docs-desktop.png" : "docs-mobile.png",
        ),
        fullPage: true,
      });
    }
  });
}
