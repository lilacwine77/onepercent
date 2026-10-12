import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export function createDatabase(config: PoolConfig) {
  const pool = new Pool(config);
  const db: Database = drizzle(pool, { schema });
  return { pool, db, close: () => pool.end() };
}
