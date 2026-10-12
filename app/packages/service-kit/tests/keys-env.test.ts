import { createHash } from "node:crypto";
import {
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  roles,
  roleKeyVariables,
  loadRoleEnv,
  EnvironmentError,
} from "../src/env.js";
import {
  takeRoleKey,
  RoleGuard,
  decodeConfigRoles,
  configRoleReader,
  type KeyRole,
} from "../src/keys.js";

const sensitive = [
  ...Object.values(roleKeyVariables).filter((x) => x !== null),
  "ADMIN_KEYPAIR",
  "MY_PRIVATE_KEY_FILE",
  "SECRET_KEY_JSON",
  "WALLET_MNEMONIC",
  "SEED_PHRASE_PATH",
];
describe("role isolation", () => {
  for (const role of roles)
    it(`${role}: every foreign name refused without revealing value`, () => {
      for (const name of sensitive.filter(
        (n) => n !== roleKeyVariables[role],
      )) {
        for (const value of ["sentinel-secret", ""])
          expect(() =>
            loadRoleEnv(role, z.object({}), { [name]: value }),
          ).toThrow(new EnvironmentError(name));
      }
      expect(loadRoleEnv(role, z.object({}), {})).toEqual({});
    });
  it("validation errors contain only field names", () =>
    expect(() =>
      loadRoleEnv("public", z.object({ RPC_URL: z.url() }), {
        RPC_URL: "secret-value",
      }),
    ).toThrow("RPC_URL"));
  it.each(["json", "base58"])(
    "parses own %s and removes source; cannot sign unchecked",
    (encoding) => {
      const pair = Keypair.generate();
      const env = {
        KEEPER_KEYPAIR:
          encoding === "json"
            ? JSON.stringify([...pair.secretKey])
            : bs58.encode(pair.secretKey),
      };
      const key = takeRoleKey("keeper", env)!;
      expect(env.KEEPER_KEYPAIR).toBeUndefined();
      expect(key.publicKey.equals(pair.publicKey)).toBe(true);
      expect(JSON.stringify(key)).toBe('"[REDACTED]"');
      expect(() => key.signMessage(Buffer.from("test"))).toThrow(
        "config_unavailable",
      );
    },
  );
  it.each(["[]", "[256]", "invalid", "", JSON.stringify(Array(64).fill(0))])(
    "invalid own key never returned",
    (value) => {
      const env = { KEEPER_KEYPAIR: value };
      expect(() => takeRoleKey("keeper", env)).toThrow("KEEPER_KEYPAIR");
      expect(env.KEEPER_KEYPAIR).toBeUndefined();
    },
  );
});
function configData(pair: Keypair) {
  const data = Buffer.alloc(872);
  createHash("sha256").update("account:Config").digest().copy(data, 0, 0, 8);
  for (const offset of [104, 136, 168, 200])
    pair.publicKey.toBuffer().copy(data, offset);
  data[736] = 1;
  return data;
}
describe("Config roles", () => {
  it("a delayed Config read cannot extend its authorization interval", async () => {
    const pair = Keypair.generate();
    let now = 0;
    const guard = new RoleGuard({
      role: "keeper",
      publicKey: pair.publicKey,
      recheckSeconds: 60,
      now: () => now,
      readConfig: async () => {
        now = 60_000;
        return decodeConfigRoles(configData(pair));
      },
    });
    await guard.refresh();
    expect(guard.status()).toEqual({ ok: false, reason: "config_unavailable" });
    expect(() => guard.assertAuthorized()).toThrow("config_unavailable");
  });
  it("clock regression and stop during an in-flight check fail closed", async () => {
    const pair = Keypair.generate();
    let now = 100;
    const guard = new RoleGuard({
      role: "keeper",
      publicKey: pair.publicKey,
      recheckSeconds: 60,
      now: () => now,
      readConfig: async () => decodeConfigRoles(configData(pair)),
    });
    await guard.refresh();
    now = 0;
    expect(guard.status()).toEqual({ ok: false, reason: "config_unavailable" });
    const pending = guard.refresh();
    guard.stop();
    await pending;
    expect(guard.status()).toEqual({ ok: false, reason: "config_unavailable" });
  });
  for (const [role, bit] of [
    ["keeper", 3],
    ["executor", 4],
    ["intake-signer", 5],
    ["quote-signer", 6],
  ] as const)
    it(`${role}: mismatch, disabled, freshness and recovery guard every signature`, async () => {
      const pair = Keypair.generate();
      const key = takeRoleKey(role, {
        [roleKeyVariables[role]!]: bs58.encode(pair.secretKey),
      })!;
      const data = configData(pair);
      let now = 0;
      const guard = new RoleGuard({
        role,
        publicKey: key.publicKey,
        readConfig: async () => decodeConfigRoles(data),
        recheckSeconds: 60,
        now: () => now,
      });
      key.bind(guard);
      await guard.refresh();
      expect(guard.status()).toEqual({ ok: true });
      const tx = new VersionedTransaction(
        new TransactionMessage({
          payerKey: pair.publicKey,
          recentBlockhash: PublicKey.default.toBase58(),
          instructions: [],
        }).compileToV0Message(),
      );
      key.signTransaction(tx);
      expect(tx.signatures[0]!.some((x) => x !== 0)).toBe(true);
      data[742] = 1 << bit;
      await guard.refresh();
      expect(() => key.signTransaction(tx)).toThrow("role_disabled");
      data[742] = 0;
      await guard.refresh();
      now = 60000;
      expect(() => key.signTransaction(tx)).toThrow("config_unavailable");
      await guard.refresh();
      expect(key.signMessage(Buffer.from("hello"))).toHaveLength(64);
      guard.stop();
      expect(() => key.signMessage(Buffer.from("hello"))).toThrow(
        "config_unavailable",
      );
    });
  it("mismatch and RPC failure cannot authorize", async () => {
    const pair = Keypair.generate();
    let fail = false;
    const guard = new RoleGuard({
      role: "keeper",
      publicKey: pair.publicKey,
      readConfig: async () => {
        if (fail) throw new Error("rpc url secret");
        return decodeConfigRoles(configData(Keypair.generate()));
      },
      recheckSeconds: 60,
    });
    await guard.refresh();
    expect(guard.status()).toEqual({ ok: false, reason: "role_mismatch" });
    fail = true;
    await guard.refresh();
    expect(guard.status()).toEqual({ ok: false, reason: "config_unavailable" });
  });
  it("checks canonical PDA, owner, size, discriminator, version and bump", async () => {
    const program = Keypair.generate().publicKey;
    const [address, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program,
    );
    const data = configData(Keypair.generate());
    data[737] = bump;
    const account = { owner: program, data, executable: false, slot: 1 };
    const rpc = { account: vi.fn(async () => account) };
    const read = configRoleReader(rpc, program);
    await read();
    expect(rpc.account).toHaveBeenCalledWith(address);
    for (const offset of [0, 736, 737]) {
      const old = data[offset]!;
      data[offset] = old ^ 1;
      await expect(read()).rejects.toThrow("config_unavailable");
      data[offset] = old;
    }
    account.owner = PublicKey.default;
    await expect(read()).rejects.toThrow("config_unavailable");
    expect(() => decodeConfigRoles(Buffer.alloc(871))).toThrow(
      "config_unavailable",
    );
  });
  it("each role checks only its own disable bit", async () => {
    const pair = Keypair.generate();
    const data = configData(pair);
    data[742] = 1 << 4;
    const guard = new RoleGuard({
      role: "keeper" as KeyRole,
      publicKey: pair.publicKey,
      readConfig: async () => decodeConfigRoles(data),
      recheckSeconds: 60,
    });
    await guard.refresh();
    expect(guard.status()).toEqual({ ok: true });
  });

  it("never waits for or propagates unavailable-role notification failures", async () => {
    const pair = Keypair.generate();
    let config = configData(Keypair.generate());
    const notify = vi
      .fn<() => void | Promise<void>>()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(() =>
        Promise.reject(new Error("notification failed")),
      )
      .mockImplementationOnce(() => {
        throw new Error("notification failed");
      });
    const guard = new RoleGuard({
      role: "keeper",
      publicKey: pair.publicKey,
      readConfig: async () => decodeConfigRoles(config),
      recheckSeconds: 60,
      onUnavailable: notify,
    });
    for (let i = 0; i < 3; i++) {
      await guard.refresh();
      expect(guard.status()).toEqual({ ok: false, reason: "role_mismatch" });
    }
    expect(notify).toHaveBeenCalledTimes(3);
    config = configData(pair);
    await guard.refresh();
    expect(guard.status()).toEqual({ ok: true });
  });
});
