import { expect, test } from "@playwright/test";

const surfaces = [
  { name: "rip-selection", path: "/rip", selector: ".rip-oval" },
  { name: "rip-before-signing", path: "/rip", selector: ".rip-oval" },
  {
    name: "verify",
    path: "/verify/42",
    selector: '[data-public-view="verify"] [data-verify-state="verified"]',
  },
  {
    name: "fairness",
    path: "/fairness",
    selector: '[data-public-view="fairness"] table',
  },
  {
    name: "live",
    path: "/live",
    selector: '[data-public-view="live"] .public-tv',
  },
  {
    name: "token",
    path: "/token",
    selector: '[data-public-view="token"] .public-slot',
  },
] as const;

for (const surface of surfaces) {
  test(`visual sample: ${surface.name}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (
        new URL(response.url()).pathname.startsWith("/api/") &&
        response.status() >= 400
      )
        errors.push(`Fixture API ${response.status()}: ${response.url()}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error" && message.text().includes("createRoot"))
        errors.push(message.text());
    });
    // These pages use local display fixtures, never a wallet or external API.
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === "http://127.0.0.1:5174"
        ? route.continue()
        : route.abort();
    });
    await page.goto(surface.path);
    await expect(page.locator(surface.selector).first()).toBeVisible();
    await expect(page.getByText(/LOCAL VISUAL FIXTURES/)).toBeVisible();
    if (surface.name.startsWith("rip-")) {
      await page.getByRole("radio", { name: "×5", exact: true }).click();
      await expect(
        page.getByRole("radio", { name: "×5", exact: true }),
      ).toHaveAttribute("aria-checked", "true");
    }
    if (surface.name === "rip-before-signing") {
      await page.locator(".rip-oval").click();
      await expect(
        page.getByRole("dialog", { name: "Before you Rip" }),
      ).toBeVisible();
      const preview = page.getByRole("dialog", { name: "Before you Rip" });
      await expect(
        preview.getByText("5 × 0.10 SOL", { exact: true }),
      ).toBeVisible();
      await expect(
        preview.getByText("Total · ≈0.501 SOL", { exact: true }),
      ).toBeVisible();
      await expect(
        preview.getByText("1 transaction, 1 approval"),
      ).toBeVisible();
      await expect(preview.locator("details")).not.toHaveAttribute("open", "");
      await expect(preview.getByText(/Pull deposit ·/)).not.toBeVisible();
    }
    await expect(page.locator('.app-footer a[href="/rescue"]')).toHaveCount(1);
    await expect(page.locator('a[href="/rescue"]')).toHaveCount(1);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    expect(errors).toEqual([]);
    const path = testInfo.outputPath(`${surface.name}.png`);
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await testInfo.attach(surface.name, { path, contentType: "image/png" });
  });
}
