import { describe, expect, it } from "vitest";
import { loadWorkerRole } from "./roles.js";

const env = {
  DATABASE_URL: "postgresql://localhost/onepercent",
  REDIS_URL: "redis://localhost:6379",
  RPC_URL: "http://localhost:8899",
  PROGRAM_ID: "11111111111111111111111111111111",
  LOG_IP_SALT: "test-only",
};

describe("worker runtime roles", () => {
  it("defaults to indexer and the private runtime listener", () => {
    expect(loadWorkerRole(env)).toMatchObject({
      role: "indexer",
      env: { PRIVATE_PORT: 3001, PRIVATE_HOST: "127.0.0.1" },
    });
  });
  it.each(["indexer", "keeper", "executor", "monitor"])(
    "accepts %s with coherent runtime settings",
    (role) => {
      expect(loadWorkerRole({ ...env, ROLE: role }).role).toBe(role);
    },
  );
  it("rejects public roles and foreign key variables", () => {
    expect(() => loadWorkerRole({ ...env, ROLE: "public" })).toThrow("ROLE");
    expect(() =>
      loadWorkerRole({ ...env, ROLE: "keeper", EXECUTOR_KEYPAIR: "" }),
    ).toThrow("EXECUTOR_KEYPAIR");
  });
});
