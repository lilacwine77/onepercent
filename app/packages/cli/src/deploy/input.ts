import { parseArgs } from "node:util";
import { PublicKey } from "@solana/web3.js";
import { GOVERNANCE } from "@onepercent/config";
import { z } from "zod";
import {
  initParamsSchema,
  OpsError,
  parseBoundary,
  publicKeySchema,
} from "../input.js";

const address = publicKeySchema.refine(
  (value) => value !== PublicKey.default.toBase58(),
);

/** The file contains public identities only. Admin starts at the deployer. */
export const deploymentInitSchema = z
  .strictObject({
    founder_admin: address,
    ops_wallet: address,
    params: initParamsSchema,
  })
  .superRefine((value, context) => {
    const p = value.params;
    const roles = [
      value.founder_admin,
      value.ops_wallet,
      p.launch_wallet,
      ...p.guardians,
      p.keeper,
      p.executor,
      p.intake_signer,
      p.quote_signer,
    ];
    if (
      roles.includes(PublicKey.default.toBase58()) ||
      new Set(roles).size !== roles.length ||
      p.admin !== p.launch_wallet ||
      p.rent_buffer_lamports > GOVERNANCE.initRentBufferMaxLamports ||
      !p.team_wallets.includes(value.ops_wallet) ||
      !p.team_wallets.includes(p.launch_wallet) ||
      !p.team_wallets.includes(value.founder_admin)
    )
      context.addIssue({ code: "custom", message: "invalid_deployment_roles" });
  });
export type DeploymentInit = z.infer<typeof deploymentInitSchema>;

const number = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(Number)
  .refine(Number.isSafeInteger);
const schema = z.strictObject({
  command: z.enum([
    "validate",
    "addresses",
    "check",
    "init",
    "season-point",
    "set-season",
    "transfer-admin",
  ]),
  cluster: z.enum(["mainnet", "devnet", "localnet"]),
  rpc: z.url(),
  program: address,
  init: z.string().min(1),
  stage: z.enum(["deployed", "initialized", "handoff"]).optional(),
  wallet: z.string().min(1).optional(),
  confirm: z.string().optional(),
  slot: number.optional(),
  ts: number.optional(),
  stockUpTs: number.optional(),
});
export type DeploymentInput = z.infer<typeof schema>;
export function parseDeploymentInput(argv: string[]): DeploymentInput {
  const names = [
    "cluster",
    "rpc",
    "program",
    "init",
    "stage",
    "wallet",
    "confirm",
    "slot",
    "ts",
    "stock-up-ts",
  ];
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: Object.fromEntries(
        names.map((name) => [name, { type: "string" as const }]),
      ),
    });
  } catch {
    throw new OpsError("invalid_deployment_arguments");
  }
  if (parsed.positionals.length !== 1)
    throw new OpsError("invalid_deployment_arguments");
  const input = parseBoundary(schema, {
    command: parsed.positionals[0],
    ...Object.fromEntries(
      Object.entries(parsed.values).map(([name, value]) => [
        name === "stock-up-ts" ? "stockUpTs" : name,
        value,
      ]),
    ),
  });
  const endpoint = new URL(input.rpc);
  if (
    endpoint.username ||
    endpoint.password ||
    !(
      endpoint.protocol === "https:" ||
      (input.cluster === "localnet" &&
        endpoint.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))
    )
  )
    throw new OpsError("invalid_deployment_endpoint");
  const mutation = ["init", "set-season", "transfer-admin"].includes(
    input.command,
  );
  if (mutation !== (input.wallet !== undefined))
    throw new OpsError("deployment_wallet_requires_mutation");
  if (
    input.command === "set-season"
      ? !input.slot ||
        !input.ts ||
        !input.stockUpTs ||
        input.stockUpTs <= input.ts
      : [input.slot, input.ts, input.stockUpTs].some(
          (value) => value !== undefined,
        )
  )
    throw new OpsError("invalid_deployment_season");
  if (input.command === "check" ? !input.stage : input.stage !== undefined)
    throw new OpsError("deployment_stage_requires_check");
  if (!mutation && input.confirm !== undefined)
    throw new OpsError("deployment_confirmation_requires_mutation");
  return input;
}
