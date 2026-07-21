import { getFlightDurationMinutes } from './airports'
import { toHKD, formatCurrency } from './currencies'

/**
 * Per-type aggregates for the booking-type pages. Pure and display-ready: each
 * stat carries a pre-formatted `value` because the units differ wildly (counts,
 * durations, "3 stays · 7 nights", currency), which keeps StatsStrip a dumb
 * renderer with no per-type branching.
 *
 * Guiding rule: a stat that would read 0 or blank is omitted rather than shown
 * as an empty tile — a short strip beats a wall of zeros.
 */

/** `details` may be stored as JSON text or as an object; never throw. */
export function parseDetails(booking) {
  if (!booking?.details) return {}
  if (typeof booking.details === 'string') {
    try {
      return JSON.parse(booking.details) || {}
    } catch {
      return {}
    }
  }
  return booking.details
}

/** "3h 25m" / "45m" / "3h" — matches the duration style used on booking cards. */
export function formatMinutes(min) {
  if (!Number.isFinite(min) || min <= 0) return null
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

/** Local midnight, so day differences ignore check-in/out times entirely. */
function startOfDay(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * Nights between two dates. The checkout/disembark day is not a night slept,
 * which matches getStayEdge() and hasOvernightCoverage() in calendar.js.
 */
function nightsBetween(startIso, endIso) {
  const s = startOfDay(startIso)
  const e = startOfDay(endIso)
  if (!s || !e) return 0
  const nights = Math.round((e - s) / 86400000)
  return nights > 0 ? nights : 0
}

/** Naive elapsed minutes — correct only when both ends share a timezone. */
function naiveMinutes(startIso, endIso) {
  if (!startIso || !endIso) return null
  const ms = new Date(endIso) - new Date(startIso)
  if (!Number.isFinite(ms) || ms <= 0) return null
  return Math.round(ms / 60000)
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/* --------------------------------- flight --------------------------------- */

function flightStats(bookings) {
  let legs = 0
  let layovers = 0
  let flyingMin = 0
  let layoverMin = 0
  let approx = false
  let missingTime = 0

  for (const b of bookings) {
    const d = parseDetails(b)
    const stops = Array.isArray(d.layovers) ? d.layovers : []
    // One merged booking can represent several legs; travellers count flights,
    // not rows, so the headline follows the legs.
    legs += 1 + stops.length
    layovers += stops.length

    // Both layover timestamps are at the same airport, so their offsets cancel
    // and a naive difference is the true ground time — no timezone data needed.
    let thisLayover = 0
    for (const lo of stops) {
      const m = naiveMinutes(lo.arrival, lo.departure)
      if (m) thisLayover += m
    }
    layoverMin += thisLayover

    const span = getFlightDurationMinutes(
      b.start_date,
      b.end_date,
      d.departure_airport,
      d.arrival_airport,
    )
    if (!span) {
      missingTime += 1
      continue
    }
    if (span.approx) approx = true
    // The stored span covers the whole journey including time on the ground,
    // so flying time is the span minus the stops.
    flyingMin += Math.max(0, span.minutes - thisLayover)
  }

  const stats = [{ key: 'flights', label: 'Flights', value: String(legs) }]

  const flying = formatMinutes(flyingMin)
  if (flying) {
    stats.push({
      key: 'flying_time',
      label: 'Flying time',
      value: flying,
      approx,
      hint: [
        approx ? 'Approximate — some airports have no timezone data' : null,
        missingTime ? `${plural(missingTime, 'booking')} missing an arrival time` : null,
      ]
        .filter(Boolean)
        .join('. ') || undefined,
    })
  }

  const ground = formatMinutes(layoverMin)
  if (ground) stats.push({ key: 'layover_time', label: 'Layover time', value: ground })
  if (layovers > 0) stats.push({ key: 'layovers', label: 'Layovers', value: String(layovers) })

  return stats
}

/* ------------------------------ train / bus ------------------------------- */

function transitStats(bookings) {
  const durations = []
  let missing = 0
  for (const b of bookings) {
    const m = naiveMinutes(b.start_date, b.end_date)
    if (m) durations.push(m)
    else missing += 1
  }

  const stats = [{ key: 'journeys', label: 'Journeys', value: String(bookings.length) }]

  const total = formatMinutes(durations.reduce((a, b) => a + b, 0))
  if (total) {
    stats.push({
      key: 'time_aboard',
      label: 'Time aboard',
      value: total,
      hint: missing ? `${plural(missing, 'journey')} missing an arrival time` : undefined,
    })
  }
  // Only interesting once there is something to be longest among.
  if (durations.length > 1) {
    const longest = formatMinutes(Math.max(...durations))
    if (longest) stats.push({ key: 'longest', label: 'Longest ride', value: longest })
  }
  return stats
}

/* --------------------------------- cruise --------------------------------- */

function cruiseStats(bookings) {
  let nights = 0
  let ports = 0
  let missing = 0
  for (const b of bookings) {
    if (b.end_date) nights += nightsBetween(b.start_date, b.end_date)
    else missing += 1
    const d = parseDetails(b)
    if (Array.isArray(d.ports_of_call)) ports += d.ports_of_call.length
  }

  const stats = [{ key: 'cruises', label: 'Cruises', value: String(bookings.length) }]
  if (nights > 0) {
    stats.push({
      key: 'nights_at_sea',
      label: 'Nights at sea',
      value: String(nights),
      hint: missing ? `${plural(missing, 'cruise')} missing an end date` : undefined,
    })
  }
  if (ports > 0) stats.push({ key: 'ports', label: 'Ports of call', value: String(ports) })
  return stats
}

/* --------------------------------- hotel ---------------------------------- */

function hotelStats(bookings) {
  // Staying at a friend's place is flagged informal — it isn't a hotel, so it's
  // counted separately rather than inflating the stay/night totals.
  const paid = bookings.filter((b) => !parseDetails(b).informal)
  const informal = bookings.filter((b) => parseDetails(b).informal)

  const nights = paid.reduce((sum, b) => sum + nightsBetween(b.start_date, b.end_date), 0)
  const missing = paid.filter((b) => !b.end_date).length

  const stats = []
  if (paid.length > 0) stats.push({ key: 'stays', label: 'Stays', value: String(paid.length) })
  if (nights > 0) {
    stats.push({
      key: 'nights',
      label: 'Nights',
      value: String(nights),
      hint: missing ? `${plural(missing, 'stay')} missing a check-out date` : undefined,
    })
  }
  if (informal.length > 0) {
    const informalNights = informal.reduce(
      (sum, b) => sum + nightsBetween(b.start_date, b.end_date),
      0,
    )
    stats.push({
      key: 'informal',
      label: 'With friends',
      value: informalNights
        ? `${informal.length} · ${plural(informalNights, 'night')}`
        : String(informal.length),
    })
  }
  return stats
}

/* -------------------------------- activity -------------------------------- */

function activityStats(bookings) {
  // details.duration is free text ("2 hours", "half day"), so no time stat —
  // parsing it would be quietly wrong more often than useful.
  const days = new Set()
  for (const b of bookings) {
    const d = startOfDay(b.start_date)
    if (d) days.add(d.getTime())
  }
  const stats = [{ key: 'activities', label: 'Activities', value: String(bookings.length) }]
  if (days.size > 0) stats.push({ key: 'days', label: 'Days with plans', value: String(days.size) })
  return stats
}

/* ---------------------------------- spend --------------------------------- */

/**
 * One glance-level money tile. The Costs screen owns real cost analysis, so this
 * deliberately mirrors its semantics (cost_share, static FX) and shows a single
 * number — anything richer belongs there, not here.
 */
function spendStat(bookings) {
  const priced = bookings.filter((b) => b.cost_amount && b.cost_currency)
  if (priced.length === 0) return null
  const effective = (b) => b.cost_amount * (b.cost_share != null ? b.cost_share : 1)
  const currencies = [...new Set(priced.map((b) => b.cost_currency))]
  const hint =
    priced.length < bookings.length
      ? `${priced.length} of ${bookings.length} bookings priced`
      : undefined

  if (currencies.length === 1) {
    const total = priced.reduce((sum, b) => sum + effective(b), 0)
    return { key: 'spend', label: 'Spend', value: formatCurrency(total, currencies[0]), hint }
  }
  // Mixed currencies: convert, and flag it — the rates are static.
  const total = priced.reduce((sum, b) => sum + toHKD(effective(b), b.cost_currency), 0)
  return { key: 'spend', label: 'Spend', value: formatCurrency(total, 'HKD'), approx: true, hint }
}

const BY_TYPE = {
  flight: flightStats,
  train: transitStats,
  bus: transitStats,
  cruise: cruiseStats,
  hotel: hotelStats,
  activity: activityStats,
}

/**
 * Stats for one booking type. `bookings` must already be filtered to that type.
 * Returns [] when there is nothing worth showing, so the caller can skip the strip.
 */
export function getBookingStats(type, bookings) {
  if (!Array.isArray(bookings) || bookings.length === 0) return []
  const build = BY_TYPE[type]
  if (!build) return []
  const stats = build(bookings)
  const spend = spendStat(bookings)
  if (spend) stats.push(spend)
  return stats
}
