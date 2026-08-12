// Seeds the mobile agenda card scenario: long notes, a meeting point, a live
// cancellation tier, attachments, a check-in edge card, and an EMPTY day between
// two busy ones (the gap that exposed the dead-space placeholder).
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
const TRIP = crypto.randomUUID()
const TZ = 'America/Anchorage'

for (const t of ['booking_attachments', 'bookings', 'trip_members', 'trips']) await q(`DELETE FROM ${t}`)
await q(`DELETE FROM users WHERE email = $1`, [EMAIL])

await q(`INSERT INTO users (id, email, name) VALUES ($1,$2,$3)`, [USER_ID, EMAIL, 'Justin'])
await q(`INSERT INTO trips (id, name, start_date, end_date) VALUES ($1,$2,$3,$4)`,
  [TRIP, "Alaska '26", '2026-08-10', '2026-08-20'])
await q(`INSERT INTO trip_members (trip_id, user_id, role) VALUES ($1,$2,'owner')`, [TRIP, USER_ID])

const LONG_NOTES =
  'Helicopter Glacier & Dog Sledding Adventure Tour. Mobile ticket accepted. 1 Adult.\n' +
  'Itinerary Number: 1785065477\n\nCheck in 30 minutes before departure. Weather dependent.'

const booking = (id, type, title, start, end, opts = {}) =>
  q(`INSERT INTO bookings (id, trip_id, type, title, start_date, end_date, timezone,
       confirmation_number, provider, details, cost_amount, cost_currency, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual')`,
    [id, TRIP, type, title, start, end, TZ,
     opts.conf ?? null, opts.provider ?? null, JSON.stringify(opts.details ?? {}),
     opts.cost ?? null, opts.currency ?? 'USD'])

// Aug 12 — the card from the screenshot: notes, meeting point, refund tier, files.
await booking('bk-heli', 'activity', 'Helicopter Glacier & Dog Sledding', '2026-08-12T14:20:00', '2026-08-12T16:00:00', {
  conf: 'BR-1402652651',
  provider: 'Seward Helicopter Tours',
  cost: 649,
  details: {
    notes: LONG_NOTES,
    location: 'Seward Airport, 2310 Airport Rd, Seward, AK',
    maps_url: 'https://maps.google.com/?q=Seward+Airport',
    cancellation_policy: [{ kind: 'percent', value: 100, cutoff: '2026-08-18' }],
  },
})
// Same day — a stay check-in, which renders the thin edge card.
await booking('bk-pov', 'hotel', "Alaska's Point of View", '2026-08-12T16:00:00', '2026-08-15T11:00:00', {
  provider: 'Airbnb',
  details: { check_in_time: '16:00', check_out_time: '11:00', address: '1130 Cliff View Pl, Seward, AK' },
})

// Aug 13 — second card with a fee-based tier and no attachments.
await booking('bk-fjord', 'activity', 'Northwestern Fjord Tour', '2026-08-13T08:30:00', '2026-08-13T16:30:00', {
  conf: 'FCAC063P',
  provider: 'Kenai Fjords Cruise',
  cost: 320,
  details: {
    notes: 'Tour tickets are fully refundable 4 days or more prior to date of travel.',
    location: 'Seward Harbor 369 dock, Seward, AK',
    cancellation_policy: [{ kind: 'fee', value: 50, cutoff: '2026-08-16' }],
  },
})

// Aug 14 is deliberately EMPTY — the gap between two busy days.

// Aug 15 — non-refundable, no location: proves the rows collapse when unset.
await booking('bk-train', 'train', 'Coastal Classic to Anchorage', '2026-08-15T18:00:00', '2026-08-15T22:15:00', {
  conf: 'AKRR-88213',
  provider: 'Alaska Railroad',
  details: { notes: 'Seat assignment at the counter.', cancellation_policy: 'non_refundable' },
})

const file = (bookingId, name, n) =>
  q(`INSERT INTO booking_attachments (id, booking_id, filename, mime_type, size_bytes, content, uploaded_by)
     VALUES ($1,$2,$3,'application/pdf',$4,$5,$6)`,
    [`att-${bookingId}-${n}`, bookingId, name, 1024, new Uint8Array([37, 80, 68, 70]), USER_ID])

await file('bk-heli', 'heli-ticket.pdf', 1)
await file('bk-heli', 'waiver.pdf', 2)
await file('bk-train', 'rail-ticket.pdf', 1)

console.log('Seeded:', JSON.stringify({ USER_ID, TRIP }))
await client.close()
