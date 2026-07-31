// Justin's real shape: one long journey split into trips whose ranges touch/overlap
// (different rosters per leg). Makes Aug 10-11 covered by BOTH trips so the
// day-note trip resolution has an ambiguous date to get wrong.
import { PGlite } from '@electric-sql/pglite'

const dir = process.env.PGLITE_DIR
if (!dir) { console.error('set PGLITE_DIR'); process.exit(1) }
const client = new PGlite(dir)
const q = (sql, params) => client.query(sql, params)

const { rows: trips } = await q(`SELECT id, name FROM trips ORDER BY start_date`)
if (trips.length < 2) { console.error('need 2 trips seeded'); process.exit(1) }
// Leg 1: Aug 5-11. Leg 2 now starts Aug 10 -> Aug 10 & 11 are overlap days.
await q(`UPDATE trips SET start_date = '2026-08-05', end_date = '2026-08-11' WHERE id = $1`, [trips[0].id])
await q(`UPDATE trips SET start_date = '2026-08-10', end_date = '2026-08-20' WHERE id = $1`, [trips[1].id])
await q(`DELETE FROM day_notes`)
console.log('overlap seeded:', trips[0].name, '(Aug 5-11) +', trips[1].name, '(Aug 10-20)')
console.log(JSON.stringify((await q(`SELECT id, name, start_date, end_date FROM trips ORDER BY start_date`)).rows, null, 1))
await client.close()
