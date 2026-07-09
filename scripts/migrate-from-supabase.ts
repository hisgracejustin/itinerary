/**
 * One-off data migration: Supabase Postgres → the new self-hosted Postgres.
 *
 * Reads from the old Supabase DB (SUPABASE_DB_URL, incl. the auth.users table)
 * and writes into the new DB (DATABASE_URL, schema already created by
 * `npm run db:migrate`). Idempotent: every insert is ON CONFLICT DO NOTHING.
 *
 * Key trick (see plan decision #2): each auth.users UUID is preserved verbatim
 * as the new text `users.id`, so every existing trip_members.user_id stays valid
 * with no remapping. Passwords are dropped — users re-authenticate with Google
 * (linked by email via allowDangerousEmailAccountLinking).
 *
 * Usage:
 *   SUPABASE_DB_URL=postgres://…supabase… DATABASE_URL=postgres://…new… \
 *     npm run migrate:supabase
 */
import "dotenv/config";
import { Pool } from "pg";

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SUPABASE_DB_URL) throw new Error("Set SUPABASE_DB_URL (source Supabase Postgres).");
if (!DATABASE_URL || !DATABASE_URL.startsWith("postgres")) {
  throw new Error("Set DATABASE_URL (target Postgres).");
}

const source = new Pool({ connectionString: SUPABASE_DB_URL });
const target = new Pool({ connectionString: DATABASE_URL });

/** Copy rows from a source query into a target table (ON CONFLICT DO NOTHING). */
async function copy(
  label: string,
  selectSql: string,
  targetTable: string,
  columns: string[],
  mapRow: (row: Record<string, unknown>) => unknown[],
) {
  const { rows } = await source.query(selectSql);
  if (rows.length === 0) {
    console.log(`[${label}] nothing to copy`);
    return;
  }
  const colList = columns.map((c) => `"${c}"`).join(", ");
  let inserted = 0;
  for (const row of rows) {
    const values = mapRow(row);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    const res = await target.query(
      `INSERT INTO "${targetTable}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      values,
    );
    inserted += res.rowCount ?? 0;
  }
  console.log(`[${label}] ${inserted}/${rows.length} inserted`);
}

async function main() {
  console.log("Migrating Supabase → new Postgres…");

  // 1) users ← auth.users, but ONLY the ones that belong to an itinerary trip.
  // auth.users is shared across every app in this Supabase project, so we scope
  // to members of public.trip_members (that is exactly the itinerary user set,
  // and the ids trip_members.user_id references).
  await copy(
    "users",
    `SELECT u.id, u.email, u.raw_user_meta_data->>'name' AS name, u.created_at
       FROM auth.users u
      WHERE u.email IS NOT NULL
        AND u.id IN (SELECT DISTINCT user_id FROM public.trip_members)`,
    "users",
    ["id", "email", "name", "email_verified"],
    (r) => [r.id, r.email, r.name ?? null, r.created_at ?? new Date()],
  );

  // 2) trips
  await copy(
    "trips",
    `SELECT id, name, start_date, end_date, created_at FROM public.trips`,
    "trips",
    ["id", "name", "start_date", "end_date", "created_at"],
    (r) => [r.id, r.name, r.start_date, r.end_date, r.created_at],
  );

  // 3) trip_members (user_id UUID string == the migrated users.id text)
  await copy(
    "trip_members",
    `SELECT trip_id, user_id, role, created_at FROM public.trip_members`,
    "trip_members",
    ["trip_id", "user_id", "role", "created_at"],
    (r) => [r.trip_id, r.user_id, r.role, r.created_at],
  );

  // 4) bookings
  await copy(
    "bookings",
    `SELECT id, trip_id, type, title, start_date, end_date, confirmation_number,
            provider, details, cost_amount, cost_currency, cost_share, source,
            source_file, raw_text, created_at
       FROM public.bookings`,
    "bookings",
    [
      "id", "trip_id", "type", "title", "start_date", "end_date", "confirmation_number",
      "provider", "details", "cost_amount", "cost_currency", "cost_share", "source",
      "source_file", "raw_text", "created_at",
    ],
    (r) => [
      r.id, r.trip_id, r.type, r.title, r.start_date, r.end_date, r.confirmation_number,
      r.provider, r.details, r.cost_amount, r.cost_currency, r.cost_share, r.source,
      r.source_file, r.raw_text, r.created_at,
    ],
  );

  // 5) todos
  await copy(
    "todos",
    `SELECT id, trip_id, title, due_date, completed, created_at FROM public.todos`,
    "todos",
    ["id", "trip_id", "title", "due_date", "completed", "created_at"],
    (r) => [r.id, r.trip_id, r.title, r.due_date, r.completed, r.created_at],
  );

  // 6) day_notes
  await copy(
    "day_notes",
    `SELECT id, date, trip_id, title, created_at FROM public.day_notes`,
    "day_notes",
    ["id", "date", "trip_id", "title", "created_at"],
    (r) => [r.id, r.date, r.trip_id, r.title, r.created_at],
  );

  console.log("Done.");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await source.end();
    await target.end();
  });
