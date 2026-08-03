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
const A = crypto.randomUUID() // Vancouver 2026
const B = crypto.randomUUID() // Alaska 2026

for (const t of ['bookings', 'trip_members', 'trips']) await q(`DELETE FROM ${t}`)
await q(`DELETE FROM users WHERE email = $1`, [EMAIL])

await q(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3)`, [USER_ID, EMAIL, 'Justin'])
await q(`INSERT INTO trips (id, name, start_date, end_date) VALUES ($1,$2,$3,$4)`, [A, 'Vancouver 2026', '2026-08-05', '2026-08-11'])
await q(`INSERT INTO trips (id, name, start_date, end_date) VALUES ($1,$2,$3,$4)`, [B, 'Alaska 2026', '2026-08-13', '2026-08-20'])
for (const trip of [A, B]) await q(`INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1,$2,'owner')`, [trip, USER_ID])

const booking = (id, trip, type, title, start, end) =>
  q(`INSERT INTO bookings (id, trip_id, type, title, start_date, end_date, source) VALUES ($1,$2,$3,$4,$5,$6,'manual')`,
    [id, trip, type, title, start, end])

await booking('bk-fairmont', A, 'hotel', 'Fairmont Pacific Rim', '2026-08-05T15:00:00', '2026-08-11T11:00:00')
await booking('bk-granville', A, 'activity', 'Granville Island', '2026-08-11T10:00:00', null)
await booking('bk-seatac', A, 'hotel', 'Sea-Tac Layover Inn', '2026-08-13T20:00:00', '2026-08-14T08:00:00')
await booking('bk-yvranc', B, 'flight', 'YVR to ANC', '2026-08-11T18:40:00', '2026-08-11T21:00:00')
await booking('bk-anchorage', B, 'hotel', 'Anchorage Inn', '2026-08-14T15:00:00', '2026-08-18T11:00:00')
await booking('bk-denali', B, 'activity', 'Denali Tour', '2026-08-19T09:00:00', null)

console.log('Seeded:', JSON.stringify({ USER_ID, A, B }))
await client.close()
