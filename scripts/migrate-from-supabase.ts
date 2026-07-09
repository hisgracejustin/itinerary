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

  // 1) Resolve itinerary users → target user id, BY EMAIL. auth.users is shared
  // across every app in this Supabase project, so scope to members of
  // public.trip_members. Because you may have already logged into the new app
  // (fresh id), remap by email instead of preserving the old UUID; only create a
  // user row (with the old UUID) for members who haven't logged in yet.
  const { rows: authUsers } = await source.query(
    `SELECT u.id, u.email, u.raw_user_meta_data->>'name' AS name, u.created_at
       FROM auth.users u
      WHERE u.email IS NOT NULL
        AND u.id IN (SELECT DISTINCT user_id FROM public.trip_members)`,
  );
  const targetIdByOldId = new Map<string, string>();
  for (const u of authUsers) {
    const found = await target.query(`SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`, [u.email]);
    if (found.rows[0]) {
      targetIdByOldId.set(u.id, found.rows[0].id);
    } else {
      await target.query(
        `INSERT INTO users (id, email, name, email_verified) VALUES ($1,$2,$3, now()) ON CONFLICT DO NOTHING`,
        [u.id, u.email, u.name ?? null],
      );
      targetIdByOldId.set(u.id, u.id);
    }
  }
  console.log(`[users] resolved ${targetIdByOldId.size} itinerary users`);

  // 2) trips
  await copy(
    "trips",
    `SELECT id, name, start_date, end_date, created_at FROM public.trips`,
    "trips",
    ["id", "name", "start_date", "end_date", "created_at"],
    (r) => [r.id, r.name, r.start_date, r.end_date, r.created_at],
  );

  // 3) trip_members (user_id remapped by email to the target user)
  const { rows: members } = await source.query(
    `SELECT trip_id, user_id, role, created_at FROM public.trip_members`,
  );
  let memberN = 0;
  for (const m of members) {
    const targetId = targetIdByOldId.get(m.user_id as string);
    if (!targetId) continue;
    const r = await target.query(
      `INSERT INTO trip_members (trip_id, user_id, role, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [m.trip_id, targetId, m.role, m.created_at],
    );
    memberN += r.rowCount ?? 0;
  }
  console.log(`[trip_members] ${memberN}/${members.length} inserted`);

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
