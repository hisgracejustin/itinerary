import { formatCurrency } from './currencies'
import { resolveZone } from './booking-zones'
import { wallClockInZone } from './airports'
import { sanitizeCancellationPolicy, applicableTier, nowInstant, formatCutoff } from './cancellation'

/**
 * One line of refund status for a glance surface, or null when there is nothing
 * worth saying: "↩ 100% until 9 Aug", "↩ −$50 fee until 12 Sep", "Non-refundable".
 *
 * Deliberately ONE tier, never the ladder. `applicableTier` returns the tier in
 * force right now, so a three-step policy still renders as a single line and an
 * expired one renders nothing at all — an elapsed tier is worse than silence,
 * since non-refundable is already the assumption a reader brings to the card.
 *
 * "Now" is resolved in the PROVIDER's zone (see booking-zones.js), so the line
 * reads the same in the departure lounge as it did at home.
 */
export function refundHint(booking, details = {}) {
  const policy = sanitizeCancellationPolicy(details.cancellation_policy)
  // No ↩ here: the arrow means money coming back, and none is.
  if (policy === 'non_refundable') return 'Non-refundable'
  const asOf = wallClockInZone(nowInstant(), resolveZone(booking)).slice(0, 10)
  const tier = policy && applicableTier(policy, asOf)
  if (!tier) return null
  const money = formatCurrency(tier.value, booking.cost_currency || 'USD')
  // The minus keeps a fee from reading as the amount coming back.
  const value =
    tier.kind === 'percent' ? `${tier.value}%` : tier.kind === 'fee' ? `−${money} fee` : money
  // Flag the voucher, don't quantify it — this is a glance surface, and the
  // '0% +credit' shorthand is exactly what a credit-only fare needs to say.
  const credit = tier.credit ? ' +credit' : ''
  return `↩ ${value}${credit} until ${formatCutoff(tier.cutoff)}`
}
