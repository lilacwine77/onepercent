import { defineConfig, devices } from "@playwright/test";

// Each project owns its backend. Never certify a chain run using fixture servers.
const requested: string[] = [];
for (let index = 0; index < process.argv.length; index++) {
  const argument = process.argv[index]!;
  if (argument === "--project") requested.push(process.argv[++index] ?? "");
  else if (argument.startsWith("--project="))
    requested.push(argument.slice("--project=".length));
}
if (requested.length > 1)
  throw new Error("Select one web e2e project per command.");
// Workers reload this config without the runner's CLI arguments. Pin the
// selection in their inherited environment, including backend and WebGL mode.
const project = requested[0] ?? process.env.WEB_E2E_PROJECT ?? "fixtures";
if (!["fixtures", "webgl-smoke", "validator", "devnet"].includes(project))
  throw new Error("Unknown web e2e project.");
process.env.WEB_E2E_PROJECT = project;
function externalOrigin(
  variable: "WEB_VALIDATOR_URL" | "WEB_DEVNET_URL",
): string {
  const input = process.env[variable];
  if (!input)
    throw new Error(
      `${variable} is required for the ${project} project; a real backend must already be running. Fixtures are never substituted.`,
    );
  const url = new URL(input);
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      `${variable} must be an HTTP(S) origin without credentials or a path.`,
    );
  return url.origin;
}
const fixtureBackend = project === "fixtures" || project === "webgl-smoke";
const localFeedValidator =
  project === "validator" && !process.env.WEB_VALIDATOR_URL;
const baseURL =
  fixtureBackend || localFeedValidator
    ? "http://127.0.0.1:4173"
    : externalOrigin(
        project === "validator" ? "WEB_VALIDATOR_URL" : "WEB_DEVNET_URL",
      );
const patterns = {
  "webgl-smoke": /webgl-smoke\.spec\.ts/,
  fixtures: /(?:w1-.*|w[23]-.*\.fixtures)\.spec\.ts/,
  // The existing external runner owns W3; W2 starts its own disposable bank.
  validator: /w3-.*\.validator\.spec\.ts/,
  devnet: /w[23]-.*\.devnet\.spec\.ts/,
};
export default defineConfig({
  testDir: "./e2e/specs",
  outputDir: "../../target/web-e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    // Exercise the real no-WebGL path; software rendering must not compete
    // with RPC, signature and accessibility assertions. The smoke keeps WebGL.
    launchOptions: project === "fixtures" ? { args: ["--disable-webgl"] } : {},
  },
  projects: [
    {
      name: project,
      testMatch: localFeedValidator
        ? /w2-.*\.validator\.spec\.ts/
        : patterns[project as keyof typeof patterns],
    },
  ],
  webServer: fixtureBackend
    ? [
        {
          command: "pnpm exec tsx e2e/mock-api/start.ts",
          url: "http://127.0.0.1:4174/api/config",
          reuseExistingServer: false,
        },
        {
          command: "node e2e/fixtures-server.mjs",
          timeout: 120_000,
          url: "http://127.0.0.1:4173",
          reuseExistingServer: false,
        },
      ]
    : localFeedValidator
      ? {
          command: "node e2e/fixtures-server.mjs",
          timeout: 120_000,
          url: "http://127.0.0.1:4173",
          env: { WEB_TEST_API_URL: "http://127.0.0.1:4175" },
          reuseExistingServer: false,
        }
      : undefined,
});
