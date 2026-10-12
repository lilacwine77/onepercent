import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
const config = readFileSync(
  new URL("../../Caddyfile", import.meta.url),
  "utf8",
);
const match = /^\s*>Content-Security-Policy "([^"]+)"$/m.exec(config);
if (!match?.[1])
  throw new Error("The production CSP must be present in the Caddyfile.");
export const productionCsp = match[1];
export async function enforceProductionCsp(page: Page) {
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "content-security-policy": productionCsp,
      },
    });
  });
  await page.addInitScript(() => {
    const target = window as unknown as Window & {
      cspViolations: { directive: string; blocked: string }[];
    };
    target.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      target.cspViolations.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
      }),
    );
  });
}
export function readCspViolations(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as Window & {
          cspViolations: { directive: string; blocked: string }[];
        }
      ).cspViolations,
  );
}
