import { drizzle as drizzleNode, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";

/**
 * Driver switch:
 *  - DATABASE_URL set (postgres://… → node-postgres Pool): production/preview,
 *    pointed at Neon (use the pooled `-pooler` connection string on Vercel).
 *  - No DATABASE_URL: embedded PGlite persisted under .data/pglite — zero-setup
 *    local dev. Migrations are applied automatically on first touch via dbReady().
 */
export type Db = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

declare global {
  var __itinDb: Db | undefined;
  var __itinDbReady: Promise<void> | undefined;
}

function createDb(): Db {
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith("postgres")) {
    const { Pool } = require("pg");
    // Serverless-friendly pool: a small cap per warm instance (Neon's pooler
    // multiplexes across instances) and an idle timeout well under Neon's
    // autosuspend so we don't hold connections open against a suspended compute.
    const pool = new Pool({
      connectionString: url,
      max: 5,
      idleTimeoutMillis: 10_000,
    });
    return drizzleNode(pool, { schema, casing: "snake_case" });
  }
  // Local dev fallback — persistent embedded Postgres.
  const dir = process.env.PGLITE_DIR ?? ".data/pglite";
  if (dir !== "memory://") {
    // PGlite won't create parent directories itself.
    require("node:fs").mkdirSync(dir, { recursive: true });
  }
  return drizzlePglite(dir, { schema, casing: "snake_case" });
}

export const db: Db = globalThis.__itinDb ?? (globalThis.__itinDb = createDb());

/**
 * Await before queries. Applies pending migrations from ./drizzle exactly once
 * per process (memoized): node-postgres in production, PGlite in local dev.
 * The static import specifiers let Next trace both migrators into the build, and
 * `drizzle/` ships with it so a cold serverless instance can self-migrate.
 */
export function dbReady(): Promise<void> {
  if (globalThis.__itinDbReady) return globalThis.__itinDbReady;
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith("postgres")) {
    globalThis.__itinDbReady = (async () => {
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      await migrate(db as NodePgDatabase<typeof schema>, { migrationsFolder: "./drizzle" });
    })();
  } else {
    globalThis.__itinDbReady = (async () => {
      const { migrate } = await import("drizzle-orm/pglite/migrator");
      await migrate(db as PgliteDatabase<typeof schema>, { migrationsFolder: "./drizzle" });
    })();
  }
  return globalThis.__itinDbReady;
}

export * as tables from "./schema";
