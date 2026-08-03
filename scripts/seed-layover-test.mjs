import { PGlite } from '@electric-sql/pglite'

const db = new PGlite('/tmp/claude-1000/-config-workspace-itinerary/efad92a6-a4c7-4226-9007-e5ccfbdf19cd/scratchpad/pgdata')
const { rows: trips } = await db.query(`select id, name, start_date, end_date from trips order by start_date limit 1`)
const trip = trips[0]
console.log('trip:', trip)
await db.query(
  `insert into bookings (id, trip_id, type, title, start_date, end_date, provider, confirmation_number, cost_amount, cost_currency, details, source)
   values ('bk-layover-test', $1, 'flight', 'SJD → HKG', '2026-08-07T12:27:00', '2026-08-09T05:40:00', 'United Airlines', 'IEDK4P', 23446, 'HKD', $2, 'manual')
   on conflict (id) do update set details = excluded.details`,
  [
    trip.id,
    JSON.stringify({
      departure_airport: 'SJD',
      arrival_airport: 'HKG',
      flight_number: 'UA547',
      seat: '14F',
      layovers: [
        { airport: 'LAX', arrival: '2026-08-07T14:55:00', departure: '2026-08-07T18:10:00', flight_number: 'UA547' },
        { airport: 'SFO', arrival: '2026-08-07T19:45:00', departure: '2026-08-07T23:05:00', flight_number: 'UA1123' },
      ],
    }),
  ],
)
console.log('seeded')
await db.close()
