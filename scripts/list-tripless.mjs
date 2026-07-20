#!/usr/bin/env node
/**
 * Read-only audit: lists every row with a NULL trip_id across the tables that
 * allow one. These rows are currently visible to — and editable by — every
 * signed-in user, and they're what a `trip_id NOT NULL` migration would have to
 * do something with.
 *
 * Usage:
 *   DATABASE_URL='postgres://…' node scripts/list-tripless.mjs   # production
 *   node scripts/list-tripless.mjs                               # local pglite
 *
 * Touches nothing — SELECTs only.
 */

const TABLES = [
  { name: 'todos', cols: 'id, title, due_date, completed, created_at' },
  { name: 'day_notes', cols: 'id, date, title, created_at' },
  { name: 'day_reminders', cols: 'id, date, text, time, created_at' },
]

const url = process.env.DATABASE_URL

/** @returns {Promise<(sql: string) => Promise<any[]>>} */
async function connect() {
  if (url && url.startsWith('postgres')) {
    const { default: pg } = await import('pg')
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    console.log(`→ connected to postgres (${new URL(url).host})\n`)
    return {
      query: async (sql) => (await client.query(sql)).rows,
      close: () => client.end(),
    }
  }
  const { PGlite } = await import('@electric-sql/pglite')
  const dir = process.env.PGLITE_DIR ?? '.data/pglite'
  const db = new PGlite(dir)
  console.log(`→ connected to local pglite (${dir})\n`)
  return {
    query: async (sql) => (await db.query(sql)).rows,
    close: () => db.close(),
  }
}

const db = await connect()
let grandTotal = 0

for (const { name, cols } of TABLES) {
  let exists
  try {
    exists = await db.query(`select to_regclass('public.${name}') is not null as ok`)
  } catch {
    exists = [{ ok: false }]
  }
  if (!exists[0]?.ok) {
    console.log(`${name}: table not present (skipped)\n`)
    continue
  }

  const total = await db.query(`select count(*)::int as n from ${name}`)
  const rows = await db.query(
    `select ${cols} from ${name} where trip_id is null order by created_at`,
  )
  grandTotal += rows.length

  console.log(`── ${name} ── ${rows.length} tripless of ${total[0].n} total`)
  if (rows.length) console.table(rows)
  console.log()
}

console.log(
  grandTotal === 0
    ? '✅ No tripless rows. A NOT NULL migration needs no backfill.'
    : `⚠️  ${grandTotal} tripless row(s). These are visible to every signed-in user today,\n   and need re-filing or deleting before trip_id can become NOT NULL.`,
)

await db.close()
