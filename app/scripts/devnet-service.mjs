// Bounded local rehearsal of the actual worker entrypoint; no Railway mutation.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
const role = process.argv[2];
assert(["indexer", "keeper", "executor"].includes(role));
const seconds = Number(process.argv[3] ?? 180);
assert(Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 3600);
const local = JSON.parse(
  readFileSync("reports/devnet/upgrade1-services-local.json", "utf8"),
);
assert(new URL(local.databaseUrl).hostname === "127.0.0.1");
assert(new URL(local.redisUrl).hostname === "127.0.0.1");
function secret(name) {
  const path = `${homedir()}/.config/onepercent/devnet/${name}`;
  assert.equal(statSync(path).mode & 0o777, 0o600);
  return readFileSync(path, "utf8").trim();
}
const env = {
  PATH: process.env.PATH,
  HOME: homedir(),
  NODE_ENV: "production",
  ROLE: role,
  CLUSTER: "devnet",
  DATABASE_URL: local.databaseUrl,
  REDIS_URL: local.redisUrl,
  RPC_URL: "https://api.devnet.solana.com",
  PROGRAM_ID: "DzMTD92EwiEaZ5uTKPwweR2JEhp62kp8VEmpueCAQigr",
  PROTOCOL_LOOKUP_TABLE: "81AcVRQcvUfPgNAcDgcAAJNT3RtWsG2hbjW5xrmjL5Um",
  PRIVATE_HOST: "127.0.0.1",
  PRIVATE_PORT: { indexer: "3015", keeper: "3016", executor: "3017" }[role],
  LOG_LEVEL: "info",
  LOG_IP_SALT: secret("log-ip-salt.txt"),
  APP_VERSION: "0.0.0",
  GIT_COMMIT: "f674762",
  ...(role === "indexer"
    ? {
        INDEXER_RPC_URL_FALLBACK: "https://api.devnet.solana.com",
        INDEXER_WS_URL: "wss://api.devnet.solana.com",
      }
    : {}),
  ...(role === "keeper" ? { KEEPER_KEYPAIR: secret("keeper.json") } : {}),
  ...(role === "executor"
    ? {
        EXECUTOR_KEYPAIR: secret("executor.json"),
        EXECUTOR_SWAP: "stub",
        EXECUTOR_STUB_QUOTE_ACCOUNT:
          "QYu3EBSjsjraQqR6qYks6k1E47JuEjytTm3LqdMb82a",
      }
    : {}),
};
// Reuse the rehearsal-owned quote account; normal policy and simulation gate sends.
const child = spawn(
  process.execPath,
  [
    "--import",
    "./scripts/devnet-service-fetch.mjs",
    "services/worker/dist/index.js",
  ],
  { env, stdio: "inherit" },
);
const timeout = setTimeout(() => child.kill("SIGTERM"), seconds * 1000);
child.on("error", () => {
  console.error("devnet_service_start_failed");
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  clearTimeout(timeout);
  console.log(JSON.stringify({ role, exitCode: code, signal }));
  process.exitCode = code ?? (signal === "SIGTERM" ? 0 : 1);
});
process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
