import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  ONCHAIN_KEYS,
  METEORA_BY_CLUSTER,
  PARAMS,
  meteoraForCluster,
  parseProgramCluster,
  resolveOnchainKey,
  validateParams,
} from "../packages/config/src/index.js";

const args = process.argv.slice(2);
let check = false;
let clusterArgument: string | undefined;
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  if (argument === "--check" && !check) check = true;
  else if (argument === "--cluster" && clusterArgument === undefined) {
    clusterArgument = args[++index];
    if (!clusterArgument) throw new Error("--cluster requires a value");
  } else {
    throw new Error(
      "Usage: params-rs.ts [--check] [--cluster localnet|devnet|mainnet]",
    );
  }
}
const cluster = parseProgramCluster(
  clusterArgument ?? process.env.ONEPERCENT_CLUSTER,
);
// The release input gates all four pins, including the off-chain send measures.
if (cluster === "mainnet") {
  const release = spawnSync(
    process.execPath,
    ["scripts/mainnet-release.mjs", "check"],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      stdio: "inherit",
    },
  );
  if (release.error) throw release.error;
  if (release.status !== 0) process.exit(release.status ?? 1);
}
// Resolve before reading or writing artifacts: a PENDING mainnet pin is NO-GO.
const params = validateParams({
  ...PARAMS,
  METEORA: meteoraForCluster(cluster),
});
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function checkPubkey(value: string): void {
  let integer = 0n;
  for (const char of value) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error(`Invalid base58 public key: ${value}`);
    integer = integer * 58n + BigInt(digit);
  }
  let bytes = 0;
  for (let n = integer; n > 0n; n >>= 8n) bytes++;
  bytes += value.match(/^1*/)?.[0].length ?? 0;
  if (bytes !== 32)
    throw new Error(`Public key must contain 32 bytes: ${value}`);
}
function rustName(path: string): string {
  return path
    .replace(/\[\]|\.\{edition\}/g, "")
    .replace(/Hex$/, "")
    .split(".")
    .map((part) =>
      part === part.toUpperCase()
        ? part
        : part.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase(),
    )
    .join("_");
}
function encode(value: unknown, type: string, path: string): string {
  if (type === "hex32") {
    if (typeof value !== "string" || !/^[a-f\d]{64}$/i.test(value))
      throw new Error(`Expected 64 hex characters for ${path}`);
    return encode([...Buffer.from(value, "hex")], "[u8; 32]", path);
  }
  const array = type.match(/^\[(\w+); (\d+)\]$/);
  if (array) {
    const itemType = array[1];
    if (!itemType) throw new Error(`Invalid array type for ${path}`);
    const items: unknown =
      path.endsWith("Hex") && typeof value === "string"
        ? /^(?:[a-f\d]{2})+$/i.test(value)
          ? [...Buffer.from(value, "hex")]
          : undefined
        : value;
    if (!Array.isArray(items) || items.length !== Number(array[2]))
      throw new Error(`Invalid array for ${path}`);
    return `[${items.map((item) => encode(item, itemType, path)).join(", ")}]`;
  }
  if (type === "bool") {
    if (typeof value !== "boolean")
      throw new Error(`Expected bool for ${path}`);
    return String(value);
  }
  if (type === "&[u8]") {
    if (typeof value !== "string" || !/^[\x20-\x7e]+$/.test(value))
      throw new Error(`Expected ASCII bytes for ${path}`);
    return `b${JSON.stringify(value)}`;
  }
  if (type === "Pubkey") {
    if (typeof value !== "string")
      throw new Error(`Expected public key for ${path}`);
    checkPubkey(value);
    return `pubkey!("${value}")`;
  }
  if (
    typeof value !== "bigint" &&
    (typeof value !== "number" || !Number.isSafeInteger(value))
  )
    throw new Error(`Expected integer for ${path}`);
  const n = BigInt(value);
  const widths: Record<string, number> = { u8: 8, u32: 32, u64: 64, i64: 64 };
  const bits = widths[type];
  if (!bits) throw new Error(`Unsupported Rust type: ${type}`);
  const signed = type.startsWith("i");
  const min = signed ? -(1n << BigInt(bits - 1)) : 0n;
  const max = (1n << BigInt(signed ? bits - 1 : bits)) - 1n;
  if (n < min || n > max) throw new Error(`${path} does not fit ${type}`);
  return `${n.toString()}${type}`;
}
const lines = [
  "// GENERATED from packages/config — do not edit",
  "use anchor_lang::{constant, prelude::Pubkey, pubkey};",
  "",
];
const names = new Set<string>();
for (const key of ONCHAIN_KEYS) {
  const name = rustName(key.path);
  if (names.has(name)) throw new Error(`Duplicate Rust constant: ${name}`);
  names.add(name);
  const rustType = key.type === "hex32" ? "[u8; 32]" : key.type;
  const declaration = `pub const ${name}: ${rustType} =`;
  if (key.path === "METEORA.dbcConfig") {
    for (const [selected, cfg] of [
      ["localnet", 'not(any(feature = "devnet", feature = "mainnet"))'],
      ["devnet", 'feature = "devnet"'],
    ] as const) {
      lines.push(
        `#[cfg(${cfg})]`,
        "#[constant]",
        `${declaration} ${encode(METEORA_BY_CLUSTER[selected].dbcConfig, key.type, key.path)};`,
        "",
      );
    }
    lines.push('#[cfg(feature = "mainnet")]');
    if (METEORA_BY_CLUSTER.mainnet.dbcConfig === "PENDING") {
      lines.push(
        'compile_error!("METEORA_DBC_CONFIG is PENDING for mainnet");',
      );
    } else {
      lines.push(
        "#[constant]",
        `${declaration} ${encode(METEORA_BY_CLUSTER.mainnet.dbcConfig, key.type, key.path)};`,
      );
    }
    lines.push("");
    continue;
  }
  const literal = `${encode(resolveOnchainKey(key.path, params), key.type, key.path)};`;
  // Match rustfmt's line width without requiring Rust in the TypeScript CI job.
  const assignment = `${declaration} ${literal}`;
  if (key.type === "hex32") {
    const rows: string[] = [];
    let row = "    ";
    for (const item of literal.slice(1, -2).split(", ")) {
      if (row.length + item.length + 1 > 100) {
        rows.push(row.trimEnd());
        row = "    ";
      }
      row += `${item}, `;
    }
    rows.push(row.trimEnd());
    lines.push("#[constant]", `${declaration} [`, ...rows, "];", "");
    continue;
  }
  lines.push(
    "#[constant]",
    assignment.length <= 100 ? assignment : `${declaration}\n    ${literal}`,
    "",
  );
}
const generated = lines.join("\n");
const output = fileURLToPath(
  new URL("../programs/onepercent/src/params.rs", import.meta.url),
);
if (check) {
  if ((await readFile(output, "utf8")) !== generated)
    throw new Error("params.rs is stale; run pnpm params:rs");
  process.stdout.write(
    `params.rs matches ${ONCHAIN_KEYS.length} compiled parameters (${cluster}).\n`,
  );
} else {
  await writeFile(output, generated);
  process.stdout.write(
    `Generated ${ONCHAIN_KEYS.length} compiled parameters (${cluster}).\n`,
  );
}
