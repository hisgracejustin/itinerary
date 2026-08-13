// Seeds a trip with a travel advisor: a member who is on the trip but takes no
// share of its costs. Used to check that a fresh expense split defaults to the
// real participants while the advisor stays selectable as the payer.
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
const COCO = 'user-coco'
const ADVISOR = 'user-advisor'
const EMAIL = 'hisgracejustin@gmail.com'
const TRIP = crypto.randomUUID()

for (const t of ['expense_splits', 'expenses', 'booking_splits', 'bookings', 'trip_members', 'trips']) {
  await q(`DELETE FROM ${t}`)
}
await q(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [JUSTIN, COCO, ADVISOR])

await q(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3)`, [JUSTIN, EMAIL, 'Justin'])
await q(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3)`, [COCO, 'coco@example.com', 'Coco'])
await q(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3)`, [ADVISOR, 'advisor@example.com', 'Ada Advisor'])

await q(`INSERT INTO trips (id, name, start_date, end_date) VALUES ($1,$2,$3,$4)`,
  [TRIP, "Alaska '26", '2026-08-10', '2026-08-20'])

await q(`INSERT INTO trip_members (trip_id, user_id, role, shares_costs) VALUES ($1,$2,'owner',true)`, [TRIP, JUSTIN])
await q(`INSERT INTO trip_members (trip_id, user_id, role, shares_costs) VALUES ($1,$2,'editor',true)`, [TRIP, COCO])
// The whole point: on the trip, not party to its money.
await q(`INSERT INTO trip_members (trip_id, user_id, role, shares_costs) VALUES ($1,$2,'editor',false)`, [TRIP, ADVISOR])

console.log('Seeded:', JSON.stringify({ TRIP, JUSTIN, COCO, ADVISOR }))
await client.close()
