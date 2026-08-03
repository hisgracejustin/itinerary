import { drizzle as drizzleNode, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";

/**
 * Driver switch:
 *  - DATABASE_URL set (postgres://… → node-postgres Pool): production/preview,
 *    pointed at Neon (use the pooled `-pooler` connection string on Vercel).
 *  - No DATABASE_URL: embedded PGlite persisted under .data/pglite — zero-setup
 *    local dev. Migrations are applied on first touch via dbReady(); in
 *    production they're applied at deploy time by scripts/migrate.mjs instead.
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
      // Fail fast instead of hanging until the function timeout when Neon's
      // compute is unreachable.
      connectionTimeoutMillis: 5_000,
    });
    // An idle client emitting an error would otherwise crash the process.
    pool.on("error", (err: Error) => console.error("[db] idle client error", err));
    return drizzleNode(pool, { schema, casing: "snake_case" });
  }
  // Never silently fall back to an ephemeral in-container PGlite in production —
  // that "works" (an empty DB per instance) and loses every write on cold start.
  // `next build` sets NEXT_PHASE, so a local build without DATABASE_URL still
  // passes page-data collection; at serve time a missing URL is a hard error.
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error("DATABASE_URL must be a postgres:// URL in production");
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
 * per process (memoized) for dev databases. Production skips it entirely:
 * migrations are applied as a deploy step by scripts/migrate.mjs, so a request
 * never races DDL and a cold instance never runs a migration under a timeout.
 */
export function dbReady(): Promise<void> {
  if (globalThis.__itinDbReady) return globalThis.__itinDbReady;
  const url = process.env.DATABASE_URL;
  const run = async () => {
    if (url && url.startsWith("postgres")) {
      if (process.env.NODE_ENV === "production") return;
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      await migrate(db as NodePgDatabase<typeof schema>, { migrationsFolder: "./drizzle" });
    } else {
      const { migrate } = await import("drizzle-orm/pglite/migrator");
      await migrate(db as PgliteDatabase<typeof schema>, { migrationsFolder: "./drizzle" });
    }
  };
  // Clear the memo if migration fails so the next request retries instead of
  // re-awaiting a permanently-rejected promise (which would brick this warm
  // serverless instance until it's recycled).
  globalThis.__itinDbReady = run().catch((e) => {
    globalThis.__itinDbReady = undefined;
    throw e;
  });
  return globalThis.__itinDbReady;
}

/**
 * Run `fn` inside a single database transaction so multi-statement writes commit
 * atomically (e.g. replacing split rows alongside their parent row). The cast
 * localizes the union-type (`NodePgDatabase | PgliteDatabase`) transaction call;
 * the `tx` handle exposes the same query builders as `db` at runtime.
 */
export function transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  const runner = db as NodePgDatabase<typeof schema>;
  return runner.transaction((tx) => fn(tx as unknown as Db)) as Promise<T>;
}

export * as tables from "./schema";
