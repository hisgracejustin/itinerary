// Two trips with different currencies plus one with none, to check that a new
// expense starts in the form-selected trip's currency, follows a trip change
// while untouched, and falls back to the home currency when a trip has none.
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

const dir = process.env.PGLITE_DIR
if (!dir) { console.error('set PGLITE_DIR'); process.exit(1) }

const client = new PGlite(dir)
const db = drizzle(client)
await migrate(db, { migrationsFolder: './drizzle' })

const q = (sql, params) => client.query(sql, params)

const JUSTIN = 'user-justin'
const EMAIL = 'hisgracejustin@gmail.com'
const ALASKA = crypto.randomUUID()
const JAPAN = crypto.randomUUID()
const NOCUR = crypto.randomUUID()

for (const t of ['expense_splits', 'expenses', 'booking_splits', 'bookings', 'trip_members', 'trips']) {
  await q(`DELETE FROM ${t}`)
}
await q(`DELETE FROM users WHERE id = $1`, [JUSTIN])
await q(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3)`, [JUSTIN, EMAIL, 'Justin'])

const trip = (id, name, start, end, currency) =>
  q(`INSERT INTO trips (id, name, start_date, end_date, currency) VALUES ($1,$2,$3,$4,$5)`,
    [id, name, start, end, currency])

await trip(ALASKA, "Alaska '26", '2026-08-10', '2026-08-20', 'USD')
await trip(JAPAN, "Japan '26", '2026-09-01', '2026-09-14', 'JPY')
await trip(NOCUR, "Unset '26", '2026-10-01', '2026-10-05', null)
for (const t of [ALASKA, JAPAN, NOCUR]) {
  await q(`INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1,$2,'owner')`, [t, JUSTIN])
}

console.log('Seeded:', JSON.stringify({ ALASKA, JAPAN, NOCUR }))
await client.close()
