import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import { z } from "zod";

export const migrationsFolder = fileURLToPath(
  new URL("../drizzle/", import.meta.url),
);
const appliedMigrationSchema = z.object({
  hash: z.string(),
  created_at: z.coerce.bigint(),
});
const journalSchema = z.object({
  entries: z.array(z.object({ tag: z.string(), when: z.number().int() })),
});

/** Forward-only, serialized across simultaneous Railway pre-deploy commands. */
export async function applyMigrations(
  pool: Pool,
  folder = migrationsFolder,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext('onepct:migrations'))",
    );
    const versionResult = await client.query<{ server_version_num: string }>(
      "SHOW server_version_num",
    );
    const version = Number(versionResult.rows[0]?.server_version_num);
    if (!Number.isInteger(version) || Math.floor(version / 10_000) !== 17) {
      throw new Error("Database migrations require Postgres 17");
    }
    const journal = journalSchema.parse(
      JSON.parse(await readFile(`${folder}/meta/_journal.json`, "utf8")),
    );
    const files = (await readdir(folder)).filter((name) =>
      name.endsWith(".sql"),
    );
    if (
      files.length !== journal.entries.length ||
      journal.entries.some((entry) => !files.includes(`${entry.tag}.sql`))
    ) {
      throw new Error("Migration files do not match the journal");
    }
    const exists = await client.query<{ present: string | null }>(
      "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS present",
    );
    if (exists.rows[0]?.present) {
      const applied = await client.query(
        "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
      );
      for (const [index, row] of applied.rows.entries()) {
        const saved = appliedMigrationSchema.parse(row);
        const expected = journal.entries[index];
        if (!expected || BigInt(expected.when) !== saved.created_at) {
          throw new Error(
            "Applied migration history is not a prefix of the committed journal",
          );
        }
        const contents = await readFile(`${folder}/${expected.tag}.sql`);
        if (
          createHash("sha256").update(contents).digest("hex") !== saved.hash
        ) {
          throw new Error(
            "An applied migration was modified; add a forward migration",
          );
        }
      }
    }
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    // A broken session releases its advisory lock when PostgreSQL closes it.
    try {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('onepct:migrations'))",
      );
      client.release();
    } catch {
      client.release(true);
    }
  }
}
