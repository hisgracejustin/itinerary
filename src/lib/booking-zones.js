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
  const tripId = typeof trip === 'string' ? trip : trip?.id
  if (!tripId || !Array.isArray(bookings)) return null
  let earliest = null
  for (const b of bookings) {
    if (b.trip_id !== tripId || b.type !== 'flight' || !b.start_date) continue
    // Naive wall-clock strings, so a lexicographic compare orders them.
    if (!earliest || String(b.start_date) < String(earliest.start_date)) earliest = b
  }
  return earliest ? getAirportTimezone(parseDetails(earliest).arrival_airport) : null
}

/**
 * Where the traveller was last put down: the arrival airport of the most recent
 * flight that had already LANDED when this booking starts. Deliberately searched
 * across every booking handed in, not just this booking's trip — a journey is
 * often split into several trips with different rosters, so the flight that
 * placed you in the country can live on a trip this booking doesn't belong to.
 *
 * Beats tripZone on the two cases it exists for: a multi-zone trip (you flew on
 * again, so the trip's FIRST landing is stale) and a return-leg trip holding
 * only the flight home and the last night's hotel (no landing on that trip yet).
 *
 * @param {Array} bookings every booking in scope, any trip
 * @returns {string | null} IANA zone
 */
export function chronologicalZone(booking, bookings) {
  if (!booking?.start_date || !Array.isArray(bookings)) return null
  const start = String(booking.start_date)
  let latest = null
  for (const b of bookings) {
    // Self-exclusion is load-bearing, not defensive: an eastbound flight over
    // the dateline lands at a wall-clock time BEFORE it departs, so a flight
    // would otherwise qualify as its own preceding landing.
    if (!b || b.id === booking.id || b.type !== 'flight' || !b.end_date) continue
    const landed = String(b.end_date)
    if (landed > start) continue
    if (!latest || landed > String(latest.end_date)) latest = b
  }
  return latest ? getAirportTimezone(parseDetails(latest).arrival_airport) : null
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
