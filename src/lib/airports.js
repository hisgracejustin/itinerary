/**
 * Airport timezone data — IANA timezone names for computing real flight durations.
 * Add more airports as needed.
 */
const AIRPORT_TIMEZONES = {
  // North America
  YVR: 'America/Vancouver',
  YYZ: 'America/Toronto',
  YUL: 'America/Toronto',
  YOW: 'America/Toronto',
  YYC: 'America/Edmonton',
  YEG: 'America/Edmonton',
  SFO: 'America/Los_Angeles',
  LAX: 'America/Los_Angeles',
  SAN: 'America/Los_Angeles',
  SEA: 'America/Los_Angeles',
  PDX: 'America/Los_Angeles',
  LAS: 'America/Los_Angeles',
  PHX: 'America/Phoenix',
  DEN: 'America/Denver',
  SLC: 'America/Denver',
  DFW: 'America/Chicago',
  ORD: 'America/Chicago',
  IAH: 'America/Chicago',
  MSP: 'America/Chicago',
  ATL: 'America/New_York',
  JFK: 'America/New_York',
  EWR: 'America/New_York',
  LGA: 'America/New_York',
  BOS: 'America/New_York',
  MIA: 'America/New_York',
  MCO: 'America/New_York',
  DCA: 'America/New_York',
  IAD: 'America/New_York',
  PHL: 'America/New_York',
  HNL: 'Pacific/Honolulu',
  ANC: 'America/Anchorage',
  SJD: 'America/Mazatlan',
  FAT: 'America/Los_Angeles',
  OAK: 'America/Los_Angeles',

  // Asia
  HKG: 'Asia/Hong_Kong',
  NRT: 'Asia/Tokyo',
  HND: 'Asia/Tokyo',
  KIX: 'Asia/Tokyo',
  ICN: 'Asia/Seoul',
  GMP: 'Asia/Seoul',
  PVG: 'Asia/Shanghai',
  PEK: 'Asia/Shanghai',
  TPE: 'Asia/Taipei',
  SIN: 'Asia/Singapore',
  BKK: 'Asia/Bangkok',
  KUL: 'Asia/Kuala_Lumpur',
  MNL: 'Asia/Manila',
  DEL: 'Asia/Kolkata',
  BOM: 'Asia/Kolkata',
  BLR: 'Asia/Kolkata',
  MAA: 'Asia/Kolkata',
  CCU: 'Asia/Kolkata',
  HYD: 'Asia/Kolkata',
  COK: 'Asia/Kolkata',
  GOI: 'Asia/Kolkata',
  DXB: 'Asia/Dubai',
  DOH: 'Asia/Qatar',

  // Europe
  LHR: 'Europe/London',
  LGW: 'Europe/London',
  STN: 'Europe/London',
  CDG: 'Europe/Paris',
  ORY: 'Europe/Paris',
  AMS: 'Europe/Amsterdam',
  FRA: 'Europe/Berlin',
  MUC: 'Europe/Berlin',
  FCO: 'Europe/Rome',
  MAD: 'Europe/Madrid',
  BCN: 'Europe/Madrid',
  ZRH: 'Europe/Zurich',
  VIE: 'Europe/Vienna',
  CPH: 'Europe/Copenhagen',
  ARN: 'Europe/Stockholm',
  HEL: 'Europe/Helsinki',
  IST: 'Europe/Istanbul',

  // Oceania
  SYD: 'Australia/Sydney',
  MEL: 'Australia/Melbourne',
  BNE: 'Australia/Brisbane',
  PER: 'Australia/Perth',
  AKL: 'Pacific/Auckland',
}

/**
 * Get timezone for an airport code (case-insensitive).
 * Returns null if unknown.
 */
export function getAirportTimezone(code) {
  if (!code) return null
  return AIRPORT_TIMEZONES[code.toUpperCase().trim()] || null
}

/**
 * Flight duration in minutes, or null if it can't be computed.
 *
 * `approx` is true when either airport code was unknown and the naive
 * end-minus-start fallback was used — that result is off by the timezone
 * difference for any cross-zone flight, so callers can mark it as such.
 */
export function getFlightDurationMinutes(startIso, endIso, departureAirport, arrivalAirport) {
  if (!startIso || !endIso) return null

  const depTz = getAirportTimezone(departureAirport)
  const arrTz = getAirportTimezone(arrivalAirport)

  if (!depTz || !arrTz) {
    // Fallback: simple difference (works when same timezone)
    const ms = new Date(endIso) - new Date(startIso)
    if (ms <= 0) return null
    return { minutes: Math.round(ms / 60000), approx: true }
  }

  // The stored ISO strings were created from datetime-local inputs,
  // so they represent wall-clock time at the user's local timezone.
  // We need to reinterpret them as wall-clock time at each airport.
  const depLocal = stripTimezone(startIso)
  const arrLocal = stripTimezone(endIso)

  // Get UTC equivalents by interpreting each time in its airport timezone
  const depUTC = localToUTC(depLocal, depTz)
  const arrUTC = localToUTC(arrLocal, arrTz)

  if (!depUTC || !arrUTC) return null

  const ms = arrUTC - depUTC
  // Offset resolution can no longer produce a negative span, so a non-positive
  // one here is a genuine data error (arrival typed before departure).
  if (ms <= 0) return null
  return { minutes: Math.round(ms / 60000), approx: false }
}

/**
 * Calculate actual flight duration given local departure/arrival times and airport codes.
 * Returns formatted string like "12h 45m" or null if it can't be computed.
 */
export function getFlightDuration(startIso, endIso, departureAirport, arrivalAirport) {
  const d = getFlightDurationMinutes(startIso, endIso, departureAirport, arrivalAirport)
  return d ? formatMs(d.minutes * 60000) : null
}

/**
 * Strip timezone info from an ISO string to get "YYYY-MM-DDTHH:MM" format.
 */
function stripTimezone(iso) {
  // Handle "2026-06-05T22:25:00.000Z" or "2026-06-05T22:25"
  return iso.replace(/Z$/, '').replace(/[+-]\d{2}:\d{2}$/, '').slice(0, 16)
}

const NAIVE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/**
 * A timestamp reduced to the naive 'YYYY-MM-DDTHH:mm:ss' the app stores, or null
 * if there is no wall-clock time in it to keep.
 *
 * The DB holds booking times as naive wall clock on purpose (a 07:30 departure
 * is 07:30 at the gate, for every viewer on earth), so any offset a source
 * attaches — an AI parser's stray 'Z' most of all — is noise that would make the
 * value shift as the reader travels.
 */
export function naiveStamp(value) {
  if (typeof value !== 'string') return null
  const wall = stripTimezone(value.trim())
  return NAIVE_RE.test(wall) ? `${wall}:00` : null
}

const ZONE_FORMATTERS = new Map()

/**
 * A zone's calendar/clock fields at an instant, read off Intl. Formatters are
 * cached because /costs resolves a zone per booking on every render.
 */
function zonedParts(ts, timeZone) {
  let f = ZONE_FORMATTERS.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    })
    ZONE_FORMATTERS.set(timeZone, f)
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]))
  // %24 keeps the hour-24 midnight spelling some locales emit from overflowing.
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute, second: +p.second,
  }
}

/** The zone's offset from UTC at a given instant, in ms. */
function tzOffsetMs(ts, timeZone) {
  const p = zonedParts(ts, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts
}

const pad = (n) => String(n).padStart(2, '0')

/**
 * The naive 'YYYY-MM-DDTHH:mm' an instant reads as in `timeZone` — the wall
 * clock someone standing there would see, in the same shape the app stores its
 * booking times and cancellation cutoffs in, so the two compare directly.
 *
 * A null zone falls back to the device's own clock: for data we can't place on
 * the map, the reader's local reading is the only one available.
 */
export function wallClockInZone(instantMs, timeZone) {
  if (!Number.isFinite(instantMs)) return null
  if (timeZone) {
    const p = zonedParts(instantMs, timeZone)
    return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
  }
  const d = new Date(instantMs)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Convert a local datetime string (YYYY-MM-DDTHH:MM) to a UTC timestamp
 * by treating it as local time in the given IANA timezone.
 */
function localToUTC(localStr, timezone) {
  try {
    const [datePart, timePart] = localStr.split('T')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hour, minute] = timePart.split(':').map(Number)
    const guess = Date.UTC(year, month - 1, day, hour, minute)
    // Two passes: the first offset is approximate because it's sampled at the
    // wrong instant; re-sampling at that instant lands on the true offset, which
    // is what makes DST transitions and month boundaries come out right. No date
    // arithmetic is done on the formatted fields — comparing day-of-month digits
    // inverts across a month boundary, which is what this replaced.
    let ts = guess - tzOffsetMs(guess, timezone)
    ts = guess - tzOffsetMs(ts, timezone)
    return ts
  } catch {
    return null
  }
}

function formatMs(ms) {
  const totalMin = Math.round(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
