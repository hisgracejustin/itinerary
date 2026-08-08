import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

const dir = process.env.PGLITE_DIR
if (!dir) { console.error('set PGLITE_DIR'); process.exit(1) }
const client = new PGlite(dir)
await migrate(drizzle(client), { migrationsFolder: './drizzle' })
const q = (sql, params) => client.query(sql, params)

const JUSTIN = 'user-justin', CAT = 'user-cat', MICHELLE = 'user-michelle', WAI = 'user-wai', WENDY = 'user-wendy'
const TRIP = crypto.randomUUID()
const PARTY = crypto.randomUUID()

for (const [id, email, name] of [
  [JUSTIN, 'hisgracejustin@gmail.com', 'Justin'],
  [CAT, 'cat@example.com', 'Cat Chan'],
  [MICHELLE, 'michelle@example.com', 'Michelle Lo'],
  [WAI, 'wai@example.com', 'Wai Lam'],
  [WENDY, 'wendy@example.com', 'Wendy Lam'],
]) await q(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3)`, [id, email, name])

await q(`INSERT INTO trips (id, name, start_date, end_date) VALUES ($1,$2,$3,$4)`, [TRIP, 'Tokyo 2026', '2026-08-01', '2026-08-12'])
await q(`INSERT INTO trip_parties (id, trip_id, name) VALUES ($1,$2,$3)`, [PARTY, TRIP, 'Wai & Wendy'])
await q(`INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1,$2,'owner')`, [TRIP, JUSTIN])
for (const id of [CAT, MICHELLE]) await q(`INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1,$2,'editor')`, [TRIP, id])
for (const id of [WAI, WENDY]) await q(`INSERT INTO trip_members (trip_id, user_id, role, party_id) VALUES ($1,$2,'editor',$3)`, [TRIP, id, PARTY])

await q(`INSERT INTO bookings (id, trip_id, type, title, start_date, end_date, cost_amount, cost_currency, cost_share, source, paid_by, timezone)
         VALUES ($1,$2,'hotel','Shinjuku Hotel','2026-08-01T15:00:00','2026-08-08T11:00:00',3000,'HKD',1,'manual',$3,'Asia/Tokyo')`, ['bk-hotel', TRIP, JUSTIN])
for (const id of [JUSTIN, CAT, MICHELLE, WAI, WENDY])
  await q(`INSERT INTO booking_splits (booking_id, user_id, weight) VALUES ($1,$2,1)`, ['bk-hotel', id])

const expense = async (title, amount, currency, date, paidBy, splits, createdAt) => {
  const id = crypto.randomUUID()
  await q(`INSERT INTO expenses (id, trip_id, title, amount, currency, paid_by, created_by, date, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, TRIP, title, amount, currency, paidBy, JUSTIN, date, createdAt])
  for (const [user, weight, extra] of splits)
    await q(`INSERT INTO expense_splits (expense_id, user_id, weight, extra_amount) VALUES ($1,$2,$3,$4)`, [id, user, weight, extra])
  return id
}

const even = (ids) => ids.map((id) => [id, 1, 0])
await expense('Ichiran ramen', 29.2, 'HKD', '2026-08-07', JUSTIN,
  [[CAT, 0, 7.3], [JUSTIN, 0, 8.35], [MICHELLE, 0, 6.3], [WENDY, 0, 7.25]], '2026-08-07T13:00:00Z')
await expense('Airport taxi', 120, 'HKD', '2026-08-08', CAT, even([JUSTIN, CAT, MICHELLE, WAI, WENDY]), '2026-08-08T02:00:00Z')
await expense('Konbini run', 1840, 'JPY', '2026-08-08', JUSTIN, even([JUSTIN, CAT]), '2026-08-08T05:00:00Z')
await expense('Museum tickets', 4000, 'JPY', '2026-08-05', null, [], '2026-08-05T09:00:00Z')
await expense('Coffee', 68, 'HKD', '2026-08-02', MICHELLE, even([MICHELLE, CAT]), '2026-08-02T09:00:00Z')

console.log('Seeded:', JSON.stringify({ TRIP }))
await client.close()
