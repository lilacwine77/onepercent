import type { ServiceRuntime } from "@onepercent/service-kit";
import { RoyaltiesResponse } from "@onepercent/web-api";
import { describe, expect, it, vi } from "vitest";
import { WebRoyalties, ROYALTIES_PAGE_SEQUENCES } from "./royalties.js";
import { createWebDependencies } from "./deps.js";
import { createWebRouter } from "./router.js";

const wallet = "11111111111111111111111111111111";
const row = {
  seq: "42",
  pack: 0,
  lamports: "2000000",
  refund: "406400",
  paid: "2406400",
  edition: 0,
  mint: "So11111111111111111111111111111111111111112",
  sig: "1".repeat(64),
  ts: 1800000000,
  redirected: false,
};
function setup(rows: unknown[] = [row]) {
  const query = vi.fn<
    (sql: string, values: unknown[]) => Promise<{ rows: unknown[] }>
  >(async () => ({ rows }));
  const royalties = new WebRoyalties({
    query,
  } as unknown as ServiceRuntime["pool"]);
  const deps = createWebDependencies({
    XRAY_SOURCE: "fixtures",
    LOG_LEVEL: "silent",
  });
  deps.royalties = royalties;
  deps.logger = { warn: vi.fn() };
  return { royalties, query, deps, app: createWebRouter(deps) };
}

describe("royalty history", () => {
  it("queries confirmed settled rows read-only with a complete-sequence cursor", async () => {
    const { app, query } = setup([
      row,
      { ...row, mint: wallet },
      { ...row, seq: "41", pack: 1, edition: 3 },
    ]);
    const response = await app.request(`/api/royalties/${wallet}?before=43`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = RoyaltiesResponse.parse(await response.json());
    expect(body.map((entry) => entry.seq)).toEqual([42n, 42n, 41n]);
    expect(body.map((entry) => entry.edition)).toEqual([
      "original",
      "original",
      "after_hours",
    ]);
    expect(body[0]?.lamports).toBe(2_000_000n);
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      wallet,
      "43",
      ROYALTIES_PAGE_SEQUENCES,
    ]);
    const sql = query.mock.calls[0]![0];
    expect(sql).toContain("SELECT DISTINCT r.seq");
    expect(sql).toContain("r.seq < $2::numeric");
    expect(sql).toContain("ORDER BY r.seq DESC LIMIT $3");
    expect(sql).toContain("d.pack = r.pack AND d.k = r.k");
    expect(sql).toContain("t.err IS NULL");
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });

  it("does not fabricate a received royalty when settlement was partial", async () => {
    const { app, deps } = setup([{ ...row, paid: "406400" }]);
    const response = await app.request(`/api/royalties/${wallet}`);
    expect(response.status).toBe(503);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      {
        reason: "web_route_failed",
        route: "royalties",
        cause: { code: "Error", detail: "Royalty allocation unavailable" },
      },
      "Web request failed",
    );
    expect(await response.text()).not.toContain(wallet);
  });

  it("preserves redirected rows and excludes a deposit from the royalty amount", async () => {
    const { royalties } = setup([{ ...row, paid: "0", redirected: true }]);
    expect(await royalties.get(wallet)).toEqual([
      {
        seq: 42n,
        pack: 0,
        lamports: 2_000_000n,
        edition: "original",
        mint: row.mint,
        sig: row.sig,
        ts: row.ts,
        redirected: true,
      },
    ]);
  });

  it("returns an empty page and rejects invalid query fields before querying", async () => {
    const { app, query } = setup([]);
    for (const path of [
      "/api/royalties/bad",
      `/api/royalties/${wallet}?before=-1`,
      `/api/royalties/${wallet}?before=18446744073709551616`,
      `/api/royalties/${wallet}?limit=1000`,
    ])
      expect((await app.request(path)).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
    const response = await app.request(`/api/royalties/${wallet}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("does not invent a time or edition for malformed indexed data", async () => {
    for (const patch of [{ ts: null }, { edition: 4 }, { mint: "bad" }]) {
      const { app } = setup([{ ...row, ...patch }]);
      expect((await app.request(`/api/royalties/${wallet}`)).status).toBe(503);
    }
  });
});
