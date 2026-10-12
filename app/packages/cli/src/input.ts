import { parseArgs } from "node:util";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

export class OpsError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export const publicKeySchema = z.string().refine((value) => {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
});
const nonzeroKey = publicKeySchema.refine(
  (value) => value !== PublicKey.default.toBase58(),
);
export const u64Schema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,19})$/)
  .transform(BigInt)
  .refine((value) => value <= (1n << 64n) - 1n);
const i64Schema = z
  .string()
  .regex(/^(0|-?[1-9][0-9]{0,18})$/)
  .transform(BigInt)
  .refine((value) => value >= -(1n << 63n) && value < 1n << 63n);
const uint = (maximum: number) =>
  u64Schema.refine((value) => value <= BigInt(maximum)).transform(Number);

export const initParamsSchema = z
  .strictObject({
    admin: nonzeroKey,
    guardians: z.tuple([nonzeroKey, nonzeroKey]),
    keeper: publicKeySchema,
    executor: publicKeySchema,
    intake_signer: nonzeroKey,
    quote_signer: publicKeySchema,
    launch_wallet: publicKeySchema,
    team_wallet: nonzeroKey,
    team_wallets: z.array(publicKeySchema).length(8),
    token_mint: nonzeroKey,
    vrf_queue: nonzeroKey,
    rent_buffer_lamports: u64Schema,
  })
  .refine((value) => value.guardians[0] !== value.guardians[1]);
export type InitInput = z.infer<typeof initParamsSchema>;
export const roles = {
  admin: 0,
  guardian0: 1,
  guardian1: 2,
  keeper: 3,
  executor: 4,
  "intake-signer": 5,
  "quote-signer": 6,
  "launch-wallet": 7,
} as const;
const roleSchema = z.enum(Object.keys(roles) as [keyof typeof roles]);
export type GuardianAction =
  | { setPause: { bits: number; paused: boolean } }
  | { disableBucket: { index: number } }
  | { lowerCap: { index: number; cap: bigint } }
  | { disableRole: { role: number } }
  | { selectVrfQueue: { index: number } };
export type Command =
  | { name: "extension"; extension: "hitlist"; args: string[] }
  | { name: "init"; path: string }
  | {
      name: "set-season";
      snapshotSlot: bigint;
      snapshotTs: bigint;
      stockUpTs: bigint;
    }
  | { name: "role"; role: number; publicKey: string }
  | { name: "guardian"; action: GuardianAction }
  | { name: "lut-create"; addresses?: string[] }
  | { name: "lut-extend"; address: string; addresses: string[] }
  | { name: "lut-freeze"; address: string; addresses?: string[] };
export type CliInput = {
  cluster: "devnet" | "mainnet";
  rpcUrl: string;
  programId: string;
  keypair?: string;
  adminAddress?: string;
  multisig?: string;
  creator?: string;
  opsWallet?: string;
  lutConfirmation?: string;
  vaultIndex: number;
  command: Command;
};

export function parseBoundary<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new OpsError("invalid_input");
  return parsed.data;
}

/** Strict option sets catch typos before any key file or RPC is touched. */
export function parseCli(argv: string[]): CliInput {
  // K1 owns only src/hitlist/**. Extract shared flags, wherever placed, before
  // handing its remaining arguments to that package-local command module.
  const commonNames = new Set([
    "cluster",
    "rpc-url",
    "program-id",
    "keypair",
    "admin",
    "multisig",
    "creator",
    "vault-index",
  ]);
  const common: string[] = [];
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    const name = token.startsWith("--") ? token.slice(2).split("=")[0]! : "";
    if (commonNames.has(name)) {
      common.push(token);
      if (!token.includes("=")) {
        const value = argv[++index];
        if (value === undefined) throw new OpsError("invalid_arguments");
        common.push(value);
      }
    } else rest.push(token);
  }
  const extensionArgs = rest[0] === "hitlist" ? rest.slice(1) : null;
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: extensionArgs ? [...common, "hitlist"] : argv,
      allowPositionals: true,
      strict: true,
      options: Object.fromEntries(
        [
          "cluster",
          "rpc-url",
          "program-id",
          "keypair",
          "admin",
          "multisig",
          "creator",
          "vault-index",
          "slot",
          "ts",
          "stock-up-ts",
          "bits",
          "paused",
          "index",
          "cap",
          "role",
          "lut",
          "addresses",
          "ops-wallet",
          "confirm-mainnet-lut",
        ].map((name) => [name, { type: "string" as const }]),
      ),
    });
  } catch {
    throw new OpsError("invalid_arguments");
  }
  const values = parsed.values;
  const positional = parsed.positionals;
  const used = new Set([
    "cluster",
    "rpc-url",
    "program-id",
    "keypair",
    "admin",
    "multisig",
    "creator",
    "vault-index",
  ]);
  const option = (name: string) => {
    used.add(name);
    return values[name];
  };
  const cluster = parseBoundary(z.enum(["devnet", "mainnet"]), values.cluster);
  // This rejection precedes parsing or reading any supplied path.
  const lutAction =
    positional[0] === "lut" &&
    ["create", "extend", "freeze"].includes(positional[1] ?? "");
  const localMainnet =
    cluster === "mainnet" &&
    !lutAction &&
    (["init", "guardian"].includes(positional[0] ?? "") ||
      values.keypair !== undefined ||
      values.admin !== undefined);
  if (
    values.admin !== undefined &&
    (cluster !== "mainnet" ||
      lutAction ||
      ["init", "guardian"].includes(positional[0] ?? "") ||
      values.keypair !== undefined)
  )
    throw new OpsError("admin_export_requires_unsigned_mainnet_governance");
  if (
    localMainnet &&
    (values.creator !== undefined ||
      (positional[0] !== "init" &&
        [values.multisig, values["vault-index"]].some(
          (value) => value !== undefined,
        )))
  )
    throw new OpsError("local_signer_squads_options_forbidden");
  if (
    cluster === "devnet" &&
    [values.multisig, values.creator, values["vault-index"]].some(
      (v) => v !== undefined,
    )
  )
    throw new OpsError("devnet_squads_options_forbidden");
  const rpcUrl = parseBoundary(
    z.url().refine((url) => {
      const parsedUrl = new URL(url);
      return ["https:", "http:"].includes(parsedUrl.protocol);
    }),
    values["rpc-url"],
  );
  const programId = parseBoundary(nonzeroKey, values["program-id"]);
  const addressesOption = () => {
    const raw = option("addresses");
    if (raw === undefined) return undefined;
    const addresses = parseBoundary(
      z.array(publicKeySchema).min(1).max(256),
      parseBoundary(z.string(), raw).split(","),
    );
    if (new Set(addresses).size !== addresses.length)
      throw new OpsError("duplicate_lut_address");
    return addresses;
  };
  let command: Command;
  switch (positional[0]) {
    case "hitlist":
      command = {
        name: "extension",
        extension: "hitlist",
        args: extensionArgs!,
      };
      break;
    case "init":
      if (positional.length !== 2) throw new OpsError("invalid_arguments");
      command = {
        name: "init",
        path: parseBoundary(z.string().min(1), positional[1]),
      };
      break;
    case "set-season": {
      if (positional.length !== 1) throw new OpsError("invalid_arguments");
      const snapshotTs = parseBoundary(i64Schema, option("ts"));
      const stockUpTs = parseBoundary(i64Schema, option("stock-up-ts"));
      if (stockUpTs <= snapshotTs) throw new OpsError("invalid_season_order");
      command = {
        name: "set-season",
        snapshotSlot: parseBoundary(u64Schema, option("slot")),
        snapshotTs,
        stockUpTs,
      };
      break;
    }
    case "role":
      if (positional.length !== 4 || positional[1] !== "set")
        throw new OpsError("invalid_arguments");
      command = {
        name: "role",
        role: roles[parseBoundary(roleSchema, positional[2])],
        publicKey: parseBoundary(nonzeroKey, positional[3]),
      };
      break;
    case "guardian": {
      if (positional.length !== 2) throw new OpsError("invalid_arguments");
      let action: GuardianAction;
      switch (positional[1]) {
        case "SetPause":
          action = {
            setPause: {
              bits: parseBoundary(uint(31), option("bits")),
              paused:
                parseBoundary(z.enum(["true", "false"]), option("paused")) ===
                "true",
            },
          };
          break;
        case "DisableBucket":
          action = {
            disableBucket: { index: parseBoundary(uint(15), option("index")) },
          };
          break;
        case "LowerCap":
          action = {
            lowerCap: {
              index: parseBoundary(uint(15), option("index")),
              cap: parseBoundary(u64Schema, option("cap")),
            },
          };
          break;
        case "DisableRole": {
          const role = roles[parseBoundary(roleSchema, option("role"))];
          if (role < 3 || role > 6) throw new OpsError("invalid_guardian_role");
          action = { disableRole: { role } };
          break;
        }
        case "SelectVrfQueue":
          action = {
            selectVrfQueue: { index: parseBoundary(uint(3), option("index")) },
          };
          break;
        default:
          throw new OpsError("invalid_guardian_action");
      }
      command = { name: "guardian", action };
      break;
    }
    case "lut":
      if (positional.length !== 2) throw new OpsError("invalid_arguments");
      switch (positional[1]) {
        case "create":
          command = { name: "lut-create", addresses: addressesOption() };
          break;
        case "extend": {
          const addresses = addressesOption();
          if (!addresses) throw new OpsError("invalid_input");
          command = {
            name: "lut-extend",
            address: parseBoundary(publicKeySchema, option("lut")),
            addresses,
          };
          break;
        }
        case "freeze":
          command = {
            name: "lut-freeze",
            address: parseBoundary(publicKeySchema, option("lut")),
            addresses: addressesOption(),
          };
          break;
        default:
          throw new OpsError("invalid_lut_action");
      }
      break;
    default:
      throw new OpsError("invalid_command");
  }
  const managedLut =
    lutAction && (cluster === "mainnet" || values["ops-wallet"] !== undefined);
  let opsWallet: string | undefined;
  let lutConfirmation: string | undefined;
  if (managedLut) {
    opsWallet = parseBoundary(nonzeroKey, option("ops-wallet"));
    lutConfirmation = parseBoundary(
      z.string().min(1).optional(),
      option("confirm-mainnet-lut"),
    );
    if (
      [values.multisig, values.creator, values["vault-index"]].some(
        (value) => value !== undefined,
      )
    )
      throw new OpsError("lut_squads_options_forbidden");
    if (
      (command.name === "lut-create" || command.name === "lut-freeze") &&
      !command.addresses
    )
      throw new OpsError("lut_addresses_required_before_freeze");
  } else if (
    lutAction &&
    command.name !== "lut-extend" &&
    "addresses" in command &&
    command.addresses
  ) {
    throw new OpsError("lut_lifecycle_requires_ops_wallet");
  }
  if (Object.keys(values).some((name) => !used.has(name)))
    throw new OpsError("unused_option");
  return {
    cluster,
    rpcUrl,
    programId,
    command,
    ...(managedLut
      ? {
          opsWallet,
          lutConfirmation,
          ...(values.keypair === undefined
            ? {}
            : { keypair: parseBoundary(z.string().min(1), values.keypair) }),
        }
      : localMainnet
        ? {
            ...(values.admin !== undefined
              ? { adminAddress: parseBoundary(nonzeroKey, values.admin) }
              : { keypair: parseBoundary(z.string().min(1), values.keypair) }),
            ...(command.name === "init" && values.multisig !== undefined
              ? { multisig: parseBoundary(nonzeroKey, values.multisig) }
              : {}),
          }
        : cluster === "devnet"
          ? values.keypair === undefined && command.name === "extension"
            ? {}
            : { keypair: parseBoundary(z.string().min(1), values.keypair) }
          : {
              ...(values.multisig === undefined && command.name === "extension"
                ? {}
                : { multisig: parseBoundary(nonzeroKey, values.multisig) }),
              ...(values.creator === undefined && command.name === "extension"
                ? {}
                : { creator: parseBoundary(nonzeroKey, values.creator) }),
            }),
    vaultIndex:
      values["vault-index"] === undefined
        ? 0
        : parseBoundary(uint(255), values["vault-index"]),
  };
}
