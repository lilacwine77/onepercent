import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { RpcUnavailable, type ServiceRuntime } from "@onepercent/service-kit";
import { parseFeeCliOptions, runFeeMeasurementCli } from "./fee-cli.js";
import { MAINNET_GENESIS_HASH } from "./fee-measurement.js";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
it("requires explicit output and pool groups and rejects unrelated signing options", () => {
  expect(() => parseFeeCliOptions([])).toThrow();
  expect(() => parseFeeCliOptions(["--output", "evidence.jsonl"])).toThrow();
  expect(() =>
    parseFeeCliOptions([
      "--output",
      "evidence.jsonl",
      "--report",
      "--keypair",
      "private.json",
    ]),
  ).toThrow();
  expect(
    parseFeeCliOptions(["--output", "evidence.jsonl", "--report"]),
  ).toMatchObject({ report: true, once: false });
});
it("collects, resumes and reports only public fixtures, releasing the file lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "onepct-fee-cli-"));
  temporary.push(directory);
  const output = join(directory, "evidence.jsonl");
  const groups = join(directory, "groups.json");
  await writeFile(
    groups,
    JSON.stringify([
      { name: "major", accounts: ["11111111111111111111111111111111"] },
    ]),
  );
  const request = vi.fn(async (method: string) => {
    if (method === "getGenesisHash") return MAINNET_GENESIS_HASH;
    if (method === "getMultipleAccounts")
      return {
        context: { slot: 1 },
        value: [
          {
            owner: "Vote111111111111111111111111111111111111111",
            executable: false,
          },
        ],
      };
    if (method === "getRecentPrioritizationFees")
      return [{ slot: 1, prioritizationFee: 500 }];
    throw new Error("unexpected_rpc");
  });
  const write = vi.fn();
  const dependencies = {
    rpc: { request: request as ServiceRuntime["rpc"]["request"] },
    now: () => 1_800_000_000_000,
    write,
  };
  request.mockRejectedValueOnce(new RpcUnavailable());
  let elapsed = 0;
  const sleep = vi.fn(async (milliseconds: number) => {
    elapsed += milliseconds;
  });
  const first = await runFeeMeasurementCli(
    ["--groups", groups, "--output", output, "--once"],
    { ...dependencies, now: () => dependencies.now() + elapsed, sleep },
  );
  expect(sleep).toHaveBeenCalledOnce();
  expect(elapsed).toBeGreaterThan(0);
  expect(elapsed).toBeLessThan(60_000);
  expect(first?.sampleCount).toBe(1);
  expect(first?.maxComputeUnitPriceMicroLamports).toBeNull();
  const second = await runFeeMeasurementCli(
    ["--groups", groups, "--output", output, "--once"],
    { ...dependencies, now: () => dependencies.now() + 60_000 },
  );
  expect(second?.sampleCount).toBe(2);
  request.mockClear();
  const report = await runFeeMeasurementCli(["--output", output, "--report"], {
    env: {},
    write,
  });
  expect(report?.sampleCount).toBe(2);
  expect(request).not.toHaveBeenCalled();
  expect((await readFile(output, "utf8")).trim().split("\n")).toHaveLength(3);
  await expect(readFile(`${output}.lock`)).rejects.toMatchObject({
    code: "ENOENT",
  });
});
