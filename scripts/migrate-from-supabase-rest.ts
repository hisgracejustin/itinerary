/**
 * Data migration over Supabase's HTTPS APIs (no direct Postgres/pooler needed) →
 * the new self-hosted Postgres.
 *
 * Reads:
 *   - app tables via PostgREST (/rest/v1/*) with the service_role key (bypasses RLS)
 *   - users via the Auth admin API (/auth/v1/admin/users)
 * Writes to DATABASE_URL via node-postgres.
 *
 * Membership is remapped BY EMAIL (old Supabase user → email → the user row in the
 * new DB), so it works even though you've already logged into the new app and have
 * a fresh user id. If a member has never logged into the new app yet, their user
 * row is created with the old Supabase UUID so a later Google login links by email.
 *
 * Usage:
 *   SUPABASE_URL='https://<ref>.supabase.co' \
 *   SUPABASE_SERVICE_ROLE_KEY='<service_role secret>' \
 *   DATABASE_URL='postgres://…new…' \
 *     npm run migrate:supabase:rest
 */
import "dotenv/config";
import { Pool } from "pg";

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL) throw new Error("Set SUPABASE_URL, e.g. https://<ref>.supabase.co");
if (!KEY) throw new Error("Set SUPABASE_SERVICE_ROLE_KEY (Supabase → Settings → API).");
if (!DATABASE_URL || !DATABASE_URL.startsWith("postgres")) throw new Error("Set DATABASE_URL (target).");

const target = new Pool({ connectionString: DATABASE_URL });
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

/** Read every row of a public table via PostgREST. */
async function rest(table: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    headers: { ...H, Range: "0-99999" },
  });
  if (!res.ok) throw new Error(`REST ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Read every auth user via the admin API (paginated). */
async function adminUsers(): Promise<{ id: string; email: string; name: string | null; created_at: string }[]> {
  const out: { id: string; email: string; name: string | null; created_at: string }[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000&page=${page}`, { headers: H });
    if (!res.ok) throw new Error(`admin/users: ${res.status} ${await res.text()}`);
    const body = await res.json();
    const users = body.users ?? [];
    for (const u of users) {
      if (u.email) out.push({ id: u.id, email: u.email, name: u.user_metadata?.name ?? null, created_at: u.created_at });
    }
    if (users.length < 1000) break;
  }
  return out;
}

async function insert(table: string, columns: string[], rows: unknown[][]) {
  const colList = columns.map((c) => `"${c}"`).join(", ");
  let n = 0;
  for (const values of rows) {
    const ph = values.map((_, i) => `$${i + 1}`).join(", ");
    const r = await target.query(
      `INSERT INTO "${table}" (${colList}) VALUES (${ph}) ON CONFLICT DO NOTHING`,
      values,
    );
    n += r.rowCount ?? 0;
  }
  console.log(`[${table}] ${n}/${rows.length} inserted`);
}

async function main() {
  console.log("Migrating Supabase (HTTPS) → new Postgres…");

  const [authUsers, trips, members, bookings, todos, dayNotes] = await Promise.all([
    adminUsers(),
    rest("trips"),
    rest("trip_members"),
    rest("bookings"),
    rest("todos"),
    rest("day_notes"),
  ]);
  console.log(
    `fetched: ${authUsers.length} auth users, ${trips.length} trips, ${members.length} members, ` +
      `${bookings.length} bookings, ${todos.length} todos, ${dayNotes.length} day_notes`,
  );

  const emailByOldId = new Map(authUsers.map((u) => [u.id, u.email]));
  const memberOldIds = [...new Set(members.map((m) => String(m.user_id)))];

  // Resolve each itinerary member to a target user id (existing by email, else create).
  const targetIdByOldId = new Map<string, string>();
  for (const oldId of memberOldIds) {
    const email = emailByOldId.get(oldId);
    if (!email) {
      console.warn(`  ! member ${oldId} has no auth email — skipping`);
      continue;
    }
    const found = await target.query(`SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`, [email]);
    if (found.rows[0]) {
      targetIdByOldId.set(oldId, found.rows[0].id);
    } else {
      // Not logged in yet — seed with the old UUID so Google login links by email.
      const u = authUsers.find((x) => x.id === oldId)!;
      await target.query(
        `INSERT INTO users (id, email, name, email_verified) VALUES ($1,$2,$3, now()) ON CONFLICT DO NOTHING`,
        [oldId, u.email, u.name],
      );
      targetIdByOldId.set(oldId, oldId);
    }
  }
  console.log(`resolved ${targetIdByOldId.size} itinerary users`);

  // trips (ids preserved)
  await insert(
    "trips",
    ["id", "name", "start_date", "end_date", "created_at"],
    trips.map((t) => [t.id, t.name, t.start_date, t.end_date, t.created_at]),
  );

  // trip_members (user_id remapped to the target user)
  await insert(
    "trip_members",
    ["trip_id", "user_id", "role", "created_at"],
    members
      .filter((m) => targetIdByOldId.has(String(m.user_id)))
      .map((m) => [m.trip_id, targetIdByOldId.get(String(m.user_id)), m.role, m.created_at]),
  );

  // bookings
  await insert(
    "bookings",
    ["id", "trip_id", "type", "title", "start_date", "end_date", "confirmation_number", "provider",
     "details", "cost_amount", "cost_currency", "cost_share", "source", "source_file", "raw_text", "created_at"],
    bookings.map((b) => [b.id, b.trip_id, b.type, b.title, b.start_date, b.end_date, b.confirmation_number,
      b.provider, b.details ?? null, b.cost_amount, b.cost_currency, b.cost_share, b.source, b.source_file, b.raw_text, b.created_at]),
  );

  // todos
  await insert(
    "todos",
    ["id", "trip_id", "title", "due_date", "completed", "created_at"],
    todos.map((t) => [t.id, t.trip_id, t.title, t.due_date, t.completed, t.created_at]),
  );

  // day_notes
  await insert(
    "day_notes",
    ["id", "date", "trip_id", "title", "created_at"],
    dayNotes.map((d) => [d.id, d.date, d.trip_id, d.title, d.created_at]),
  );

  console.log("Done.");
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(() => target.end());
