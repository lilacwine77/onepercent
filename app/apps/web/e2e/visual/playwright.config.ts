import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "surfaces.spec.ts",
  outputDir: join(tmpdir(), "onepercent-m33-captures"),
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: "http://127.0.0.1:5174",
    reducedMotion: "reduce",
    trace: "off",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    command: "node --preserve-symlinks e2e/visual/start.mjs",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
  },
});
