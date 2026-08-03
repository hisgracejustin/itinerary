// Adds accounts that belong to NO trip, plus one that's only on a trip the
// viewer isn't a member of — the cases the admin People view has to surface.
// Also seeds a trip-less account WITH a footprint (they paid for a booking on
// someone else's trip), which the safe-delete must refuse. Run against an
// already-seeded PGLITE_DIR.
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

const dir = process.env.PGLITE_DIR
if (!dir) { console.error('set PGLITE_DIR'); process.exit(1) }

const client = new PGlite(dir)
// The dir may predate later migrations (the app applies them on boot); bring it
// up to date here so the inserts below can use current columns.
await migrate(drizzle(client), { migrationsFolder: './drizzle' })
const q = (sql, params) => client.query(sql, params)

const STRAY1 = 'user-stray1'
const STRAY2 = 'user-stray2'
const OUTSIDER = 'user-outsider'
const BLOCKED = 'user-blocked'
const OTHER_TRIP = '11111111-1111-1111-1111-111111111111'

const user = (id, email, name) =>
  q(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`, [id, email, name])

await user(STRAY1, 'newsignup@example.com', 'New Signup')
await user(STRAY2, 'nobody@example.com', null)
await user(OUTSIDER, 'outsider@example.com', 'Outsider Olive')
await user(BLOCKED, 'blocked@example.com', 'Blocked Stray')

// A trip the admin is NOT on, so Olive is invisible in the trip-derived roster.
await q(
  `INSERT INTO trips (id, name, start_date, end_date) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
  [OTHER_TRIP, 'Someone Else Trip', '2026-10-01', '2026-10-05'],
)
await q(
  `INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`,
  [OTHER_TRIP, OUTSIDER],
)
// One stray has signed in (accounts row) so the "verified" badge is exercised.
await q(
  `INSERT INTO accounts (user_id, type, provider, provider_account_id) VALUES ($1,'oauth','google',$2) ON CONFLICT DO NOTHING`,
  [STRAY1, 'google-stray1'],
)
// Blocked Stray is on no trip but paid for a booking — footprint, so undeletable.
await q(
  `INSERT INTO bookings (id, trip_id, type, title, start_date, cost_amount, cost_currency, cost_share, paid_by, source)
   VALUES ($1,$2,'activity','Paid by a stray','2026-10-02T10:00:00',500,'HKD',1,$3,'manual')
   ON CONFLICT (id) DO NOTHING`,
  ['bk-stray-paid', OTHER_TRIP, BLOCKED],
)

const { rows } = await q(`SELECT count(*)::int AS n FROM users`)
console.log('Seeded strays. users:', rows[0].n)
await client.close()
