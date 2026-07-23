import { drizzle } from 'drizzle-orm/pglite'
import { sql } from 'drizzle-orm'
const db = drizzle(process.env.SEED_DIR)
await db.execute(sql`insert into bookings (id, trip_id, type, title, start_date, provider, cost_amount, cost_currency) values
  ('b1', '00000000-0000-0000-0000-000000000001', 'activity', 'Napa wine tour', '2026-08-28', 'Cat Booking', 220, 'USD'),
  ('b2', '00000000-0000-0000-0000-000000000001', 'activity', 'Yosemite hike', '2026-08-30', 'NPS', 0, 'USD'),
  ('b3', '00000000-0000-0000-0000-000000000002', 'activity', 'Tea ceremony', '2026-11-03', 'Kyoto Tours', 90, 'USD'),
  ('b4', '00000000-0000-0000-0000-000000000002', 'flight', 'SFO to NRT', '2026-11-01', 'ANA', 1200, 'USD')
  on conflict (id) do nothing`)
console.log('BOOKINGS SEEDED')
