/**
 * The one shape both money screens read: a booking's cost and an ad-hoc expense
 * flattened into the same item, plus the scope math that turns "what this cost"
 * into "what this cost ME / US".
 *
 * Shared because /costs (what everything costs) and /refund (what comes back if
 * you cancel) ask the same questions of the same rows — the two must never
 * disagree about what a viewer's share of a booking is.
 */

import { toHKD } from './currencies'
import { expenseCategory } from './expense-categories'
import { bookingZone, chronologicalZone, tripZone } from './booking-zones'

// Expenses carry a category rather than a booking type, and each one gets its
// own bar in the By Type card. The prefix keeps those keys clear of the booking
// types — an expense filed under Activities is not a booked activity.
const EXPENSE_TYPE_PREFIX = 'expense:'

export const expenseTypeKey = (category) => `${EXPENSE_TYPE_PREFIX}${expenseCategory(category).value}`

/** The category behind a By Type key, or null for a booking type. */
export const expenseTypeEntry = (type) =>
  type.startsWith(EXPENSE_TYPE_PREFIX) ? expenseCategory(type.slice(EXPENSE_TYPE_PREFIX.length)) : null

/** Exact charged currency + rate, or null when the row was never re-denominated. */
const chargedOf = (row) =>
  Number(row.charged_rate) > 0 && row.charged_currency
    ? { rate: Number(row.charged_rate), currency: row.charged_currency }
    : null

/** A cost-bearing booking as a cost item. Effective cost = amount × share. */
export function bookingCostItem(b) {
  return {
    id: `bk-${b.id}`,
    kind: 'booking',
    type: b.type,
    title: b.title,
    subtitle: b.provider,
    trip_id: b.trip_id,
    currency: b.cost_currency,
    cost_share: b.cost_share,
    effective: b.cost_amount * (b.cost_share != null ? b.cost_share : 1),
    splits: Array.isArray(b.splits) ? b.splits : [],
    charged: chargedOf(b),
    booking: b,
  }
}

/** An ad-hoc expense as a cost item. Nothing to prorate — the share is 1. */
export function expenseCostItem(e) {
  return {
    id: `ex-${e.id}`,
    kind: 'expense',
    type: expenseTypeKey(e.category),
    title: e.title,
    subtitle: e.date || 'Expense',
    trip_id: e.trip_id,
    currency: e.currency,
    cost_share: 1,
    effective: e.amount || 0,
    splits: Array.isArray(e.splits) ? e.splits : [],
    charged: chargedOf(e),
    expense: e,
  }
}

/**
 * The approximate HKD value of a native `amount` for one item. A charged rate
 * re-denominates it exactly: charged-in-HKD contributes its EXACT charged value
 * (no approx FX); charged-in-other converts the charged value via live rates;
 * otherwise convert the native amount.
 */
export function hkdOf(item, amount, rates) {
  if (item.charged) {
    const value = amount * item.charged.rate
    return item.charged.currency === 'HKD' ? value : toHKD(value, item.charged.currency, rates)
  }
  return toHKD(amount, item.currency, rates)
}

/**
 * resolveZone for a whole list, with the trip fallback memoized: resolving one
 * trip's zone scans every booking, and these screens ask once per row.
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

/**
 * The user ids that count toward a viewer's scope inside one trip: just them
 * under 'me', their party under 'us' (correct even when the partner set differs
 * between trips), and null under 'everyone' — nobody is filtered out there.
 */
export function scopeUserIds({ scope, trip, currentUserId }) {
  if (scope === 'everyone') return null
  if (scope === 'me') return new Set([currentUserId])
  const row = (trip?.members || []).find((m) => m.id === currentUserId)
  if (!row?.party_id) return new Set([currentUserId])
  return new Set((trip.members || []).filter((m) => m.party_id === row.party_id).map((m) => m.id))
}

/**
 * One item's contribution in its own currency. `users` null (scope 'everyone')
 * is the whole effective cost; otherwise it's that set's share, and `null` comes
 * back when the item can't be attributed at all — no splits, extras above the
 * cost, or nothing to divide by.
 */
export function itemContribution(item, users) {
  if (!users) return item.effective
  if (item.splits.length === 0) return null
  // Same extras-off-the-top formula as split.js: scope share =
  //   Σ_{scope} extra + (Σ_{scope} weight / Σweight) × (effective − Σextras)
  const sumW = item.splits.reduce((s, r) => s + (Number(r.weight) || 0), 0)
  const sumExtras = item.splits.reduce((s, r) => s + (Number(r.extra_amount) || 0), 0)
  if (sumExtras > item.effective + 0.01) return null // extras exceed the cost
  const remainder = item.effective - sumExtras
  if (remainder > 0.01 && sumW <= 0) return null // nothing to divide by
  const scopeExtras = item.splits.reduce((s, r) => s + (users.has(r.user_id) ? Number(r.extra_amount) || 0 : 0), 0)
  const scopeW = item.splits.reduce((s, r) => s + (users.has(r.user_id) ? Number(r.weight) || 0 : 0), 0)
  return scopeExtras + (sumW > 0 ? (scopeW / sumW) * remainder : 0)
}
