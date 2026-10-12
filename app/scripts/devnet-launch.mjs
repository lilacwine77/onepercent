// Calls the same onepct-ops launch engine with the devnet session's bounded RPC retries.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Keypair, SystemProgram } from "@solana/web3.js";
import {
  executeLaunch,
  launchJson,
} from "../packages/cli/dist/launch/runtime.js";
import { parseLaunchInput } from "../packages/cli/dist/launch/input.js";
import {
  rpc,
  payer,
  pid,
  key,
  keyRoot,
  send,
  requireBalance,
} from "./devnet-session.mjs";
const command = process.argv[2];
assert(
  ["fund", "config", "lut", "plan", "check", "send", "report"].includes(
    command,
  ),
);
const launch = key(`${keyRoot}/launch.json`),
  mint = key(`${keyRoot}/mint.json`),
  lutAuthority = key(`${keyRoot}/lut-authority.json`);
if (command === "fund") {
  const instructions = [];
  for (const [wallet, target] of [
    [launch, 1_300_000_000],
    [lutAuthority, 12_000_000],
  ]) {
    const deficit = Math.max(
      0,
      target - (await rpc.getBalance(wallet.publicKey)),
    );
    if (deficit)
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: wallet.publicKey,
          lamports: deficit,
        }),
      );
  }
  await requireBalance(1_314_000_000);
  if (instructions.length) await send("fund-launch-and-lut", instructions);
} else {
  const wallet =
    command === "config" ? payer : command === "lut" ? lutAuthority : launch;
  const lutPath = "reports/devnet/launch-lut.json";
  const args = [
    command,
    "--cluster",
    "devnet",
    "--rpc",
    rpc.rpcEndpoint,
    "--program",
    pid.toBase58(),
    "--dbc-config",
    "AonXiWUzyniqiaVyK7Bd8kjavgX6KBissnSmWwzVhX8k",
    "--wallet",
    command === "config"
      ? `${keyRoot}/../devnet-test-wallet.json`
      : command === "lut"
        ? `${keyRoot}/lut-authority.json`
        : `${keyRoot}/launch.json`,
    "--mint",
    mint.publicKey.toBase58(),
    "--name",
    "Copper Rehearsal",
    "--symbol",
    "CPRT",
    "--uri",
    "https://example.com/copper-rehearsal.json",
  ];
  if (command === "send")
    args.push(
      "--mint-keypair",
      `${keyRoot}/mint.json`,
      "--confirm",
      mint.publicKey.toBase58().slice(0, 8),
    );
  if (process.argv.includes("--accept-warnings"))
    args.push("--accept-warnings");
  if (existsSync(lutPath))
    args.push("--lut", JSON.parse(readFileSync(lutPath, "utf8")).lookupTable);
  const config =
    command === "config"
      ? Keypair.fromSecretKey(
          Uint8Array.from(
            JSON.parse(
              readFileSync(
                "fixtures/meteora/keys/localnet-devnet-dbc-config-TEST-ONLY.json",
                "utf8",
              ),
            ),
          ),
        )
      : null;
  if (config)
    args.push(
      "--dbc-config-keypair",
      "fixtures/meteora/keys/localnet-devnet-dbc-config-TEST-ONLY.json",
    );
  const result = await executeLaunch(
    parseLaunchInput(args),
    rpc,
    { wallet, mint: command === "send" ? mint : null, config },
    (event) => {
      if (event.event) console.log(launchJson(event));
    },
    { directory: "reports/launch" },
  );
  writeFileSync(`reports/devnet/launch-${command}.json`, launchJson(result));
  if (command === "lut") writeFileSync(lutPath, launchJson(result));
  console.log(launchJson(result));
  if (result.ok === false) process.exitCode = 1;
}
