import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { t } from "@onepercent/copy";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(web, "../..");
const budget = JSON.parse(
  await readFile(resolve(web, "budget.json"), "utf8"),
).performance;
const fixture = JSON.parse(
  await readFile(
    resolve(workspace, "packages/eligibility/fixtures/wallets/trencher.json"),
    "utf8",
  ),
);
const origin = "http://127.0.0.1:4173";
const apiOrigin = "http://127.0.0.1:4174";
const children = [];
let browser;
function start(args) {
  const command = process.env.npm_execpath ? process.execPath : "pnpm";
  const arguments_ = process.env.npm_execpath
    ? [process.env.npm_execpath, ...args]
    : args;
  const child = spawn(command, arguments_, {
    cwd: workspace,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "test", WEB_TEST_API_URL: apiOrigin },
    // Own process group: pnpm starts grandchildren that would otherwise outlive
    // the kill, keep the pipes open and stop this script from exiting in CI.
    detached: true,
  });
  let diagnostic = "";
  child.stdout.on("data", (chunk) => {
    diagnostic = (diagnostic + chunk).slice(-4000);
  });
  child.stderr.on("data", (chunk) => {
    diagnostic = (diagnostic + chunk).slice(-4000);
  });
  child.on("error", (error) => {
    diagnostic += error.message;
  });
  children.push({ child, diagnostic: () => diagnostic });
  return child;
}
async function waitFor(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null)
      throw new Error(
        `Performance server exited: ${children.find((row) => row.child === child)?.diagnostic()}`,
      );
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* starting */
    }
    await delay(200);
  }
  throw new Error(`Performance server did not become ready: ${url}`);
}
async function ensureFree(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(500) });
  } catch {
    return;
  }
  throw new Error(
    `Stop the existing server before the reproducible performance run: ${url}`,
  );
}
try {
  await ensureFree(origin);
  await ensureFree(apiOrigin);
  const api = start(["exec", "tsx", "apps/web/e2e/mock-api/start.ts"]);
  await waitFor(`${apiOrigin}/api/config`, api);
  const preview = start([
    "--filter",
    "web",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4173",
  ]);
  await waitFor(origin, preview);
  browser = await chromium.launch();
  const measurements = [];
  const failures = [];
  for (const route of ["/", "/x", `/x/${fixture.owner}`]) {
    for (let run = 1; run <= budget.runs; run++) {
      const context = await browser.newContext({
        viewport: { width: 1365, height: 768 },
      });
      const page = await context.newPage();
      const external = [];
      await page.route("**/*", async (request) => {
        const url = new URL(request.request().url());
        if (
          [origin, apiOrigin].includes(url.origin) ||
          ["data:", "blob:"].includes(url.protocol)
        )
          await request.continue();
        else {
          external.push(url.origin);
          await request.abort();
        }
      });
      await page.addInitScript(() => {
        window.__performanceSample = { lcp: null, shifts: [], tasks: [] };
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            window.__performanceSample.lcp = entry.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            if (!entry.hadRecentInput)
              window.__performanceSample.shifts.push({
                start: entry.startTime,
                value: entry.value,
              });
        }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            window.__performanceSample.tasks.push({
              start: entry.startTime,
              duration: entry.duration,
            });
        }).observe({ type: "longtask", buffered: true });
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: budget.networkLatencyMs,
        downloadThroughput: budget.networkBitsPerSecond / 8,
        uploadThroughput: budget.networkBitsPerSecond / 8,
        connectionType: "cellular3g",
      });
      await cdp.send("Emulation.setCPUThrottlingRate", {
        rate: budget.cpuSlowdown,
      });
      const requiredPaths = ["/api/config"];
      if (route.startsWith("/x/"))
        requiredPaths.push(`/api/xray/${fixture.owner}`);
      const requiredResponses = requiredPaths.map((path) =>
        page.waitForResponse((response) => {
          const url = new URL(response.url());
          return (
            url.origin === origin &&
            url.pathname === path &&
            response.request().method() === "GET"
          );
        }),
      );
      const [response, ...responses] = await Promise.all([
        page.goto(`${origin}${route}`, { waitUntil: "load" }),
        ...requiredResponses,
      ]);
      if (!response?.ok())
        throw new Error(`Failed performance route: ${route}`);
      for (const response of responses) {
        if (!response.ok())
          throw new Error(
            `Required performance data failed: ${new URL(response.url()).pathname} (${response.status()})`,
          );
      }
      await page.locator("h1").waitFor({ state: "visible" });
      if (route.startsWith("/x/"))
        await page
          .getByRole("button", { name: t("common.copyLink"), exact: true })
          .waitFor({ state: "visible" });
      await page.waitForTimeout(budget.observationMs);
      const sample = await page.evaluate(() => {
        const { lcp, shifts, tasks } = window.__performanceSample;
        const fcp = performance.getEntriesByName("first-contentful-paint")[0]
          ?.startTime;
        let cls = 0;
        let session = { start: 0, end: 0, value: 0 };
        for (const shift of shifts) {
          if (
            shift.start - session.end > 1000 ||
            shift.start - session.start > 5000
          )
            session = { start: shift.start, end: shift.start, value: 0 };
          session.value += shift.value;
          session.end = shift.start;
          cls = Math.max(cls, session.value);
        }
        return {
          lcpMs: lcp,
          cls,
          tbtMs: tasks
            .filter((task) => task.start >= fcp)
            .reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0),
          fcpMs: fcp,
        };
      });
      if (sample.lcpMs === null || sample.fcpMs === undefined)
        throw new Error(`Browser did not report paint metrics: ${route}`);
      measurements.push({ route, run, ...sample });
      // Layout shift is deterministic: every run must pass. Timing metrics are
      // judged on the route's median below, so one noisy CI run cannot fail it.
      if (sample.cls > budget.cls)
        failures.push(`${route} run ${run}: cls ${sample.cls} > ${budget.cls}`);
      if (external.length)
        failures.push(
          `${route}: external requests attempted (${[...new Set(external)].join(", ")})`,
        );
      await context.close();
    }
    const runs = measurements.filter((entry) => entry.route === route);
    for (const metric of ["lcpMs", "tbtMs"]) {
      const sorted = runs.map((entry) => entry[metric]).sort((x, y) => x - y);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (median > budget[metric])
        failures.push(
          `${route} median: ${metric} ${median} > ${budget[metric]}`,
        );
    }
  }
  const report = {
    measuredAt: new Date().toISOString(),
    settings: budget,
    note: "Cold contexts; CDP CPU and network throttling. TBT sums long tasks after FCP during the recorded observation window.",
    measurements,
    failures,
  };
  await mkdir(resolve(workspace, "target"), { recursive: true });
  await writeFile(
    resolve(workspace, "target/web-lcp.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser?.close();
  const killGroup = (child, signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  for (const { child } of children.reverse()) {
    killGroup(child, "SIGTERM");
    await Promise.race([
      new Promise((done) => child.once("exit", done)),
      delay(2000),
    ]);
    killGroup(child, "SIGKILL");
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
}
