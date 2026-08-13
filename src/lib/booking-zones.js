import { getAirportTimezone } from './airports'
import { parseDetails } from './bookingStats'

/**
 * Which clock a booking's dates belong to — the PROVIDER's, not the reader's.
 *
 * A cancellation cutoff is a term of the contract: a Kyoto hotel's "free until
 * 18:00 on Sep 5" is 18:00 in Kyoto whether you read it from Kyoto or from a
 * seat over the Pacific. Resolving it against the device clock is what let a
 * HK→Vancouver flight roll "now" back ~15h and resurrect a lapsed refund tier.
 *
 * A booking may CARRY its zone (bookings.timezone), which is the only answer
 * that isn't a guess — nothing else in the row places a Kyoto ryokan or a
 * Eurostar hop across the Channel. The rest of the chain infers from airports,
 * the one thing in this app that geolocates itself, and ends in null: a
 * legitimate answer meaning "we cannot place this booking on the map", which
 * callers read as the device's own clock.
 */

/**
 * A booking's own zone: for a flight, the departure airport. You cancel a flight
 * before it leaves, standing where it leaves from, so that is the clock its
 * cutoff and its start_date are written in. Nothing else geolocates itself.
 *
 * @returns {string | null} IANA zone
 */
export function bookingZone(booking) {
  if (!booking || booking.type !== 'flight') return null
  return getAirportTimezone(parseDetails(booking).departure_airport)
}

/**
 * A trip's zone: where its earliest flight LANDS. That's the "getting there"
 * flight, so its arrival airport is the destination — a good enough proxy for
 * the hotels, rentals and activities booked on that trip, none of which carry a
 * location we can resolve. A trip with no flights has no zone.
 *
 * @param {{ id: string } | string | null} trip the trip or its id
 * @param {Array} bookings any booking set; rows from other trips are ignored
 * @returns {string | null} IANA zone
 */
export function tripZone(trip, bookings) {
  const flight = arrivingFlight(trip, bookings)
  return flight ? getAirportTimezone(parseDetails(flight).arrival_airport) : null
}

/** The flight tripZone reads, kept separate so a caller can name it. */
function arrivingFlight(trip, bookings) {
  const tripId = typeof trip === 'string' ? trip : trip?.id
  if (!tripId || !Array.isArray(bookings)) return null
  let earliest = null
  for (const b of bookings) {
    if (b.trip_id !== tripId || b.type !== 'flight' || !b.start_date) continue
    // Naive wall-clock strings, so a lexicographic compare orders them.
    if (!earliest || String(b.start_date) < String(earliest.start_date)) earliest = b
  }
  return earliest
}

/**
 * Where the traveller is headed: the arrival airport of the last flight that had
 * already taken off when this booking starts. Deliberately searched across every
 * booking handed in, not just this booking's trip — a journey is often split
 * into several trips with different rosters, so the flight that placed you in
 * the country can live on a trip this booking doesn't belong to.
 *
 * TAKEOFF, not landing, is what splits a travel day in two. A check-in time is
 * nominal — 16:00, 18:00, midnight for a date-only booking — and routinely
 * earlier in the day than the plane touches down, so asking "which flight had
 * LANDED by then?" skipped the flight that brought you there and reached back to
 * the city you left that morning.
 *
 * Known residual: a date-only booking at the ORIGIN of a departure day still
 * resolves to the destination — a lounge breakfast entered as "Aug 1" before
 * flying out reads as the arrival city. Nothing in the row separates it from the
 * hotel you sleep in that night, so no rule here can; the form offering this as
 * a suggestion rather than a fact is what catches it.
 *
 * Beats tripZone on the two cases it exists for: a multi-zone trip (you flew on
 * again, so the trip's FIRST landing is stale) and a return-leg trip holding
 * only the flight home and the last night's hotel (no landing on that trip yet).
 *
 * @param {Array} bookings every booking in scope, any trip
 * @returns {string | null} IANA zone
 */
export function chronologicalZone(booking, bookings) {
  const flight = placingFlight(booking, bookings)
  return flight ? getAirportTimezone(parseDetails(flight).arrival_airport) : null
}

/**
 * A stored start with no time of day. "Aug 29" means the whole of Aug 29, not
 * literally 00:00, so such a booking is placed by the day a flight lands rather
 * than by the minute it took off. A real 00:00 departure looks identical to this
 * and gets the day-wide reading too — accepted, not overlooked.
 */
const DATE_ONLY = /T00:00(:00)?$/

/** The flight chronologicalZone reads, kept separate so a caller can name it. */
function placingFlight(booking, bookings) {
  if (!booking?.start_date || !Array.isArray(bookings)) return null
  const start = String(booking.start_date)
  const wholeDay = DATE_ONLY.test(start)
  const startDay = start.slice(0, 10)
  let latest = null
  for (const b of bookings) {
    // Self-exclusion is load-bearing, not defensive: an eastbound flight over
    // the dateline lands at a wall-clock time BEFORE it departs, so a flight
    // would otherwise qualify as its own preceding landing.
    if (!b || b.id === booking.id || b.type !== 'flight' || !b.start_date || !b.end_date) continue
    // Naive wall-clock strings, so a lexicographic compare orders them.
    const qualifies = wholeDay
      ? String(b.end_date).slice(0, 10) <= startDay
      : String(b.start_date) <= start
    if (!qualifies) continue
    // Latest LANDING among the qualifiers: with two flights the same day it is
    // the second one that says where you ended up.
    if (!latest || String(b.end_date) > String(latest.end_date)) latest = b
  }
  return latest
}

/**
 * The zone to read a booking's dates in: the one it carries, else its own
 * departure airport, else wherever the last flight put us down, else the trip's
 * destination, else null (the caller falls back to device-local).
 *
 * tripZone stays last rather than being retired — it still answers when a trip's
 * only flight lands AFTER the booking starts, which chronologicalZone can't see.
 *
 * @returns {string | null} IANA zone
 */
export function resolveZone(booking, trip, bookings) {
  const stored = booking?.timezone
  if (typeof stored === 'string' && stored) return stored
  return bookingZone(booking) ?? chronologicalZone(booking, bookings) ?? tripZone(trip, bookings)
}

/**
 * resolveZone for a whole list, with the trip fallback memoized: resolving one
 * trip's zone scans every booking, and the money screens ask once per row.
 *
 * @returns {(booking: any) => string | null}
 */
export function makeZoneResolver(bookings = []) {
  const tripZones = new Map()
  return (booking) => {
    // Same chain as resolveZone, kept open here so only the trip step memoizes.
    const own = booking?.timezone || bookingZone(booking) || chronologicalZone(booking, bookings)
    if (own) return own
    if (!tripZones.has(booking.trip_id)) {
      tripZones.set(booking.trip_id, tripZone(booking.trip_id, bookings))
    }
    return tripZones.get(booking.trip_id)
  }
}

/** An airport code as the traveller wrote it on the booking. */
const code = (value) => String(value || '').trim().toUpperCase()

/**
 * A stored wall-clock date as "Aug 12". Sliced to the day before parsing: a bare
 * "YYYY-MM-DD" is read as UTC and renders as the day before for half the world.
 */
function shortDay(value) {
  const day = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * resolveZone's answer plus the sentence that justifies it.
 *
 * The booking form offers this as a suggestion rather than pre-filling it: an
 * inference nobody can check is how a wrong zone gets saved unnoticed, and the
 * chain has four links that produce very different answers for the same row. A
 * sibling of resolveZone rather than a wider return type, so the callers that
 * only want the zone (Costs, BookingCard) keep receiving a bare string.
 *
 * @returns {{ zone: string, why: string } | null} null when nothing places the booking
 */
export function suggestZone(booking, trip, bookings) {
  const stored = booking?.timezone
  if (typeof stored === 'string' && stored) return { zone: stored, why: 'saved on this booking' }

  const own = bookingZone(booking)
  if (own) return { zone: own, why: `this flight departs ${code(parseDetails(booking).departure_airport)}` }

  // Each link is re-resolved through the exported function rather than read off
  // the flight directly, so the suggestion can never disagree with resolveZone —
  // a landing at an airport this app can't place falls through here too.
  const landed = chronologicalZone(booking, bookings)
  if (landed) {
    const flight = placingFlight(booking, bookings)
    const d = parseDetails(flight)
    const arrival = code(d.arrival_airport)
    const number = d.flight_number ? `, ${d.flight_number}` : ''
    const on = (value) => (shortDay(value) ? ` on ${shortDay(value)}` : '')
    // The sentence has to name the fact that actually qualified the flight. On a
    // travel day the plane is still in the air when a 16:00 check-in or a
    // date-only midnight passes, and "you land … before this starts" would then
    // read as a contradiction of the times printed on the same screen.
    const why =
      String(flight.end_date) <= String(booking.start_date)
        ? `you land at ${arrival}${on(flight.end_date)}${number} before this starts`
        : DATE_ONLY.test(String(booking.start_date))
          ? `you land at ${arrival}${on(flight.end_date)}${number}, the day this starts`
          : `you take off for ${arrival}${on(flight.start_date)}${number} before this starts`
    return { zone: landed, why }
  }

  const destination = tripZone(trip, bookings)
  if (destination) {
    const flight = arrivingFlight(trip, bookings)
    return {
      zone: destination,
      why: `this trip's first flight lands at ${code(parseDetails(flight).arrival_airport)}`,
    }
  }
  return null
}
