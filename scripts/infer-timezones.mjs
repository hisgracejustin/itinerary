#!/usr/bin/env node
/**
 * What would `bookings.timezone` be filled in with?
 *
 * The column is NOT NULL as of drizzle/0017, which a database still carrying a
 * null cannot take — this is the tool for emptying that set first. A wrong zone
 * is worse than no zone: it silently moves every cancellation deadline on that
 * booking by hours. So this prints the inference, row by row, with the reason
 * for each, and writes NOTHING unless asked.
 *
 * Usage:
 *   DIRECT_DATABASE_URL='postgres://…' node scripts/infer-timezones.mjs
 *   DIRECT_DATABASE_URL='postgres://…' node scripts/infer-timezones.mjs --apply
 *   node scripts/infer-timezones.mjs --csv > timezones.csv
 *   PGLITE_DIR=.data/pglite node scripts/infer-timezones.mjs        # local
 *
 * `--apply` only ever fills a NULL — a zone somebody has already answered is
 * never overwritten, so re-running is safe and re-running twice is a no-op.
 *
 * The resolution rules below MIRROR src/lib/booking-zones.js and must be kept in
 * step with it. They're duplicated rather than imported because that module uses
 * extensionless imports, which Node's ESM resolver rejects. The airport table
 * itself IS imported — it has no imports of its own, so it loads cleanly, and
 * duplicating 91 entries is how the two copies would drift.
 */
import "./load-env.mjs";
import { getAirportTimezone } from "../src/lib/airports.js";
import { pgOptions, explainPgError } from "./pg-connect.mjs";

const APPLY = process.argv.includes("--apply");
const CSV = process.argv.includes("--csv");

/* ------------------------------- connection ------------------------------- */
// DIRECT first, then DATABASE_URL: unlike scripts/migrate.mjs (a build step that
// must never touch the wrong database) this is a tool an operator runs on
// purpose, so falling back to whatever URL they have is the helpful behaviour.
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

async function connect() {
  if (url && url.startsWith("postgres")) {
    const { default: pg } = await import("pg");
    const client = new pg.Client(pgOptions(url));
    try {
      await client.connect();
    } catch (err) {
      await client.end().catch(() => {});
      console.error(explainPgError(err, url));
      process.exit(1);
    }
    return {
      label: `postgres (${new URL(url).host})`,
      query: async (sql, params) => (await client.query(sql, params)).rows,
      close: () => client.end(),
    };
  }
  // The local embedded database the app falls back to in dev. Only when asked
  // for explicitly — a silent fallback here would report on an empty scratch DB
  // and look like "nothing to do".
  if (process.env.PGLITE_DIR) {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite(process.env.PGLITE_DIR);
    return {
      label: `local pglite (${process.env.PGLITE_DIR})`,
      query: async (sql, params) => (await db.query(sql, params)).rows,
      close: () => db.close(),
    };
  }
  return null;
}

/* -------------------------------- inference ------------------------------- */

const RULES = {
  own: "own departure airport",
  landed: "last landing",
  trip: "trip destination",
  none: "no signal",
};

const RULE_BLURB = {
  own: "the flight's own departure airport",
  landed: "arrival airport of the last flight that had taken off before it",
  trip: "arrival airport of the trip's earliest flight",
  none: "nothing in the row or its trip places this booking",
};

/** `details` is jsonb — an object from both drivers, but be forgiving. */
function details(booking) {
  const d = booking.details;
  if (!d) return {};
  if (typeof d === "string") {
    try {
      return JSON.parse(d) || {};
    } catch {
      return {};
    }
  }
  return d;
}

const day = (s) => (s ? String(s).slice(0, 10) : "");

/** Whole days between two naive wall-clock stamps, for reading the gap aloud. */
function daysBetween(fromStamp, toStamp) {
  const a = Date.parse(`${day(fromStamp)}T00:00:00Z`);
  const b = Date.parse(`${day(toStamp)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * The inferred zone for one booking, plus the rule that produced it and a
 * sentence saying why. `all` is every booking in the database, not just the
 * booking's own trip — the flight that placed the traveller in a zone routinely
 * lives on a neighbouring trip of the same journey.
 */
function infer(booking, all) {
  if (booking.type === "flight") {
    const dep = details(booking).departure_airport;
    const zone = getAirportTimezone(dep);
    // You cancel a flight standing where it leaves from, so its own departure
    // airport is the clock its cutoff is written in.
    if (zone) return { zone, rule: "own", why: `departs ${String(dep).toUpperCase().trim()}` };
  }

  const start = String(booking.start_date ?? "");
  // TAKEOFF splits a travel day, not landing: a check-in time is nominal (16:00,
  // 18:00, midnight for a date-only booking) and routinely earlier in the day
  // than the plane touches down, so "which flight had LANDED by then?" skipped
  // the flight that brought you there and reached back to the city you left that
  // morning. A date-only start means the whole day, so there the test is the
  // landing DAY. A real 00:00 departure reads as date-only; accepted.
  const wholeDay = /T00:00(:00)?$/.test(start);
  let latest = null;
  for (const b of all) {
    // Self-exclusion matters: an eastbound flight over the dateline lands at a
    // wall-clock time BEFORE it departs, and would otherwise precede itself.
    if (b.id === booking.id || b.type !== "flight" || !b.start_date || !b.end_date) continue;
    if (!start) continue;
    const qualifies = wholeDay ? day(b.end_date) <= day(start) : String(b.start_date) <= start;
    if (!qualifies) continue;
    // Latest LANDING among the qualifiers: with two flights the same day it is
    // the second one that says where you ended up.
    if (!latest || String(b.end_date) > String(latest.end_date)) latest = b;
  }
  if (latest) {
    const arr = details(latest).arrival_airport;
    const zone = getAirportTimezone(arr);
    if (zone) {
      const gap = daysBetween(latest.end_date, booking.start_date);
      const when =
        gap === 0 ? "same day" : gap === 1 ? "the day before" : gap != null ? `${gap}d earlier` : "";
      const arrival = String(arr).toUpperCase().trim();
      const departure = String(details(latest).departure_airport ?? "").toUpperCase().trim();
      return {
        zone,
        rule: "landed",
        // A landing weeks earlier stops being evidence of where you are — you
        // could have crossed a seam by train or bus since, which nothing here
        // can see. Flag the stale ones rather than quietly trusting them.
        weak: gap == null || gap > 2,
        // Name the fact that actually qualified the flight: on a travel day the
        // plane is still in the air when the booking's nominal time passes, and
        // "landed before it" would contradict the dates printed alongside.
        why:
          String(latest.end_date) <= start
            ? `landed at ${arrival} ${day(latest.end_date)}${when ? ` (${when})` : ""}`
            : wholeDay
              ? `lands at ${arrival} ${day(latest.end_date)} (the same day)`
              : `departed ${departure} ${day(latest.start_date)} before this starts, lands ${arrival}`,
      };
    }
  }

  let earliest = null;
  for (const b of all) {
    if (b.trip_id !== booking.trip_id || b.type !== "flight" || !b.start_date) continue;
    if (!earliest || String(b.start_date) < String(earliest.start_date)) earliest = b;
  }
  if (earliest) {
    const arr = details(earliest).arrival_airport;
    const zone = getAirportTimezone(arr);
    // The "getting there" flight's destination — a proxy for the whole trip,
    // and the weakest one that still says something.
    if (zone) {
      return {
        zone,
        rule: "trip",
        weak: true,
        why: `trip's earliest flight lands ${String(arr).toUpperCase().trim()}`,
      };
    }
  }

  const hasFlights = all.some((b) => b.trip_id === booking.trip_id && b.type === "flight");
  return {
    zone: null,
    rule: "none",
    weak: true,
    why: hasFlights
      ? "no signal — the trip's flights carry no airport codes we know"
      : "no signal — this trip has no flights at all",
  };
}

/** Refund tiers with a cutoff. A wrong zone here is the one that costs money. */
function hasDeadline(booking) {
  const policy = details(booking).cancellation_policy;
  return Array.isArray(policy) && policy.some((t) => t && t.cutoff);
}

/* --------------------------------- output --------------------------------- */

const pad = (s, n) => String(s).padEnd(n);
function clip(s, n) {
  const str = String(s ?? "");
  return str.length <= n ? str : `${str.slice(0, n - 1)}…`;
}

const out = (...args) => console.log(...args);

/* ---------------------------------- main ---------------------------------- */

const db = await connect();
if (!db) {
  out(
    "infer-timezones: no database to read.\n" +
      "  Set DIRECT_DATABASE_URL (or DATABASE_URL) to a postgres:// URL for production,\n" +
      "  or PGLITE_DIR to point at a local embedded database.",
  );
  process.exit(0);
}

const all = await db.query(
  `select b.id, b.trip_id, b.type, b.title, b.start_date, b.end_date, b.timezone,
          b.details, t.name as trip_name, t.start_date as trip_start, t.end_date as trip_end
     from bookings b
     join trips t on t.id = b.trip_id
    order by b.start_date`,
);

const pending = all.filter((b) => b.timezone == null || b.timezone === "");
const rows = pending.map((b) => ({ ...b, ...infer(b, all) }));

// Trips in journey order, bookings inside them in date order — so the report
// reads the way the trip was travelled.
const trips = new Map();
for (const r of rows) {
  if (!trips.has(r.trip_id)) trips.set(r.trip_id, { name: r.trip_name, start: r.trip_start, end: r.trip_end, rows: [] });
  trips.get(r.trip_id).rows.push(r);
}
const ordered = [...trips.values()].sort((a, b) => String(a.start).localeCompare(String(b.start)));

if (CSV) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  out("trip,date,type,title,inferred_zone,rule,why,needs_attention");
  for (const t of ordered) {
    for (const r of t.rows) {
      const attention = !r.zone ? "no zone" : r.weak && hasDeadline(r) ? "weak zone + deadline" : "";
      out([t.name, day(r.start_date), r.type, r.title, r.zone ?? "", RULES[r.rule], r.why, attention].map(esc).join(","));
    }
  }
  await db.close();
  process.exit(0);
}

const resolved = rows.filter((r) => r.zone);
const unresolved = rows.filter((r) => !r.zone);
const risky = rows.filter((r) => r.zone && r.weak && hasDeadline(r));

out("");
out("  Booking timezones — what the inference would fill in");
out(`  ${db.label}`);
out("");
out(
  `  ${all.length} booking${all.length === 1 ? "" : "s"} · ${pending.length} with no timezone yet · ` +
    `${resolved.length} inferred · ${unresolved.length} unresolved`,
);

if (pending.length === 0) {
  out("");
  out("  Every booking already carries a timezone. The NOT NULL migration can go ahead.");
  out("");
  await db.close();
  process.exit(0);
}

// Column widths from the data, so the arrow column lines up down the page.
const wTitle = Math.min(34, Math.max(...rows.map((r) => String(r.title).length), 5));
const wType = Math.max(...rows.map((r) => r.type.length));
const wZone = Math.max(...rows.map((r) => (r.zone ?? "—").length));

for (const t of ordered) {
  out("");
  out(`  ── ${t.name} ── ${day(t.start)} → ${day(t.end)}`);
  for (const r of t.rows) {
    const mark = !r.zone ? "!" : r.weak && hasDeadline(r) ? "?" : " ";
    out(
      `  ${mark} ${day(r.start_date)}  ${pad(r.type, wType)}  ${pad(clip(r.title, wTitle), wTitle)}  ` +
        `→ ${pad(r.zone ?? "—", wZone)}  ${r.why}`,
    );
  }
}

out("");
out("  By rule");
for (const key of ["own", "landed", "trip", "none"]) {
  const n = rows.filter((r) => r.rule === key).length;
  if (n) out(`    ${pad(RULES[key], 22)} ${String(n).padStart(3)}   ${RULE_BLURB[key]}`);
}

out("");
if (unresolved.length === 0 && risky.length === 0) {
  out("  Nothing needs a second opinion — every row resolved from a flight it can point at.");
} else {
  out(`  Needs your eyes (${unresolved.length + risky.length})`);
  if (unresolved.length) out("    ! no zone at all — --apply skips these, they still need answering by hand");
  if (risky.length) {
    out("    ? a cancellation deadline read on a zone we're only guessing at — the one that costs money");
  }
  for (const r of [...unresolved, ...risky]) {
    const mark = r.zone ? "?" : "!";
    out(
      `    ${mark} ${pad(clip(r.title, wTitle), wTitle)}  ${day(r.start_date)}  ` +
        `${pad(clip(r.trip_name, 22), 22)}  ${pad(r.zone ?? "—", wZone)}  ${r.why}`,
    );
  }
}

/* --------------------------------- writing -------------------------------- */

out("");
if (!APPLY) {
  out("  Nothing was written — this run is read-only.");
  out(`    node scripts/infer-timezones.mjs --apply     writes the ${resolved.length} inferred value(s)`);
  out("    node scripts/infer-timezones.mjs --csv      the same table, for a spreadsheet");
  out("");
  out("  --apply only ever fills a NULL, so an answer you've already given is safe,");
  out("  and a second run is a no-op.");
} else if (resolved.length === 0) {
  out("  Nothing to apply — no row above has an inferable zone.");
} else {
  out(`  Applying ${resolved.length} inferred timezone(s)…`);
  let written = 0;
  for (const r of resolved) {
    // `timezone is null` in the WHERE, not just in the read: it makes the write
    // idempotent and keeps a human's answer safe from a concurrent run.
    const done = await db.query(
      `update bookings set timezone = $1 where id = $2 and timezone is null returning id`,
      [r.zone, r.id],
    );
    if (done.length) {
      written++;
      out(`    ✓ ${pad(clip(r.title, wTitle), wTitle)} → ${r.zone}`);
    } else {
      out(`    · ${pad(clip(r.title, wTitle), wTitle)}   already answered, left alone`);
    }
  }
  out("");
  out(`  ${written} written · ${resolved.length - written} left alone · ${unresolved.length} skipped (no zone inferred)`);
}

out("");
if (unresolved.length) {
  out(
    `  Next: ${unresolved.length} booking(s) above have no inferable zone. Set them in the app\n` +
      "  (the booking form's timezone field), then re-run this to confirm the column is full.",
  );
} else {
  out("  Next: every booking can carry a zone — the NOT NULL migration is unblocked.");
}
out("");

await db.close();
