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
const TRIP = crypto.randomUUID()

await q(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3)`, [JUSTIN, 'hisgracejustin@gmail.com', 'Justin'])
await q(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3)`, [COCO, 'coco@example.com', 'Coco'])

await q(`INSERT INTO trips (id, name, start_date, end_date, currency) VALUES ($1,$2,$3,$4,$5)`,
  [TRIP, 'Tokyo 2026', '2026-09-01', '2026-09-08', 'HKD'])
await q(`INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1,$2,'owner')`, [TRIP, JUSTIN])
await q(`INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1,$2,'editor')`, [TRIP, COCO])

// The flight to cancel: HK$10,000, split 50/50, with a recorded policy that
// keeps 20% from 20 Aug, so the cancel panel has something to prefill from.
await q(
  `INSERT INTO bookings (id, trip_id, type, title, start_date, end_date, timezone,
     cost_amount, cost_currency, cost_share, paid_by, source, details)
   VALUES ($1,$2,'flight','HKG → NRT','2026-09-01T09:00:00','2026-09-01T14:00:00','Asia/Hong_Kong',
     10000,'HKD',1,$3,'manual',$4)`,
  ['bk-flight', TRIP, JUSTIN, JSON.stringify({
    cancellation_policy: [{ cutoff: '2026-12-31', kind: 'percent', value: 80 }],
  })],
)
await q(`INSERT INTO booking_splits (booking_id, user_id, weight) VALUES ($1,$2,1)`, ['bk-flight', JUSTIN])
await q(`INSERT INTO booking_splits (booking_id, user_id, weight) VALUES ($1,$2,1)`, ['bk-flight', COCO])

// A hotel that stays live, so the total has something to keep after the cancel.
await q(
  `INSERT INTO bookings (id, trip_id, type, title, start_date, end_date, timezone,
     cost_amount, cost_currency, cost_share, paid_by, source)
   VALUES ($1,$2,'hotel','Shinjuku Hotel','2026-09-01T15:00:00','2026-09-08T11:00:00','Asia/Tokyo',
     3000,'HKD',1,$3,'manual')`,
  ['bk-hotel', TRIP, JUSTIN],
)
await q(`INSERT INTO booking_splits (booking_id, user_id, weight) VALUES ($1,$2,1)`, ['bk-hotel', JUSTIN])
await q(`INSERT INTO booking_splits (booking_id, user_id, weight) VALUES ($1,$2,1)`, ['bk-hotel', COCO])

console.log('Seeded:', JSON.stringify({ TRIP }))
await client.close()
