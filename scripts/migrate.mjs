// Deploy-step migrator. Runs from vercel.json's buildCommand so DDL is applied
// once, before any instance serves traffic — never from the request path.
//
// Reads DIRECT_DATABASE_URL and deliberately does NOT fall back to
// DATABASE_URL. Two reasons, both load-bearing:
//  1. DDL and the session-scoped advisory lock below must reach Neon's direct
//     host, not the PgBouncer `-pooler` one that DATABASE_URL points at.
//  2. A build is not a deploy. Scope this var to the Production environment
//     only and preview/branch builds hit the skip path instead of migrating
//     the database they happen to be pointed at.
//
// The advisory lock is ours because drizzle's migrator has none: two runners
// (a redeploy racing another build) would otherwise apply the same migration
// twice. The key is an arbitrary constant, shared only with this script.
import "./load-env.mjs";
import { pgOptions, explainPgError } from "./pg-connect.mjs";

const LOCK_KEY = 727144907;

const url = process.env.DIRECT_DATABASE_URL;

if (!url || !url.startsWith("postgres")) {
  // Expected on local builds and on any environment without an explicit direct
  // URL — PGlite self-migrates via dbReady(), and previews shouldn't run DDL.
  console.log("migrate: DIRECT_DATABASE_URL not set to a postgres URL, skipping");
  process.exit(0);
}

const { default: pg } = await import("pg");
// A single Client, not a Pool — an advisory lock is session-scoped, so the
// lock, the migration and the unlock must all run on the same connection.
const client = new pg.Client(pgOptions(url));

try {
  await client.connect();
  await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
  try {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log("migrate: migrations applied");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]);
  }
} catch (err) {
  // A connection failure here fails the build, so it has to say what to check
  // rather than only what threw — the operator is reading a Vercel build log.
  console.error("migrate: failed");
  console.error(explainPgError(err, url));
  console.error(err);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
