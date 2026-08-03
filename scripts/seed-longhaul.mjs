// A long-haul flight spanning three calendar days (SJD → HKG, the real shape
// that looked ugly as three identical chips), dropped into the first trip.
import { PGlite } from '@electric-sql/pglite'
const dir = process.env.PGLITE_DIR
if (!dir) { console.error('set PGLITE_DIR'); process.exit(1) }
const client = new PGlite(dir)
const q = (sql, params) => client.query(sql, params)
const { rows } = await q(`SELECT id, name, start_date FROM trips ORDER BY start_date LIMIT 1`)
const trip = rows[0]
await q(
  `INSERT INTO bookings (id, trip_id, type, title, start_date, end_date, source)
   VALUES ($1,$2,'flight','SJD → HKG','2026-08-07T12:27:00','2026-08-09T05:40:00','manual')
   ON CONFLICT (id) DO UPDATE SET start_date = excluded.start_date, end_date = excluded.end_date`,
  ['bk-longhaul', trip.id],
)
console.log('long-haul flight added to', trip.name)
await client.close()
