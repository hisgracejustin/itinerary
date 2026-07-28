/**
 * Cancellation-policy math — pure functions, no DB access, no React. Style
 * mirrors src/lib/split.js.
 *
 * A policy lives at `details.cancellation_policy` (jsonb — no columns, no
 * migration) and is THREE-WAY:
 *
 *   Tier[]           — tiered refunds, an ascending list of:
 *                        { cutoff: 'YYYY-MM-DD'          // whole day, or
 *                                | 'YYYY-MM-DDTHH:mm',   // naive wall-clock
 *                          kind:   'percent' | 'amount', // what `value` means
 *                          value:  number }              // 0-100, or a flat
 *                                                        // cost_currency amount
 *   'non_refundable' — KNOWN non-cancellable: nothing comes back, ever.
 *   null             — UNKNOWN: no policy recorded. Callers must keep this
 *                      distinct from 'non_refundable' (an unrecorded policy is
 *                      not evidence of a non-refundable booking) — /costs
 *                      buckets the two separately.
 *
 * Semantics:
 *  - The tier that applies on an as-of date D is the EARLIEST tier with
 *    `cutoff >= D` — "cancel on or before this date and you get this back".
 *    Past the last cutoff the booking is non-refundable.
 *  - `percent` applies to the EFFECTIVE cost (`cost_amount × cost_share`), the
 *    same base split.js and the Costs screen use, so the refundable figure stays
 *    internally consistent with everything else on /costs. A booking whose cost
 *    is shared externally therefore shows a smaller absolute refund than the
 *    confirmation email quotes — that's the trip's portion of it.
 *  - `amount` is a flat figure already in the booking's cost_currency (NOT
 *    share-scaled), clamped to the effective cost so a stale policy on a
 *    reduced booking can't refund more than was spent.
 *  - Every date here is a naive string compared LEXICOGRAPHICALLY, never
 *    `new Date()` day math — the app's convention (a booking must land on the
 *    same calendar day for every viewer, in any timezone). A cutoff is either
 *    'YYYY-MM-DD' (deadline is the end of that day) or 'YYYY-MM-DDTHH:mm' when
 *    the document names a time ("free until 6:00 PM on Sep 5"), stored as
 *    wall-clock with no timezone. Mixing the two formats is safe: string compare
 *    puts '2026-09-05T18:00' at or after '2026-09-05' and before '2026-09-06'.
 *  - SOFT SPOT: as-of values are date-only, so on the cutoff's OWN day a timed
 *    cutoff still counts as applicable — deliberately optimistic (it assumes you
 *    would cancel before that day's deadline rather than after it). The day
 *    after, it has correctly expired.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CUTOFF_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/

/**
 * Normalize whatever was stored, parsed or typed into a sorted tier list, the
 * 'non_refundable' marker, or null if nothing usable survives. Malformed tiers
 * are DROPPED rather than throwing: this runs on the AI parser's output, on form
 * state mid-edit, and on legacy rows, and one bad tier must never block a save.
 *
 * @param {unknown} raw
 * @returns {{ cutoff: string, kind: 'percent' | 'amount', value: number }[] | 'non_refundable' | null}
 */
export function sanitizeCancellationPolicy(raw) {
  if (raw === 'non_refundable') return 'non_refundable'
  if (!Array.isArray(raw)) return null
  const tiers = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue
    // Keep a wall-clock time when there is one, but never trust it: a parser can
    // emit seconds ('...T18:00:00'), a space separator, or junk where the time
    // should be — anything that doesn't survive the timed pattern degrades to
    // the date, which is still a usable deadline.
    const normalized = String(t.cutoff ?? '').replace(' ', 'T').slice(0, 16)
    const cutoff = CUTOFF_RE.test(normalized) ? normalized : normalized.slice(0, 10)
    if (!DATE_RE.test(cutoff.slice(0, 10))) continue
    const kind = t.kind === 'amount' ? 'amount' : t.kind === 'percent' ? 'percent' : null
    if (!kind) continue
    // parseFloat, not Number: the form holds tier values as strings, and
    // Number('') is 0 — an untouched "+ Add tier" row would save as a real 0%
    // tier instead of being dropped as incomplete.
    const value = parseFloat(t.value)
    if (!Number.isFinite(value) || value < 0) continue
    tiers.push({ cutoff, kind, value: kind === 'percent' ? Math.min(value, 100) : value })
  }
  if (tiers.length === 0) return null
  return tiers.sort((a, b) => (a.cutoff < b.cutoff ? -1 : a.cutoff > b.cutoff ? 1 : 0))
}

/**
 * The tier that applies when cancelling on `asOfDate`, or null once every cutoff
 * has passed. A 'non_refundable' policy has no tiers, so it's null too — the
 * Array.isArray guard covers it (a bare `.find` on the string would iterate its
 * characters).
 *
 * `asOfDate` is date-only; comparing it against a timed cutoff needs no special
 * casing, since 'YYYY-MM-DDTHH:mm' > 'YYYY-MM-DD' for the same day (see the
 * soft-spot note in the module header).
 *
 * @param {{ cutoff: string, kind: 'percent' | 'amount', value: number }[] | 'non_refundable' | null} policy
 * @param {string} asOfDate
 */
export function applicableTier(policy, asOfDate) {
  if (!Array.isArray(policy) || policy.length === 0 || !asOfDate) return null
  return policy.find((t) => t.cutoff >= asOfDate) || null
}

/**
 * What comes back if this booking is cancelled on `asOfDate`.
 *
 * Returns null when there's no policy on file — "unknown", which callers must
 * NOT render as zero: an unrecorded policy is not a non-refundable booking. A
 * policy of 'non_refundable' IS a zero, and says so.
 *
 * @param {{ cutoff: string, kind: 'percent' | 'amount', value: number }[] | 'non_refundable' | null} policy
 * @param {number} effectiveCost
 * @param {string} asOfDate
 */
export function refundableAsOf(policy, effectiveCost, asOfDate) {
  if (policy === 'non_refundable') return { refundable: 0, tier: null }
  if (!Array.isArray(policy) || policy.length === 0) return null
  const cost = Number(effectiveCost) || 0
  const tier = applicableTier(policy, asOfDate)
  if (!tier) return { refundable: 0, tier: null }
  const raw = tier.kind === 'percent' ? (cost * tier.value) / 100 : tier.value
  return { refundable: Math.max(0, Math.min(raw, cost)), tier }
}

/**
 * Today as a naive local 'YYYY-MM-DD'. NOT toISOString(): that's UTC, which is
 * still yesterday for most of the day east of Greenwich (this app's home).
 */
export function localToday() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 'Sep 5' for a date-only cutoff, 'Sep 5, 18:00' for a timed one. Both parse
 * through a seconds-bearing local datetime string: a bare 'YYYY-MM-DD' is parsed
 * as UTC and renders a day early west of Greenwich, and 'YYYY-MM-DDTHH:mm' with
 * a second `T` appended is an Invalid Date.
 *
 * @param {string} cutoff
 */
export function formatCutoff(cutoff) {
  if (!cutoff) return ''
  const timed = cutoff.length > 10
  const d = new Date(timed ? `${cutoff}:00` : `${cutoff}T00:00:00`)
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(timed ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  })
}
