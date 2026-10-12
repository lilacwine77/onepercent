import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bearerMatches } from "../src/auth.js";
import {
  EnvironmentError,
  loadRoleEnv,
  roles,
  roleKeyVariables,
  runtimeEnvSchema,
} from "../src/env.js";
import { isEncodedKeypair } from "../src/log.js";

describe("internal bearer authentication", () => {
  const token = "internal-token-".repeat(3);
  it("accepts only a complete matching bearer token", () => {
    expect(bearerMatches(`Bearer ${token}`, token)).toBe(true);
    expect(bearerMatches(`bearer ${token}`, token)).toBe(true);
    for (const header of [
      undefined,
      "",
      token,
      `Basic ${token}`,
      `Bearer ${token}x`,
      `Bearer ${token} `,
      `Bearer  ${token}`,
      "Bearer short",
    ]) {
      expect(bearerMatches(header, token)).toBe(false);
    }
    expect(bearerMatches("Bearer short", "short")).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches(`Bearer ${"é".repeat(32)}`, "x".repeat(32))).toBe(
      false,
    );
  });
  it("requires at least 32 characters whenever INTERNAL_TOKEN is configured", () => {
    const schema = runtimeEnvSchema.pick({ INTERNAL_TOKEN: true });
    expect(schema.safeParse({ INTERNAL_TOKEN: "x".repeat(31) }).success).toBe(
      false,
    );
    expect(schema.safeParse({ INTERNAL_TOKEN: "x".repeat(32) }).success).toBe(
      true,
    );
    expect(schema.safeParse({}).success).toBe(true);
  });
});

describe("key material isolation independent of variable names", () => {
  const pair = Keypair.generate();
  const encodings = [
    bs58.encode(pair.secretKey),
    JSON.stringify([...pair.secretKey]),
  ];
  for (const role of roles) {
    it(`${role} rejects disguised key material and reports the variable name only`, () => {
      for (const encoded of encodings) {
        expect(() =>
          loadRoleEnv(role, z.object({}), { HELIUS_API_KEY: encoded }),
        ).toThrow(new EnvironmentError("HELIUS_API_KEY"));
        const own = roleKeyVariables[role];
        if (own)
          expect(loadRoleEnv(role, z.object({}), { [own]: encoded })).toEqual(
            {},
          );
      }
    });
  }
  it("validates the Ed25519 public half without mistaking ordinary credentials for keys", () => {
    for (const encoded of encodings)
      expect(isEncodedKeypair(encoded)).toBe(true);
    const invalid = Uint8Array.from(pair.secretKey);
    invalid[63] = invalid[63]! ^ 1;
    for (const value of [
      bs58.encode(invalid),
      JSON.stringify([...invalid]),
      "[256]",
      "[",
      "provider-token",
      "x".repeat(64),
      pair.publicKey.toBase58(),
    ]) {
      expect(isEncodedKeypair(value)).toBe(false);
      expect(
        loadRoleEnv("public", z.object({}), { HELIUS_API_KEY: value }),
      ).toEqual({});
    }
  });
});
