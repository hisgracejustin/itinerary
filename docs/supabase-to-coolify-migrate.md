# Migrating data: Supabase → self-hosted Postgres (Coolify)

A reusable recipe for moving app data out of a Supabase project into a
self-hosted Postgres (e.g. a Coolify Postgres service), as part of moving an app
off Supabase to a Next.js + NextAuth + Drizzle stack.

This is the exact approach used for the `itinerary` app. It's written to be
copied by other projects — swap the table list and column mappings for yours.

---

## TL;DR

Read the source over **Supabase's HTTPS APIs** (PostgREST + Auth admin) using the
**`service_role`** key, and write to the target with **node-postgres**. This
avoids all direct-Postgres connectivity problems (see "Why not a direct DB
connection" below). The importer is [`scripts/migrate-from-supabase-rest.ts`](../scripts/migrate-from-supabase-rest.ts).

```bash
SUPABASE_URL='https://<ref>.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='<service_role secret>' \
DATABASE_URL='postgres://<user>:<pw>@<target-host>:5432/<db>' \
  npm run migrate:supabase:rest
```

It's **idempotent** (`INSERT … ON CONFLICT DO NOTHING`), so it's safe to re-run.

---

## Why not a direct DB connection (`pg_dump` / pooler)

We tried the "obvious" path first (connect to the Supabase Postgres directly and
copy tables) and hit a chain of issues worth knowing about:

1. **The direct DB host is IPv6-only.** `db.<ref>.supabase.co` publishes only an
   AAAA record. Hosts without IPv6 egress (many CI runners, containers, dev boxes)
   get `getaddrinfo ENOTFOUND`.
2. **The Session/Transaction pooler is IPv4** (`aws-0-<region>.pooler.supabase.com`,
   user `postgres.<ref>`, port `5432`/`6543`) and *does* work — but it needs the
   **database password**, which is separate from the API keys and easy to not have.
3. **Don't confuse hosts.** `*.supabase.co` is fronted by **Cloudflare**
   (`104.18.*`, `172.64.*`). Pointing a Postgres client at those on `:5432` just
   times out — Cloudflare doesn't proxy raw Postgres. Only the `*.pooler.supabase.com`
   (AWS IPs) or the IPv6 direct host speak Postgres.

The HTTPS/REST approach sidesteps all of this: it only needs outbound **443** to
`<ref>.supabase.co` (which every host has) and the `service_role` key.

> A direct-DB importer is still provided as
> [`scripts/migrate-from-supabase.ts`](../scripts/migrate-from-supabase.ts) (run via
> `npm run migrate:supabase`) for hosts that *can* reach the pooler. It carries the
> same remap logic below.

---

## Keys: use `service_role`, not `anon`

- The **`anon`** key is subject to **Row-Level Security** — an unauthenticated
  request returns **zero rows**. It also can't read the `auth` schema. So it
  cannot export data.
- The **`service_role`** key (Supabase → **Settings → API**, or a `sb_secret_…`
  key under the newer **API Keys** tab) **bypasses RLS** and can list users via
  the **Auth admin API** (`/auth/v1/admin/users`). This is the one to use.
- **Gotcha:** `Invalid API key` almost always means the **URL ref and the key are
  from different projects**. They must be the same project. (RLS returning `[]` is
  a *different* symptom — that's the anon key working but blocked by policy.)
- Keep `service_role` secret — it's full god-mode. Never commit it or paste it
  anywhere shared.

Quick check before importing (expect HTTP `200`):

```bash
SR='<service_role>'
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://<ref>.supabase.co/rest/v1/<a_table>?select=id" \
  -H "apikey: $SR" -H "Authorization: Bearer $SR"
```

---

## What the importer reads and writes

**Source (Supabase, HTTPS):**
- App tables via PostgREST: `GET /rest/v1/<table>?select=*` with `apikey` +
  `Authorization: Bearer <service_role>` and a wide `Range` header to pull all rows.
- Users via the Auth admin API: `GET /auth/v1/admin/users?per_page=1000&page=N`
  (paginated). This is the only way to get emails — PostgREST doesn't expose the
  `auth` schema.

**Target (new Postgres, node-postgres):**
- `INSERT … ON CONFLICT DO NOTHING`, inserted in **foreign-key order**
  (users → trips → trip_members → bookings → …).

`DATABASE_URL` points at the target. If you run the importer **inside** the
Coolify network you can use the internal service hostname; if you run it from
outside, temporarily enable the DB's public endpoint (and disable it after).

---

## Two correctness rules that matter

These are the non-obvious parts — get them wrong and data looks migrated but
users can't see it.

### 1. `auth.users` is shared — scope users to your app

A Supabase project's `auth.users` table is shared across **every** app in that
project. Don't copy all of it. Scope to the users actually referenced by your
app — for itinerary, the members in `trip_members`:

```
itinerary users = { u ∈ auth.users : u.id ∈ (SELECT user_id FROM trip_members) }
```

### 2. Remap membership BY EMAIL, not by preserving UUIDs

The tempting approach is "preserve each Supabase `auth.users.id` UUID as the new
`users.id`" so foreign keys line up. That breaks the moment **a user has already
logged into the new app**: NextAuth will have created their `users` row with a
**fresh id** (a cuid), and the unique-email constraint makes re-inserting the old
UUID a no-op — so their migrated `trip_members` rows (old UUID) point at nobody.

Instead, resolve each old user to a **target user id by email**:

- If a `users` row with that email already exists (they've logged in) → use its id.
- If not → create the row **with the old UUID** (so a later Google login links to
  it by email; requires `allowDangerousEmailAccountLinking: true` on the provider).

Then rewrite every `trip_members.user_id` through that old→new id map. This is
robust whether or not people have logged into the new app first.

---

## Step by step

1. **Create + migrate the target schema first.** The app's Drizzle migrations
   create all tables (for itinerary they run automatically on first request, or
   `npm run db:migrate`). The importer only copies **data**.
2. **Grab the `service_role` key** and confirm URL+key are the same project
   (curl check above → `200`).
3. **Run the importer:**
   ```bash
   cd <project>
   SUPABASE_URL='https://<ref>.supabase.co' \
   SUPABASE_SERVICE_ROLE_KEY='<service_role>' \
   DATABASE_URL='postgres://<user>:<pw>@<target-host>:5432/<db>' \
     npm run migrate:supabase:rest
   ```
   Expect per-table `[table] N inserted` lines ending in `Done.`
4. **Verify** in psql on the target:
   ```sql
   SELECT
     (SELECT count(*) FROM users)        AS users,
     (SELECT count(*) FROM trips)        AS trips,
     (SELECT count(*) FROM trip_members) AS members,
     (SELECT count(*) FROM bookings)     AS bookings,
     (SELECT count(*) FROM todos)        AS todos,
     (SELECT count(*) FROM day_notes)    AS day_notes;
   ```
   Counts should match the importer output and Supabase.

---

## Re-running cleanly (remove test data first)

The import is idempotent, so re-running never duplicates — but it also won't
delete rows you created by testing. To reset app data while keeping your login
(`users`/`accounts` intact), truncate the app tables and re-import:

```sql
-- run in psql on the TARGET db; CASCADE handles FK order
TRUNCATE trips, trip_members, bookings, todos, day_notes RESTART IDENTITY CASCADE;
```

Because membership is remapped by email, your existing account re-links to the
freshly imported trips automatically.

---

## Adapting this to another project

1. Change the **table list** and **column arrays** in the importer to your schema.
2. Keep the **two correctness rules** if your app has a users/membership model;
   drop the remap if you have no per-user data.
3. Everything else (service_role over HTTPS, idempotent inserts, FK order,
   truncate-to-reset) is the same.
