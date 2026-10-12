import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installWallet } from "../mock-wallet/index";
import { enforceProductionCsp, readCspViolations } from "../helpers/csp";
import { short, t } from "@onepercent/copy";
const owner = "ATXnDZiLoMMsMGvmWdKRFxhCSLPX8UvzC7UKLt5wBbyM";
const routes = [
  "/",
  "/x",
  `/x/${owner}`,
  "/feed",
  "/rip",
  "/cards",
  "/verify/42",
  `/verify/${owner}`,
  "/fairness",
  "/live",
  "/token",
  "/link/0123456789abcdef0123456789abcdef",
  "/status",
  "/missing",
];
test("W1.01 routes, aliases preserve search/hash, titles and heading focus", async ({
  page,
}) => {
  for (const path of routes) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page).toHaveTitle(/Onepercent/);
    await expect(page.locator("h1")).toBeFocused();
  }
  await page.goto("/packs?ref=first_alias#kept");
  await expect(page).toHaveURL(/\/rip\?ref=first_alias#kept$/);
  await page.goto("/me?x=1#kept");
  await expect(page).toHaveURL(/\/cards\?x=1#kept$/);
  await page.goto("/verify/%2F");
  await expect(page.locator("h1")).toContainText("Not found");
  await page.goto("/dev/experience");
  await expect(page.locator("h1")).toContainText("Not found");
  await page.goto(`/verify/${owner}`);
  await expect(page).toHaveTitle(t("title.verify", { seq: short(owner) }));
  await expect(page.getByText(short(owner), { exact: true })).toBeVisible();
});
test("W1.02 machine offline preserves X-ray, route and rescue access", async ({
  page,
}) => {
  await page.route("**/api/config", (route) => route.abort());
  await page.goto("/");
  await expect(
    page.getByText("The machine’s data is offline. Your exits still work."),
  ).toBeVisible();
  // X-ray lives on /x (the home hero is the landing's): the header leads there.
  await page.getByRole("link", { name: "X-ray", exact: true }).first().click();
  await expect(page.getByRole("textbox")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "My cards", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "My cards", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("My cards");
  await expect(
    page.getByRole("link", { name: "Rescue page ↗" }).first(),
  ).toHaveAttribute("href", "/rescue");
});
test("W1.03 X-ray recorded source, labels, share referral, incoming first wins", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/x?ref=first_alias");
  await page.getByRole("textbox").fill(owner);
  await page.getByRole("button", { name: "X-ray it" }).click();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(page.getByText(/SOL est\./).first()).toBeVisible();
  await expect(page.getByText(/if sold now/)).toHaveCount(0);
  await page.getByRole("button", { name: "Copy link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "ref=first_alias",
  );
  await page.goto(`/x/${owner}?ref=second_alias`);
  expect(
    await page.evaluate(() => sessionStorage.getItem("onepercent.referral")),
  ).toBe("first_alias");
});
test("W1.04 11th request, widget only after 403, a single resend and failed token", async ({
  page,
}) => {
  await enforceProductionCsp(page);
  let requests = 0;
  let tokenRequests = 0;
  await page.route("**/api/xray/*", async (route) => {
    if (route.request().url().includes("card.png")) return route.continue();
    requests++;
    const token = route.request().headers()["cf-turnstile-response"];
    if (token) tokenRequests++;
    if (requests > 10)
      return route.fulfill({
        status: 403,
        json: {
          error: "turnstile_required",
          message: "One quick check, then the X-ray runs.",
        },
      });
    return route.continue();
  });
  await page.route(
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `window.turnstile={render:(container,options)=>{const b=document.createElement('button');b.textContent='Fixture check';b.onclick=()=>{options.callback('fixture-token');options.callback('duplicate-token')};container.append(b);return 'fixture'},remove:()=>{}};`,
      }),
  );
  await page.goto("/x");
  expect(
    await page.locator('script[src*="challenges.cloudflare.com"]').count(),
  ).toBe(0);
  for (let index = 0; index < 11; index++) {
    await page.getByRole("textbox").fill(owner);
    await page.getByRole("button", { name: "X-ray it" }).click();
    if (index < 10) {
      await expect(
        page.getByRole("button", { name: "Copy link" }),
      ).toBeVisible();
      await page
        .getByRole("link", { name: "X-ray", exact: true })
        .first()
        .click();
    }
  }
  await page.getByRole("button", { name: "Fixture check" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "One quick check, then the X-ray runs.",
  );
  expect(tokenRequests).toBe(1);
  expect(await readCspViolations(page)).toEqual([]);
});
test("W1.05 connect, silent reconnect, account switch, disconnect", async ({
  page,
}) => {
  const wallet = await installWallet(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Fixture Wallet" }).click();
  await expect(
    page.getByRole("button", {
      name: `Wallet ${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: `Wallet ${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { fixtureWallet: { stats: { prompts: number } } })
          .fixtureWallet.stats.prompts,
    ),
  ).toBe(0);
  await page.evaluate(() =>
    (
      window as unknown as { fixtureWallet: { switch(): void } }
    ).fixtureWallet.switch(),
  );
  await expect(
    page.getByRole("button", {
      name: `Wallet ${wallet.other.slice(0, 4)}…${wallet.other.slice(-4)}`,
    }),
  ).toBeVisible();
  // Disconnect lives in the connected wallet's dialog.
  await page
    .getByRole("button", {
      name: `Wallet ${wallet.other.slice(0, 4)}…${wallet.other.slice(-4)}`,
    })
    .click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Connect wallet" }),
  ).toBeVisible();
});
test("W1.06 mobile and Telegram universal links preserve full URL", async ({
  browser,
}) => {
  for (const userAgent of [
    "Mozilla/5.0 iPhone",
    "Telegram",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
  ]) {
    const context = await browser.newContext({
      userAgent,
      hasTouch: true,
      storageState: { cookies: [], origins: [] },
    });
    await context.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    try {
      if (userAgent.includes("Macintosh"))
        await context.addInitScript(() => {
          Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
        });
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:4173/x?ref=first_alias");
      await page.getByRole("link", { name: "My cards", exact: true }).click();
      await expect(page).toHaveURL(/\/cards$/);
      await page.getByRole("button", { name: "Connect wallet" }).click();
      const targetUrl = new URL(page.url());
      targetUrl.searchParams.set("ref", "first_alias");
      const target = targetUrl.href;
      const origin = new URL(target).origin;
      await expect(
        page.getByRole("link", { name: "Open in Phantom" }),
      ).toHaveAttribute(
        "href",
        `https://phantom.com/ul/browse/${encodeURIComponent(target)}?ref=${encodeURIComponent(origin)}`,
      );
      await expect(
        page.getByRole("link", { name: "Open in Solflare" }),
      ).toHaveAttribute(
        "href",
        `https://solflare.com/ul/v1/browse/${encodeURIComponent(target)}?ref=${encodeURIComponent(origin)}`,
      );
    } finally {
      await context.close();
    }
  }
});
test("W1.07 axe every route, reduced motion and keyboard X-ray to Connect", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const path of routes) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    if (path.startsWith("/x/") && path.includes(owner))
      await expect(
        page.getByRole("button", { name: "Copy link" }),
      ).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter(
        (item) => item.impact === "serious" || item.impact === "critical",
      ),
    ).toEqual([]);
  }
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await page.goto("/x");
  await page.getByRole("textbox").focus();
  await page.keyboard.insertText(owner);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await page.getByRole("button", { name: "Connect wallet" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
});

for (const status of [404, 503]) {
  test(`W1.02 machine config ${status} not configured preserves standalone X-ray`, async ({
    page,
  }) => {
    let rpcRequests = 0;
    await page.route("**/api/config", (route) =>
      route.fulfill({ status, json: { error: "not_configured" } }),
    );
    await page.route("**/api/rpc", (route) => {
      rpcRequests++;
      return route.abort();
    });
    await page.goto("/x");
    await page.getByRole("textbox").fill(owner);
    await page.getByRole("button", { name: "X-ray it" }).click();
    await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
    await expect(
      page.getByText("The machine’s data is offline. Your exits still work."),
    ).toHaveCount(0);
    expect(rpcRequests).toBe(0);
  });
}
test("W1 CSP permits every route including Link with zero violations", async ({
  page,
}) => {
  await enforceProductionCsp(page);
  for (const path of routes) {
    const linkResponse = path.startsWith("/link/")
      ? page.waitForResponse((response) =>
          new URL(response.url()).pathname.startsWith("/api/link/session/"),
        )
      : null;
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    if (path.startsWith("/x/"))
      await expect(
        page.getByRole("button", { name: "Copy link" }),
      ).toBeVisible();
    if (linkResponse) expect((await linkResponse).ok()).toBe(true);
    expect(await readCspViolations(page), path).toEqual([]);
  }
});
