import { parseArgs } from "node:util";
import { PublicKey } from "@solana/web3.js";
import { ONEPERCENT_PROGRAM_IDS, TOKEN_1PCT } from "@onepercent/config";
import { z } from "zod";
import {
  createDeploymentSelector,
  type ClusterDeployment,
} from "@onepercent/sdk";
import { OpsError, publicKeySchema } from "../input.js";

export const launchOptionsSchema = z.strictObject({
  command: z.enum([
    "config",
    "lut",
    "plan",
    "check",
    "verify",
    "send",
    "report",
    "set-mint",
    "stock-up",
    "deposit",
    "power-on",
  ]),
  flow: z.enum(["atomic", "proxima"]).optional(),
  cluster: z.enum(["mainnet", "devnet", "localnet"]),
  rpc: z.url(),
  program: publicKeySchema,
  mainnetProgram: publicKeySchema.optional(),
  wallet: z.string().optional(),
  walletAddress: publicKeySchema.optional(),
  poolCreator: publicKeySchema.optional(),
  mintKeypair: z.string().optional(),
  mint: publicKeySchema.optional(),
  lut: publicKeySchema.optional(),
  dbcConfig: publicKeySchema.optional(),
  dbcConfigKeypair: z.string().min(1).optional(),
  migrationThresholdSol: z
    .string()
    .regex(/^(0|[1-9]\d*)(\.\d{1,9})?$/)
    .refine((value) => {
      if (!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(value)) return false;
      const [whole, fraction = ""] = value.split(".");
      const amount =
        BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
      return amount > 0n && amount <= (1n << 64n) - 1n;
    })
    .optional(),
  uri: z.string().optional(),
  name: z.string().optional(),
  symbol: z.string().optional(),
  confirm: z.string().optional(),
  at: z
    .string()
    .regex(/^\d{10}$/)
    .transform(Number)
    .refine((seconds) => {
      const now = Math.floor(Date.now() / 1_000);
      return seconds >= now - 3_600 && seconds <= now + 30 * 86_400;
    })
    .optional(),
  rehearsalMint: publicKeySchema.optional(),
  rehearsalRpc: z.url().optional(),
  acceptWarnings: z.boolean(),
});
export type LaunchInput = z.infer<typeof launchOptionsSchema>;

export function isProximaLaunch(
  input: Pick<LaunchInput, "command" | "flow" | "cluster">,
) {
  return (
    ["verify", "set-mint", "stock-up", "deposit", "power-on"].includes(
      input.command,
    ) ||
    (["check", "plan", "report"].includes(input.command) &&
      (input.flow === "proxima" || input.cluster === "mainnet"))
  );
}

export function parseLaunchInput(argv: string[]): LaunchInput {
  const names = [
    "cluster",
    "flow",
    "rpc",
    "program",
    "mainnet-program",
    "wallet",
    "wallet-address",
    "pool-creator",
    "mint-keypair",
    "mint",
    "lut",
    "dbc-config",
    "dbc-config-keypair",
    "migration-threshold-sol",
    "uri",
    "name",
    "symbol",
    "confirm",
    "at",
    "rehearsal-mint",
    "rehearsal-rpc",
  ];
  let parsed;
  try {
    parsed = parseArgs({
      args: argv[0] === "launch" ? argv.slice(1) : argv,
      allowPositionals: true,
      strict: true,
      options: {
        ...Object.fromEntries(
          names.map((name) => [name, { type: "string" as const }]),
        ),
        "accept-warnings": { type: "boolean" },
        simulate: { type: "boolean" },
      },
    });
  } catch {
    throw new OpsError("invalid_launch_arguments");
  }
  if (parsed.positionals.length !== 1)
    throw new OpsError("invalid_launch_arguments");
  const values: Record<string, unknown> = {
    command: parsed.positionals[0],
    acceptWarnings: parsed.values["accept-warnings"] ?? false,
  };
  for (const name of names)
    values[
      name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
    ] = (parsed.values as Record<string, unknown>)[name];
  const result = launchOptionsSchema.safeParse(values);
  if (!result.success) throw new OpsError("invalid_launch_arguments");
  const input = result.data;
  if (
    input.cluster === "mainnet" &&
    (input.command === "send" || input.flow === "atomic")
  )
    throw new OpsError("mainnet_requires_proxima_launch");
  if (input.poolCreator && !isProximaLaunch(input))
    throw new OpsError("pool_creator_requires_proxima_launch");
  if (input.command === "verify") {
    if (input.flow === "atomic")
      throw new OpsError("proxima_verify_requires_proxima_flow");
    if (
      input.wallet !== undefined ||
      input.mintKeypair !== undefined ||
      input.dbcConfigKeypair !== undefined ||
      input.confirm !== undefined
    )
      throw new OpsError("proxima_verify_is_read_only");
    if (!input.mint) throw new OpsError("proxima_mint_required");
    if (!input.poolCreator) throw new OpsError("proxima_pool_creator_required");
  }
  if (
    ["set-mint", "stock-up", "deposit", "power-on"].includes(input.command) &&
    (!input.wallet || !input.mint || !input.confirm)
  )
    throw new OpsError("proxima_wallet_mint_and_confirmation_required");
  if (
    (["set-mint", "stock-up", "deposit", "power-on"].includes(input.command) ||
      input.flow === "proxima" ||
      input.cluster === "mainnet") &&
    input.mintKeypair
  )
    throw new OpsError("proxima_requires_public_mint_only");
  if (
    parsed.values.simulate &&
    !["plan", "check", "verify"].includes(input.command)
  )
    throw new OpsError("simulate_flag_requires_read_only_launch_command");
  for (const endpoint of [input.rpc, input.rehearsalRpc]) {
    if (!endpoint) continue;
    const url = new URL(endpoint);
    if (
      url.username ||
      url.password ||
      !(
        url.protocol === "https:" ||
        (input.cluster === "localnet" &&
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      )
    )
      throw new OpsError("invalid_launch_endpoint");
  }
  if (input.cluster === "mainnet" && !input.mainnetProgram)
    throw new OpsError("mainnet_program_identity_required");
  if (
    input.command === "send" &&
    (!input.confirm || !input.wallet || !input.mintKeypair)
  )
    throw new OpsError("launch_confirmation_and_signers_required");
  if (input.command !== "config" && !input.dbcConfig)
    throw new OpsError("launch_dbc_config_required");
  if (input.dbcConfigKeypair && input.command !== "config")
    throw new OpsError("launch_config_keypair_requires_config_command");
  if (input.command === "config" && !input.wallet)
    throw new OpsError("launch_config_wallet_required");
  if (input.command === "lut" && !input.wallet)
    throw new OpsError("launch_lut_wallet_required");
  return input;
}

export function launchMetadata(input: LaunchInput) {
  const production =
    input.cluster === "mainnet" && input.program === input.mainnetProgram;
  const name = input.name ?? (production ? TOKEN_1PCT.name : "");
  const symbol = input.symbol ?? (production ? TOKEN_1PCT.symbol : "");
  const uri = input.uri ?? "";
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new OpsError("invalid_launch_metadata");
  }
  // Enforce UTF-8 byte limits too; multibyte metadata must fit the metadata wire bound.
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !name ||
    !symbol ||
    Buffer.byteLength(name) > 32 ||
    Buffer.byteLength(symbol) > 10 ||
    Buffer.byteLength(uri) > 200
  )
    throw new OpsError("invalid_launch_metadata");
  if (
    production
      ? name !== TOKEN_1PCT.name || symbol !== TOKEN_1PCT.symbol
      : /onepercent|1pct/i.test(`${name} ${symbol}`)
  )
    throw new OpsError("launch_name_forbidden");
  if (new PublicKey(input.program).equals(PublicKey.default))
    throw new OpsError("invalid_launch_program");
  return { name, symbol, uri };
}

/** D29 EXT: default quote-reserve threshold; decimal SOL input is exact. */
export function migrationQuoteThreshold(
  input: Pick<LaunchInput, "migrationThresholdSol">,
): bigint {
  const [whole, fraction = ""] = (input.migrationThresholdSol ?? "85").split(
    ".",
  );
  return BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
}

/** Bind the explicit runtime program to the selected cluster once. */
export function selectLaunchDeployment(
  input: Pick<LaunchInput, "program" | "cluster">,
) {
  const programId = new PublicKey(input.program);
  if (programId.equals(PublicKey.default))
    throw new OpsError("invalid_launch_program");
  if (input.cluster === "mainnet") {
    if (ONEPERCENT_PROGRAM_IDS.mainnet === null)
      throw new OpsError("launch_mainnet_program_pending");
    if (input.program !== ONEPERCENT_PROGRAM_IDS.mainnet)
      throw new OpsError("launch_mainnet_program_pin_mismatch");
  }
  return createDeploymentSelector({ [input.cluster]: programId })(
    input.cluster,
  );
}

/** A supplied DBC address asserts the selected pin; it cannot override it. */
export function requirePinnedLaunchIdentity(
  input: Pick<LaunchInput, "program" | "dbcConfig" | "cluster">,
) {
  const deployment = selectLaunchDeployment(input);
  requireLaunchConfigPin(deployment, input.dbcConfig);
  return deployment;
}

export function requireLaunchConfigPin(
  deployment: ClusterDeployment,
  suppliedConfig: string | undefined,
): PublicKey {
  const pin = deployment.meteoraConfigPin;
  if (pin === null) throw new OpsError("launch_dbc_config_pending");
  if (suppliedConfig !== pin)
    throw new OpsError("launch_dbc_config_cluster_pin_mismatch");
  return new PublicKey(pin);
}
