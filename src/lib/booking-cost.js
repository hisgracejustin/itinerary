/**
 * What a booking actually costs, cancellation included — pure functions, no
 * imports, no DB, no React.
 *
 * A cancelled booking is not deleted: the confirmation number, the attachments
 * and the shape the trip once had are exactly why the row survives. But it
 * stops being spend, and this module is the ONE definition of what that means.
 * /costs, /refund, /settle, the calendar and the per-type stats all read these
 * helpers, so no surface can drift from another.
 *
 * Deliberately its own file rather than living in cost-items.js: split.js needs
 * the same rule and is documented as free of the approximate FX table that
 * cost-items.js imports. Nothing here has a dependency, so both can take it.
 *
 * Naming: `cancellation.js` is about a booking's refund POLICY (what would come
 * back if you cancelled). This is about a booking that HAS been cancelled.
 */

/** Whether this booking has been cancelled. */
export const isCancelled = (b) => !!b?.cancelled_at

/** What the booking would have cost had it gone ahead: amount × share. */
export const bookingOriginal = (b) =>
  b.cost_amount * (b.cost_share != null ? b.cost_share : 1)

/**
 * The booking's effective cost — what the trip is actually out.
 *
 * For a cancelled booking this is the RETAINED amount outright, not the
 * original minus a refund: replacing rather than subtracting means a stale
 * cost_amount can never leak into a total. 0 (the common case) contributes
 * nothing anywhere, which is the whole point of the feature.
 */
export const bookingEffective = (b) =>
  isCancelled(b) ? Number(b.retained_amount) || 0 : bookingOriginal(b)

/**
 * How much of this booking's money survived the cancellation, as a fraction —
 * 1 while live. Absolute per-person figures on the split rows scale by this;
 * weights are ratios and need no help.
 *
 * An unpriced booking (cost_amount null) has no original to take a fraction of,
 * so the factor is 0 and its retained amount stands alone as the effective cost.
 */
export function retentionFactor(b) {
  if (!isCancelled(b)) return 1
  const original = bookingOriginal(b)
  if (!(original > 0)) return 0
  return (Number(b.retained_amount) || 0) / original
}

/**
 * A booking's split rows as the money math should see them.
 *
 * Cancelling never rewrites the stored rows — it isn't an edit of who owed what,
 * it's a change to how much there is to owe — so the rescale happens here, on
 * read. That is what makes reinstating restore the old arithmetic to the cent.
 *
 * `extra_amount` and `paid_amount` are ABSOLUTE figures and scale by the
 * retention factor; `weight` is a ratio and is left alone. Without this a 447
 * baggage extra against a 500 retained fee would hand that person 447 and leave
 * 13 for everyone else — but the baggage was refunded along with the fare.
 * Identical in shape to how split.js rescales an item at its charged rate.
 */
export function scaledSplits(b, splits) {
  const rows = Array.isArray(splits) ? splits : []
  const factor = retentionFactor(b)
  if (factor === 1) return rows
  return rows.map((r) => ({
    ...r,
    extra_amount: (Number(r.extra_amount) || 0) * factor,
    paid_amount: (Number(r.paid_amount) || 0) * factor,
  }))
}
