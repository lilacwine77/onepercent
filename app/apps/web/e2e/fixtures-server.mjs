import { spawnSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A fresh, isolated fixture build. Never serve a production dist left by another run.
const web = fileURLToPath(new URL("../", import.meta.url));
const runner = fileURLToPath(
  new URL("../../../scripts/web.mjs", import.meta.url),
);
const env = {
  ...process.env,
  CLUSTER: "devnet",
  PROGRAM_ID:
    process.env.WEB_E2E_PROJECT === "validator" &&
    process.env.WEB_FEED_PROGRAM_ID
      ? process.env.WEB_FEED_PROGRAM_ID
      : JSON.parse(
          readFileSync(
            new URL(
              "../../../packages/sdk/src/idl/onepercent.json",
              import.meta.url,
            ),
            "utf8",
          ),
        ).address,
  VITE_CLUSTER: "devnet",
  VITE_PREVIEW: "0",
  VITE_TURNSTILE_SITE_KEY: "fixture-site-key",
  WEB_TEST_API_URL: process.env.WEB_TEST_API_URL ?? "http://127.0.0.1:4174",
  WEB_OUT_DIR: "../../target/web-fixtures",
};
const args = ["--preserve-symlinks", "--preserve-symlinks-main", runner];
const build = spawnSync(process.execPath, [...args, "build"], {
  cwd: web,
  env,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);
if (!process.argv.includes("--build-only")) {
  const preview = spawn(
    process.execPath,
    [...args, "preview", "--host", "127.0.0.1", "--port", "4173"],
    { cwd: web, env, stdio: "inherit" },
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => preview.kill(signal));
  preview.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
