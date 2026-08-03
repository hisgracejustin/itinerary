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
const BOB = 'user-bob'
const TRIP = crypto.randomUUID()

await q(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3)`, [JUSTIN, 'hisgracejustin@gmail.com', 'Justin'])
await q(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3)`, [COCO, 'coco@example.com', 'Coco'])
await q(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3)`, [BOB, 'bob@example.com', 'Bob'])

await q(`INSERT INTO trips (id, name, start_date, end_date) VALUES ($1,$2,$3,$4)`, [TRIP, 'Tokyo 2026', '2026-09-01', '2026-09-08'])
await q(`INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1,$2,'owner')`, [TRIP, JUSTIN])
await q(`INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1,$2,'editor')`, [TRIP, COCO])
await q(`INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1,$2,'editor')`, [TRIP, BOB])

// Hotel HK$3,000 — payer + splits will be set through the UI (SplitEditor test).
await q(
  `INSERT INTO bookings (id, trip_id, type, title, start_date, end_date, cost_amount, cost_currency, cost_share, source)
   VALUES ($1,$2,'hotel','Shinjuku Hotel','2026-09-01T15:00:00','2026-09-08T11:00:00',3000,'HKD',1,'manual')`,
  ['bk-hotel', TRIP],
)
// Costed but never split — must appear under "Needs attention" + the Me/Us footnote.
await q(
  `INSERT INTO bookings (id, trip_id, type, title, start_date, end_date, cost_amount, cost_currency, cost_share, source)
   VALUES ($1,$2,'activity','TeamLab Tickets','2026-09-03T10:00:00',NULL,9600,'JPY',1,'manual')`,
  ['bk-teamlab', TRIP],
)

console.log('Seeded:', JSON.stringify({ TRIP }))
await client.close()
