import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { MarketError } from "./errors.js";
import { validateMints } from "./jupiter/price.js";
import { type PriceSource } from "./price-source.js";

export interface StaticPriceSourceData {
  prices?: Awaited<ReturnType<PriceSource["getPrices"]>>;
  tokenInfo?: Awaited<ReturnType<PriceSource["getTokenInfo"]>>;
  solUsd: number;
}

export function createStaticPriceSource(
  data: StaticPriceSourceData,
): PriceSource {
  return {
    async getPrices(input) {
      return Object.fromEntries(
        validateMints(input).map((mint) => [
          mint,
          structuredClone(data.prices?.[mint]),
        ]),
      );
    },
    async getTokenInfo(input) {
      return Object.fromEntries(
        validateMints(input).map((mint) => [
          mint,
          structuredClone(data.tokenInfo?.[mint]),
        ]),
      );
    },
    async getSolUsd() {
      return data.solUsd;
    },
  };
}

const fixtureSchema = z
  .object({
    recordedAt: z.string(),
    request: z
      .object({
        method: z.string(),
        url: z.string(),
        body: z.unknown().optional(),
      })
      .passthrough(),
    response: z
      .object({
        status: z.number().int(),
        headers: z.record(z.string(), z.string()).optional(),
        body: z.unknown(),
      })
      .passthrough(),
  })
  .passthrough();

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "";
}

function requestKey(method: string, rawUrl: string, body?: unknown): string {
  const parsed = jsonValue(body);
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "jsonrpc" in parsed &&
    "method" in parsed
  ) {
    const { method: rpcMethod, params } = parsed as {
      method: unknown;
      params?: unknown;
    };
    // RPC transport URLs are placeholders in fixtures; request ids are incidental.
    return `${method.toUpperCase()}:rpc:${stable({ method: rpcMethod, params })}`;
  }
  const url = new URL(rawUrl);
  const query = [...url.searchParams.entries()].sort(
    ([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv),
  );
  return `${method.toUpperCase()}:${url.pathname}:${stable(query)}:${stable(parsed)}`;
}

function fixtureFiles(path: string): string[] {
  try {
    if (statSync(path).isFile()) return [path];
    return readdirSync(path, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) =>
        entry.isDirectory()
          ? fixtureFiles(join(path, entry.name))
          : entry.name.endsWith(".json")
            ? [join(path, entry.name)]
            : [],
      );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      throw new MarketError("PROVIDER_SCHEMA", { message: "missing fixture" });
    }
    throw error;
  }
}

/** Offline fetch. A file, a directory, or an explicit file list can select a scenario. */
export function fixtureFetch(
  dir: string | URL | readonly (string | URL)[],
): typeof fetch {
  const inputs = typeof dir === "string" || dir instanceof URL ? [dir] : dir;
  const files = inputs.flatMap((input) =>
    fixtureFiles(input instanceof URL ? fileURLToPath(input) : input),
  );
  const fixtures = files.map((path) =>
    fixtureSchema.parse(JSON.parse(readFileSync(path, "utf8"))),
  );
  const byRequest = new Map<string, typeof fixtures>();
  for (const fixture of fixtures) {
    const key = requestKey(
      fixture.request.method,
      fixture.request.url,
      fixture.request.body,
    );
    const matches = byRequest.get(key) ?? [];
    matches.push(fixture);
    byRequest.set(key, matches);
  }
  const cursors = new Map<string, number>();
  return async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    const body =
      init?.body ??
      (input instanceof Request ? await input.clone().text() : undefined);
    const key = requestKey(method, url, body);
    const matches = byRequest.get(key);
    if (!matches?.length) {
      // Do not include a URL, body, or query here: the live request may contain credentials.
      throw new MarketError("PROVIDER_SCHEMA", {
        message: `missing fixture for ${method.toUpperCase()} request`,
      });
    }
    const cursor = cursors.get(key) ?? 0;
    const fixture = matches[Math.min(cursor, matches.length - 1)];
    if (!fixture)
      throw new MarketError("PROVIDER_SCHEMA", { message: "missing fixture" });
    cursors.set(key, cursor + 1);
    return new Response(
      typeof fixture.response.body === "string"
        ? fixture.response.body
        : JSON.stringify(fixture.response.body),
      {
        status: fixture.response.status,
        headers: {
          "content-type": "application/json",
          ...fixture.response.headers,
        },
      },
    );
  };
}
