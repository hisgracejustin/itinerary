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
 * Calculate actual flight duration given local departure/arrival times and airport codes.
 * Returns formatted string like "12h 45m" or null if it can't be computed.
 */
export function getFlightDuration(startIso, endIso, departureAirport, arrivalAirport) {
  if (!startIso || !endIso) return null

  const depTz = getAirportTimezone(departureAirport)
  const arrTz = getAirportTimezone(arrivalAirport)

  if (!depTz || !arrTz) {
    // Fallback: simple difference (works when same timezone)
    const ms = new Date(endIso) - new Date(startIso)
    if (ms <= 0) return null
    return formatMs(ms)
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
  if (ms <= 0) return null
  return formatMs(ms)
}

/**
 * Strip timezone info from an ISO string to get "YYYY-MM-DDTHH:MM" format.
 */
function stripTimezone(iso) {
  // Handle "2026-06-05T22:25:00.000Z" or "2026-06-05T22:25"
  return iso.replace(/Z$/, '').replace(/[+-]\d{2}:\d{2}$/, '').slice(0, 16)
}

/**
 * Convert a local datetime string (YYYY-MM-DDTHH:MM) to a UTC timestamp
 * by treating it as local time in the given IANA timezone.
 */
function localToUTC(localStr, timezone) {
  try {
    // Create a formatter that gives us the UTC offset for this timezone at this date
    const [datePart, timePart] = localStr.split('T')
    const [year, month, day] = datePart.split('-').map(Number)
    const [hour, minute] = timePart.split(':').map(Number)

    // Use Intl to figure out what UTC offset applies at this date/time in this timezone
    const probe = new Date(Date.UTC(year, month - 1, day, hour, minute))

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    })

    // Binary search for the UTC instant that corresponds to the local time
    // Simple approach: compute offset by comparing formatted output
    const parts = formatter.formatToParts(probe)
    const get = (type) => parseInt(parts.find(p => p.type === type).value)
    const probeLocalH = get('hour') === 24 ? 0 : get('hour')
    const probeLocalM = get('minute')
    const probeLocalD = get('day')
    const probeLocalMo = get('month')

    // Offset in minutes = (probe UTC time) - (what it looks like in timezone)
    // We know probe is hour:minute UTC, and it shows as probeLocalH:probeLocalM in tz
    const utcMinutes = hour * 60 + minute
    const localMinutes = probeLocalH * 60 + probeLocalM

    // Day difference adjustment
    let dayDiff = 0
    if (probeLocalD !== day || probeLocalMo !== month) {
      // Rough: if local day is ahead, offset is positive (east of UTC)
      if (probeLocalD > day || probeLocalMo > month) dayDiff = 1
      else dayDiff = -1
    }

    const offsetMinutes = (localMinutes + dayDiff * 1440) - utcMinutes

    // The actual UTC time = local time - offset
    return new Date(Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60000).getTime()
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
