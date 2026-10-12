import "../../link/tests/setup.js";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createApi } from "../../app.js";
import { encodeBase58 } from "../../link/base58.js";
import { InMemoryLinkRateLimiter } from "../../link/ratelimit.js";
import { applyMigrations, createDatabase } from "@onepercent/db";
import { SERVICES } from "@onepercent/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PgLinkStore } from "../../link/store-pg.js";
import { InMemoryLinkStore, type LinkStore } from "../../link/store.js";
import { PgGoStore } from "../store-pg.js";
import { InMemoryGoStore, type GoStore } from "../store.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = process.env.SERVICES_INTEGRATION === "1";
if (
  enabled &&
  (!databaseUrl ||
    !["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(databaseUrl).hostname,
    ))
)
  throw new Error("Store integration requires a local TEST_DATABASE_URL");
const addressA = "11111111111111111111111111111111";
const addressB = "So11111111111111111111111111111111111111112";
for (const kind of ["memory", "postgres"] as const)
  describe.skipIf(kind === "postgres" && !enabled)(
    `${kind} M5 store contracts`,
    () => {
      let now: number;
      let links: LinkStore;
      let go: GoStore;
      let admin: ReturnType<typeof createDatabase> | undefined;
      let database: ReturnType<typeof createDatabase> | undefined;
      const name = `onepct_m5_${randomUUID().replaceAll("-", "")}`;
      beforeAll(async () => {
        if (kind !== "postgres") return;
        const settings = {
          connectionTimeoutMillis: SERVICES.transport.dbStatementTimeoutMs,
          statement_timeout: SERVICES.transport.dbStatementTimeoutMs,
          query_timeout: SERVICES.transport.dbStatementTimeoutMs,
        };
        admin = createDatabase({ ...settings, connectionString: databaseUrl });
        await admin.pool.query(`CREATE DATABASE "${name}"`);
        const isolated = new URL(databaseUrl!);
        isolated.pathname = `/${name}`;
        database = createDatabase({
          ...settings,
          connectionString: isolated.href,
        });
        await applyMigrations(database.pool);
      }, 30_000);
      afterAll(async () => {
        await database?.close();
        if (admin) {
          await admin.pool.query(`DROP DATABASE IF EXISTS "${name}"`);
          await admin.close();
        }
      });
      beforeEach(async () => {
        now = Date.parse("2026-10-08T12:00:00Z");
        if (database)
          await database.pool.query(
            "TRUNCATE link_nonces, tg_links, go_sessions, tg_chats, notify_jobs",
          );
        links = database
          ? new PgLinkStore(database.pool, () => now)
          : new InMemoryLinkStore(() => now);
        go = database ? new PgGoStore(database.pool) : new InMemoryGoStore();
      });
      it("keeps one open nonce and burns it once under concurrency", async () => {
        const first = await links.createNonce(1, "test_bot");
        const second = await links.createNonce(1, "test_bot");
        expect(await links.peekNonce(first.nonce)).toEqual({ status: "gone" });
        const results = await Promise.all(
          Array.from({ length: 10 }, () => links.takeNonce(second.nonce)),
        );
        expect(results.filter((value) => value.status === "open")).toHaveLength(
          1,
        );
        expect(results.filter((value) => value.status === "gone")).toHaveLength(
          9,
        );
        now += 660_001;
        expect(await links.peekNonce(first.nonce)).toEqual({
          status: "missing",
        });
        await links.purge(now);
      });
      it("closes earlier sessions during concurrent creation", async () => {
        const created = await Promise.all(
          Array.from({ length: 10 }, () => links.createNonce(1, "test_bot")),
        );
        const results = await Promise.all(
          created.map(({ nonce }) => links.peekNonce(nonce)),
        );
        expect(results.filter((value) => value.status === "open")).toHaveLength(
          1,
        );
      });
      it("verifies server-built SIWS once through the route and burns invalid attempts", async () => {
        const secret = "offline-contract-secret";
        const app = createApi(
          {
            WEB_ORIGIN: "https://onepercent.test",
            APP_VERSION: "test",
            GIT_COMMIT: "offline",
            BOT_API_SECRET: secret,
          },
          {
            linkStore: links,
            clock: () => now,
            linkRateLimiter: new InMemoryLinkRateLimiter(() => now),
            logger: { info: () => undefined },
          },
        );
        const post = (path: string, body: unknown) =>
          app.request(path, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${secret}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });
        const { publicKey, privateKey } = generateKeyPairSync("ed25519");
        const address = encodeBase58(
          Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url"),
        );
        const { nonce } = await (
          await post("/api/link/nonce", {
            telegramUserId: 1,
            botUsername: "test_bot",
          })
        ).json();
        const { message } = await (
          await app.request(`/api/link/session/${nonce}?address=${address}`)
        ).json();
        const signature = sign(null, Buffer.from(message), privateKey).toString(
          "base64",
        );
        expect(
          (await post("/api/link/verify", { nonce, address, signature }))
            .status,
        ).toBe(200);
        expect(
          (await post("/api/link/verify", { nonce, address, signature }))
            .status,
        ).toBe(410);
        expect(await links.telegramOf(address)).toBe(1);
        const invalid = await links.createNonce(2, "test_bot");
        expect(
          (await post("/api/link/verify", { nonce: invalid.nonce })).status,
        ).toBe(401);
        expect((await links.peekNonce(invalid.nonce)).status).toBe("gone");
      });
      it("replaces both binding directions and unbinds idempotently", async () => {
        await links.bind(1, addressA);
        await links.bind(2, addressB);
        await links.bind(1, addressB);
        expect(await links.walletOf(2)).toBeNull();
        expect(await links.telegramOf(addressA)).toBeNull();
        expect(await links.telegramOf(addressB)).toBe(1);
        expect(await links.unbind(1)).toBe(true);
        expect(await links.unbind(1)).toBe(false);
        expect(await links.walletOf(1)).toBeNull();
        expect(await links.telegramOf(addressB)).toBeNull();
      });
      it("redeems only once, preserves inputs and expires through grace", async () => {
        const input = {
          telegramUserId: 1,
          action: "rip" as const,
          edition: "after_hours" as const,
          n: 5,
          ref: "alice",
        };
        const rows = await go.create(input, 3, now);
        const results = await Promise.all(
          Array.from({ length: 10 }, () => go.redeem(rows[0]!.id, now)),
        );
        expect(results.filter((value) => value.status === "open")).toEqual([
          { status: "open", session: input },
        ]);
        expect(results.filter((value) => value.status === "gone")).toHaveLength(
          9,
        );
        now += 601_000;
        expect(await go.redeem(rows[1]!.id, now)).toEqual({ status: "gone" });
        now += 60_000;
        expect(await go.redeem(rows[1]!.id, now)).toEqual({
          status: "missing",
        });
        expect(await go.purge(now)).toBe(3);
        expect(await go.purge(now)).toBe(0);
      });
      it.skipIf(kind !== "postgres")(
        "persists bindings and sessions across store instances",
        async () => {
          await links.bind(1, addressA);
          const nonce = await links.createNonce(1, "test_bot");
          const [created] = await go.create(
            { telegramUserId: 1, action: "feed", ref: "alice" },
            1,
            now,
          );
          const reloadedLinks = new PgLinkStore(database!.pool, () => now);
          const reloadedGo = new PgGoStore(database!.pool);
          expect(await reloadedLinks.walletOf(1)).toEqual({
            wallet: addressA,
            linkedAt: new Date(now).toISOString(),
          });
          expect((await reloadedLinks.peekNonce(nonce.nonce)).status).toBe(
            "open",
          );
          expect(await reloadedGo.redeem(created!.id, now)).toEqual({
            status: "open",
            session: { telegramUserId: 1, action: "feed", ref: "alice" },
          });
        },
      );
      it.skipIf(kind !== "postgres")(
        "unbind disables alerts and skips queued jobs in the same transaction",
        async () => {
          await links.bind(1, addressA);
          await database!.pool.query(
            "INSERT INTO tg_chats (chat_id, kind, alerts, updated_at) VALUES (1, 'private', 'live', $1)",
            [new Date(now)],
          );
          await database!.pool.query(
            "INSERT INTO notify_jobs (dedupe_key, chat_id, kind, priority, payload, not_before, expires_at, created_at) VALUES ('test', 1, 'royalty', 1, '{}', $1, $2, $1)",
            [new Date(now), new Date(now + 1_000)],
          );
          await links.unbind(1);
          expect(
            (
              await database!.pool.query(
                "SELECT alerts FROM tg_chats WHERE chat_id = 1",
              )
            ).rows[0]?.alerts,
          ).toBe("off");
          expect(
            (
              await database!.pool.query(
                "SELECT status, outcome FROM notify_jobs WHERE chat_id = 1",
              )
            ).rows[0],
          ).toEqual({ status: "skipped", outcome: "opted_out" });
        },
      );
    },
  );
