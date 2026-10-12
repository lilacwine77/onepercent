#!/usr/bin/env node
import { z } from "zod";
import { createDatabase } from "./client.js";
import { applyMigrations } from "./migrate.js";

const connectionSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "postgres:" || protocol === "postgresql:";
  });

try {
  const connectionString = connectionSchema.parse(process.env.DATABASE_URL);
  const database = createDatabase({ connectionString });
  try {
    await applyMigrations(database.pool);
    process.stdout.write("Database migrations applied\n");
  } finally {
    await database.close();
  }
} catch {
  // Database errors may embed a password-bearing connection string.
  process.stderr.write(
    "Database migration failed; check DATABASE_URL and migration history\n",
  );
  process.exitCode = 1;
}
