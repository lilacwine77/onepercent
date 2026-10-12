import { warnCause } from "./safe-cause.js";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { inspect } from "node:util";
import { Keypair, PublicKey, type VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { EnvironmentError, roleKeyVariables, type Role } from "./env.js";
import type { JsonRpcClient } from "./rpc.js";

export type KeyRole = "keeper" | "executor" | "intake-signer" | "quote-signer";
const layout = {
  keeper: { offset: 104, bit: 3 },
  executor: { offset: 136, bit: 4 },
  "intake-signer": { offset: 168, bit: 5 },
  "quote-signer": { offset: 200, bit: 6 },
} as const;
const discriminator = createHash("sha256")
  .update("account:Config")
  .digest()
  .subarray(0, 8);
export type ConfigRoles = {
  addresses: Record<KeyRole, PublicKey>;
  disabledRoles: number;
};
// Draft M1 §7.1 bridge; replace with the SDK decoder after G1. No IDL mutation.
export function decodeConfigRoles(data: Buffer): ConfigRoles {
  if (
    data.length !== 872 ||
    !data.subarray(0, 8).equals(discriminator) ||
    data[736] !== 1
  )
    throw new Error("config_unavailable");
  const addresses = Object.fromEntries(
    Object.entries(layout).map(([role, { offset }]) => [
      role,
      new PublicKey(data.subarray(offset, offset + 32)),
    ]),
  ) as Record<KeyRole, PublicKey>;
  return { addresses, disabledRoles: data[742]! };
}
export function configRoleReader(
  rpc: Pick<JsonRpcClient, "account">,
  programId: PublicKey,
): () => Promise<ConfigRoles> {
  const [address, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  );
  return async () => {
    const account = await rpc.account(address);
    if (
      !account.owner.equals(programId) ||
      account.executable ||
      account.data[737] !== bump
    )
      throw new Error("config_unavailable");
    return decodeConfigRoles(account.data);
  };
}
export type RoleReason =
  "role_mismatch" | "role_disabled" | "config_unavailable";
export class RoleGuard {
  private checkedAt: number | undefined;
  private reason: RoleReason | undefined = "config_unavailable";
  private running: Promise<void> | undefined;
  private stopped = false;
  constructor(
    private readonly options: {
      role: KeyRole;
      publicKey: PublicKey;
      readConfig: () => Promise<ConfigRoles>;
      recheckSeconds: number;
      onUnavailable?: (reason: RoleReason) => void | Promise<void>;
      now?: () => number;
    },
  ) {
    if (
      !Number.isSafeInteger(options.recheckSeconds) ||
      options.recheckSeconds <= 0
    ) {
      throw new Error("invalid_role_recheck");
    }
  }
  private now(): number {
    return (this.options.now ?? (() => performance.now()))();
  }
  status(): { ok: true } | { ok: false; reason: RoleReason } {
    const elapsed =
      this.checkedAt === undefined
        ? Number.POSITIVE_INFINITY
        : this.now() - this.checkedAt;
    if (
      this.stopped ||
      !Number.isFinite(elapsed) ||
      elapsed < 0 ||
      elapsed >= this.options.recheckSeconds * 1000
    )
      return { ok: false, reason: "config_unavailable" };
    return this.reason ? { ok: false, reason: this.reason } : { ok: true };
  }
  assertAuthorized(): void {
    const status = this.status();
    if (!status.ok) throw new Error(status.reason);
  }
  refresh(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.check().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async check(): Promise<void> {
    // A slow read must not authorize another full interval after it returns.
    const startedAt = this.now();
    try {
      const config = await this.options.readConfig();
      this.reason = !config.addresses[this.options.role].equals(
        this.options.publicKey,
      )
        ? "role_mismatch"
        : (config.disabledRoles & (1 << layout[this.options.role].bit)) !== 0
          ? "role_disabled"
          : undefined;
    } catch (error) {
      warnCause("config_unavailable", error);
      this.reason = "config_unavailable";
    }
    this.checkedAt = startedAt;
    if (!this.status().ok && !this.reason) this.reason = "config_unavailable";
    if (this.reason) {
      // Observability cannot delay a role check or its next scheduled refresh.
      try {
        const notification = this.options.onUnavailable?.(this.reason);
        if (notification)
          void notification.catch((error) =>
            warnCause("role_notification_failed", error),
          );
      } catch (error) {
        warnCause("role_notification_failed", error);
        // A failed notification leaves the role unavailable.
      }
    }
  }
  stop(): void {
    this.stopped = true;
    this.reason = "config_unavailable";
  }
}
export class RoleKey {
  #keypair: Keypair;
  #bytes: Uint8Array;
  #guard: RoleGuard | undefined;
  constructor(keypair: Keypair) {
    this.#bytes = keypair.secretKey;
    this.#keypair = Keypair.fromSecretKey(this.#bytes);
  }
  get publicKey(): PublicKey {
    return this.#keypair.publicKey;
  }
  bind(guard: RoleGuard): void {
    if (this.#guard) throw new Error("role_guard_already_bound");
    this.#guard = guard;
  }
  private authorize(): void {
    if (!this.#guard) throw new Error("config_unavailable");
    this.#guard.assertAuthorized();
  }
  signTransaction(tx: VersionedTransaction): void {
    this.authorize();
    tx.sign([this.#keypair]);
  }
  signMessage(message: Uint8Array): Uint8Array {
    this.authorize();
    const seed = this.#bytes.subarray(0, 32);
    const der = Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      seed,
    ]);
    try {
      return sign(
        null,
        message,
        createPrivateKey({ key: der, format: "der", type: "pkcs8" }),
      );
    } finally {
      der.fill(0);
    }
  }
  toJSON(): string {
    return "[REDACTED]";
  }
  [inspect.custom](): string {
    return "[REDACTED]";
  }
  destroy(): void {
    this.#guard?.stop();
    this.#bytes.fill(0);
  }
}
export function takeRoleKey(
  role: Role,
  env: NodeJS.ProcessEnv = process.env,
): RoleKey | undefined {
  const variable = roleKeyVariables[role];
  if (!variable) return undefined;
  const value = env[variable];
  delete env[variable];
  if (!value) throw new EnvironmentError(variable);
  let bytes: Uint8Array | undefined;
  try {
    if (value.trim().startsWith("[")) {
      const parsed: unknown = JSON.parse(value);
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 64 ||
        !parsed.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)
      )
        throw new Error();
      bytes = Uint8Array.from(parsed);
    } else bytes = bs58.decode(value);
    if (bytes.length !== 64) throw new Error();
    return new RoleKey(Keypair.fromSecretKey(bytes));
  } catch (error) {
    warnCause("role_key_invalid", error);
    throw new EnvironmentError(variable);
  } finally {
    bytes?.fill(0);
  }
}
