import { createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { createServiceLogger, hashClientIp, sanitizeLogValue } from "./log.js";

describe("service logs", () => {
  it("redacts nested credentials, both own-key formats and URLs including free text", () => {
    const pair = Keypair.generate();
    const encoded = bs58.encode(pair.secretKey);
    const array = JSON.stringify(Array.from(pair.secretKey));
    const lines: string[] = [];
    const logger = createServiceLogger(
      {
        service: "api",
        role: "intake-signer",
        cluster: "devnet",
        version: "test",
        commit: "test",
      },
      {
        ipSalt: "test-salt",
        secretValues: ["provider-value"],
        destination: { write: (line) => lines.push(line) },
      },
    );
    logger.info(
      {
        nested: [
          {
            secretKey: pair.secretKey,
            authorization: "Bearer credentials",
            "x-api-key": "headers-value",
          },
        ],
        rpc: "https://user:password@rpc.example.invalid/private-path?api-key=query-value",
        arbitrary: `${encoded} or ${array}`,
        bytes: pair.secretKey,
        array: Array.from(pair.secretKey),
        clientIp: "192.0.2.1",
        body: { wallet: "should-not-log-request" },
        err: new Error(
          "provider-value https://rpc.example.invalid/v1?api-key=error-value",
        ),
      },
      "failed api-key=free-text-value",
    );
    logger.info(
      "interpolated %o %s",
      { nested: { secretKey: "another-value" } },
      encoded,
    );
    logger
      .child({ authorization: "child-value", role: "untrusted-role" })
      .info({ service: "untrusted-service" }, "child");
    logger.setBindings({ authorization: "binding-value" });
    logger.info("after bindings");
    const output = lines.join("");
    for (const forbidden of [
      encoded,
      array,
      "credentials",
      "headers-value",
      "query-value",
      "free-text-value",
      "provider-value",
      "error-value",
      "another-value",
      "child-value",
      "binding-value",
      "untrusted-role",
      "untrusted-service",
      "private-path",
      "https://",
      "192.0.2.1",
      "should-not-log-request",
      "api-key=",
    ]) {
      expect(output).not.toContain(forbidden);
    }
    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toMatchObject({
      service: "api",
      role: "intake-signer",
      cluster: "devnet",
      version: "test",
      commit: "test",
      rpc: "rpc.example.invalid",
      clientIp: hashClientIp("test-salt", "192.0.2.1"),
    });
    expect(parsed.nested[0].secretKey).toBe("[redacted]");
  });

  it("does not execute arbitrary getters or toJSON and handles cycles", () => {
    const input: Record<string, unknown> = {
      count: 10n,
      toJSON: () => {
        throw new Error("must not run");
      },
    };
    Object.defineProperty(input, "getter", {
      enumerable: true,
      get() {
        throw new Error("must not run");
      },
    });
    input["self"] = input;
    expect(sanitizeLogValue(input, { ipSalt: "salt" })).toEqual({
      count: "10",
      getter: "[redacted]",
      self: "[circular]",
    });
  });

  it("hashes the salt followed by the IP without logging the salt", () => {
    expect(hashClientIp("salt", "2001:db8::1")).toBe(
      createHash("sha256").update("salt2001:db8::1").digest("hex"),
    );
    expect(() => hashClientIp("", "192.0.2.1")).toThrow("LOG_IP_SALT");
  });
});
