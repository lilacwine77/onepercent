import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WEB, validateWebParams, webParamsSchema } from "../src/index.js";

const appRoot = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
);

describe("WEB parameters", () => {
  it("matches published PARAMS 26.2 plus bounded web transport extensions", () => {
    const params = readFileSync(
      resolve(appRoot, "../docs/codex/PARAMS.md"),
      "utf8",
    );
    const block = params
      .split("### 26.2 `WEB`")[1]!
      .split("```ts")[1]!
      .split("```")[0]!;
    const entries = [...block.matchAll(/^\s+(\w+):\s*(\[[^\]]*\]|[\d_]+),/gm)];
    expect(entries.length).toBe(block.match(/^\s+\w+:/gm)?.length);
    const documented = Object.fromEntries(
      entries.map(([, key, raw]) => [
        key,
        raw!.startsWith("[")
          ? [...raw!.matchAll(/'([^']*)'/g)].map((match) => match[1])
          : Number(raw!.replaceAll("_", "")),
      ]),
    );
    expect(WEB).toMatchObject(documented);
    expect(Object.keys(WEB).sort()).toEqual(
      [
        ...Object.keys(documented),
        "streamDedupeMax",
        "streamFrameMaxBytes",
        "millisecondsPerSecond",
        "httpTimeoutMs",
        "turnstileTimeoutMs",
        "turnstileTokenMaxLength",
        "rpcSignaturePageSize",
        "rpcConcurrency",
        "rpcCapacityMaxAttempts",
        "rpcCapacityBackoffBaseMs",
        "rpcCapacityBackoffMaxMs",
      ].sort(),
    );
    expect(validateWebParams()).toEqual(WEB);
  });

  it.each([
    ["liveStaleAfterMs", { liveStaleAfterMs: 30_000 }],
    ["liveStaleAfterMs", { liveStaleAfterMs: 29_999 }],
    ["pullPollFastMs", { pullPollFastMs: WEB.pullPollSlowMs }],
    ["pullPollFastMs", { pullPollFastMs: WEB.pullPollSlowMs + 1 }],
    ["machinePollMs", { machinePollMs: WEB.machinePollHiddenMs }],
    ["machinePollMs", { machinePollMs: WEB.machinePollHiddenMs + 1 }],
    ["valuesBatchMax", { valuesBatchMax: WEB.valuesNowPerMinutePerIp + 1 }],
    ["rpcSignaturePageSize", { rpcSignaturePageSize: 11 }],
    [
      "rpcCapacityBackoffMaxMs",
      { rpcCapacityBackoffMaxMs: WEB.rpcCapacityBackoffBaseMs - 1 },
    ],
    ["rpcCapacityBackoffMaxMs", { rpcCapacityBackoffMaxMs: WEB.httpTimeoutMs }],
  ])("rejects an invalid %s relation (%j)", (field, override) => {
    expect(() => validateWebParams({ ...WEB, ...override })).toThrow();
    const result = webParamsSchema.safeParse({ ...WEB, ...override });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.path[0])).toContain(
        field,
      );
  });

  it("allows the inclusive values batch boundary", () => {
    expect(() =>
      validateWebParams({
        ...WEB,
        valuesBatchMax: WEB.valuesNowPerMinutePerIp,
      }),
    ).not.toThrow();
  });

  it("requires every numeric value to be a positive integer", () => {
    for (const [key, value] of Object.entries(WEB)) {
      if (typeof value !== "number") continue;
      for (const invalid of [0, -1, 0.5, Number.POSITIVE_INFINITY])
        expect(
          () => validateWebParams({ ...WEB, [key]: invalid }),
          key,
        ).toThrow();
    }
  });

  it.each([
    "HTTPS://ipfs.io",
    "ipfs.io/path",
    "ipfs.io:443",
    "Ipfs.io",
    "a..example.com",
    "-host.example",
    "host-.example",
    "*example.com",
    "under_score.example",
    "",
    "a".repeat(64) + ".example",
  ])("rejects an invalid logo host %s", (host) => {
    expect(() => validateWebParams({ ...WEB, logoHosts: [host] })).toThrow();
  });

  it("decodes Jupiter allow-list IDs to exactly 32 bytes", () => {
    expect(() =>
      validateWebParams({
        ...WEB,
        jupiterProgramIds: ["1".repeat(32)],
      }),
    ).not.toThrow();
    for (const id of [
      "1".repeat(33),
      "2".repeat(32),
      "z".repeat(44),
      "0".repeat(32),
    ])
      expect(
        () => validateWebParams({ ...WEB, jupiterProgramIds: [id] }),
        id,
      ).toThrow();
  });
});
