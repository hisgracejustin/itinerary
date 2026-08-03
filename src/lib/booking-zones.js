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
 * Only airports carry a zone in this app, so the resolution is a chain of
 * proxies ending in null — and null is a legitimate answer, meaning "we cannot
 * place this booking on the map", which callers read as the device's own clock.
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
 * The zone to read a booking's dates in: its own if it has one, otherwise its
 * trip's destination, otherwise null (the caller falls back to device-local).
 *
 * @returns {string | null} IANA zone
 */
export function resolveZone(booking, trip, bookings) {
  return bookingZone(booking) ?? tripZone(trip, bookings)
}
