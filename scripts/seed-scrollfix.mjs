import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'

const dir = process.env.PGLITE_DIR
if (!dir) { console.error('set PGLITE_DIR'); process.exit(1) }
const client = new PGlite(dir)
const db = drizzle(client)
await migrate(db, { migrationsFolder: './drizzle' })
const q = (sql, params) => client.query(sql, params)

const USER_ID = 'user-justin'
const EMAIL = 'hisgracejustin@gmail.com'
const A = crypto.randomUUID()
const B = crypto.randomUUID()

const today = new Date()
const iso = (offset) => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

for (const t of ['bookings', 'trip_members', 'trips']) await q(`DELETE FROM ${t}`)
await q(`DELETE FROM users WHERE email = $1`, [EMAIL])
await q(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3)`, [USER_ID, EMAIL, 'Justin'])
// Trip A ended a week ago, trip B is in progress — today sits mid-B, so the
// journey span starts 13 days in the past.
await q(`INSERT INTO trips (id, name, start_date, end_date) VALUES ($1,$2,$3,$4)`, [A, 'Vancouver', iso(-13), iso(-7)])
await q(`INSERT INTO trips (id, name, start_date, end_date) VALUES ($1,$2,$3,$4)`, [B, 'Alaska', iso(-6), iso(5)])
for (const trip of [A, B]) await q(`INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1,$2,'owner')`, [trip, USER_ID])

const booking = (id, trip, type, title, start, end) =>
  q(`INSERT INTO bookings (id, trip_id, type, title, start_date, end_date, timezone, source) VALUES ($1,$2,$3,$4,$5,$6,'America/Vancouver','manual')`,
    [id, trip, type, title, start, end])

await booking('bk-fairmont', A, 'hotel', 'Fairmont Pacific Rim', iso(-13) + 'T15:00:00', iso(-7) + 'T11:00:00')
await booking('bk-granville', A, 'activity', 'Granville Island', iso(-9) + 'T10:00:00', null)
await booking('bk-yvranc', B, 'flight', 'YVR to ANC', iso(-6) + 'T18:40:00', iso(-6) + 'T21:00:00')
await booking('bk-anchorage', B, 'hotel', 'Anchorage Inn', iso(-6) + 'T15:00:00', iso(2) + 'T11:00:00')
await booking('bk-yesterday', B, 'activity', 'Glacier Cruise', iso(-1) + 'T09:00:00', null)
await booking('bk-today', B, 'activity', 'Museum Visit', iso(0) + 'T13:00:00', null)
await booking('bk-denali', B, 'activity', 'Denali Tour', iso(4) + 'T09:00:00', null)

console.log('Seeded:', JSON.stringify({ USER_ID, A, B, spanStart: iso(-13), yesterday: iso(-1), today: iso(0) }))
await client.close()
