import { expect, test } from "@playwright/test";

// Separate from deterministic transaction fixtures: this project keeps WebGL on.
test("the 3D machine mounts without errors and releases its scene", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // This project serves the built app without an API; its failed /api
    // requests are not 3D errors.
    if (message.type() === "error" && !message.location().url.includes("/api/"))
      errors.push(message.text());
  });
  await page.addInitScript(() => {
    // Record attachment even if the performance guard removes the canvas
    // before Playwright gets its next turn on a software renderer.
    new MutationObserver((records) => {
      if (
        records.some((record) =>
          [...record.addedNodes].some(
            (node) =>
              node instanceof Element &&
              (node.matches(".rip-root canvas") ||
                node.querySelector(".rip-root canvas")),
          ),
        )
      )
        document.documentElement.dataset.ripWebglMounted = "true";
    }).observe(document, { subtree: true, childList: true });
  });
  await page.goto("/rip");
  await expect(page.locator("html")).toHaveAttribute(
    "data-rip-webgl-mounted",
    "true",
  );
  // Leaving while shaders compile exercises the material lifetime race.
  await page.getByRole("link", { name: "Feed", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".rip-root")).toHaveCount(0);
  // Three polls at 10 ms (and uses a 100 ms initial delay without parallel shaders).
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});
