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
 *                          kind:   'percent'             // what `value` means
 *                                | 'amount'
 *                                | 'fee',
 *                          value:  number,               // 0-100, a flat
 *                                                        // cost_currency amount,
 *                                                        // or a fee to deduct
 *                          credit?: {                    // optional, see below
 *                            kind:    'percent' | 'amount',
 *                            value:   number,
 *                            expiry?: 'YYYY-MM-DD' } }
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
 *  - A tier's optional `credit` is what comes back as VOUCHER rather than cash —
 *    future-travel credit, an airline's flight credit, a re-booking voucher. It
 *    is a rider on the tier, not a replacement: cash and credit are both paid out
 *    by the same tier and are reported separately, never summed (one is money
 *    back, the other is money you must spend with the same provider). `kind` and
 *    `value` mirror the cash side exactly — a percent of the effective cost, or a
 *    flat cost_currency amount clamped to it.
 *  - The common airline fare — "non-refundable, but cancel any time before
 *    departure for a full flight credit" — is ONE tier with cash `kind:'percent',
 *    value:0` plus `credit:{ kind:'percent', value:100 }` and cutoff = departure.
 *    An explicit zero cash value is a real tier, not an unfilled one. The
 *    'non_refundable' marker stays reserved for bookings that return literally
 *    nothing, credit included.
 *  - `credit.expiry` is the day the voucher must be USED by — INFORMATIONAL only.
 *    It never gates whether the credit is received (that's the tier's cutoff);
 *    it's carried so the UI can say "expires Sep 5, 2027". Date-only, and unlike
 *    a cutoff it is routinely years out, so surfaces render it WITH the year.
 *  - `fee` is a cancellation/service fee in cost_currency, SUBTRACTED from the
 *    effective cost ("full refund minus a $25 fee") and floored at 0. Like
 *    `amount` it is not share-scaled — it comes off the effective cost before
 *    any scope scaling a caller applies, so a shared booking's viewer sees their
 *    fraction of the post-fee refund, not a fraction of the fee.
 *  - Every date here is a naive string compared LEXICOGRAPHICALLY, never
 *    `new Date()` day math — the app's convention (a booking must land on the
 *    same calendar day for every viewer, in any timezone). A cutoff is either
 *    'YYYY-MM-DD' (deadline is the end of that day) or 'YYYY-MM-DDTHH:mm' when
 *    the document names a time ("free until 6:00 PM on Sep 5"), stored as
 *    wall-clock with no timezone. Mixing the two formats is safe: string compare
 *    puts '2026-09-05T18:00' at or after '2026-09-05' and before '2026-09-06'.
 *  - A date-only cutoff means "through the END of that day", so comparisons
 *    expand it to 'T23:59'. Without that, an as-of of '2026-09-05T19:23' would
 *    read a '2026-09-05' cutoff as having expired at midnight.
 *  - As-of values may themselves be date-only or timed. A timed as-of (the
 *    /costs picker sends one) resolves a same-day timed cutoff EXACTLY — 19:23
 *    is past an 18:00 deadline. SOFT SPOT: with a date-only as-of (BookingCard's
 *    at-a-glance hint) a same-day timed cutoff still counts as applicable, which
 *    is deliberately optimistic — it assumes you would cancel before that day's
 *    deadline rather than after it.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CUTOFF_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/

/**
 * @typedef {{ kind: 'percent' | 'amount', value: number, expiry?: string }} Credit
 * @typedef {{ cutoff: string, kind: 'percent' | 'amount' | 'fee', value: number, credit?: Credit }} Tier
 */

/**
 * A tier's optional refund-as-credit rider, or null if nothing usable is there.
 * Returning null makes the caller drop the whole `credit` key: a credit with no
 * readable kind/value is noise, and the tier's cash side still stands alone.
 *
 * @param {unknown} raw
 * @returns {{ kind: 'percent' | 'amount', value: number, expiry?: string } | null}
 */
function sanitizeCredit(raw) {
  if (!raw || typeof raw !== 'object') return null
  // No 'fee' here — a fee is deducted from a refund, which is a cash mechanic;
  // a voucher is only ever issued as a percent or a flat amount.
  const kind = ['percent', 'amount'].includes(raw.kind) ? raw.kind : null
  if (!kind) return null
  // parseFloat for the same reason the cash value uses it: the form holds this
  // as a string, and Number('') is 0 — an untouched "+ credit" row would save as
  // a real 0-value credit instead of being dropped as incomplete.
  const value = parseFloat(raw.value)
  if (!Number.isFinite(value) || value < 0) return null
  const credit = { kind, value: kind === 'percent' ? Math.min(value, 100) : value }
  // Expiry is date-only (a voucher expires at the end of its day) and purely
  // informational, so junk is dropped FROM the credit rather than taking the
  // credit down with it — the vouchers still exist, we just can't date them.
  const expiry = String(raw.expiry ?? '').slice(0, 10)
  if (DATE_RE.test(expiry)) credit.expiry = expiry
  return credit
}

/**
 * Normalize whatever was stored, parsed or typed into a sorted tier list, the
 * 'non_refundable' marker, or null if nothing usable survives. Malformed tiers
 * are DROPPED rather than throwing: this runs on the AI parser's output, on form
 * state mid-edit, and on legacy rows, and one bad tier must never block a save.
 *
 * @param {unknown} raw
 * @returns {Tier[] | 'non_refundable' | null}
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
    const kind = ['percent', 'amount', 'fee'].includes(t.kind) ? t.kind : null
    if (!kind) continue
    // parseFloat, not Number: the form holds tier values as strings, and
    // Number('') is 0 — an untouched "+ Add tier" row would save as a real 0%
    // tier instead of being dropped as incomplete.
    const value = parseFloat(t.value)
    if (!Number.isFinite(value) || value < 0) continue
    const tier = { cutoff, kind, value: kind === 'percent' ? Math.min(value, 100) : value }
    // A malformed credit is dropped on its own — the cash tier around it is
    // still good. Note a 0% cash tier survives on its own too: "nothing in cash"
    // is a real answer, whether or not a credit rides along with it.
    const credit = sanitizeCredit(t.credit)
    if (credit) tier.credit = credit
    tiers.push(tier)
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
 * A date-only cutoff runs through the END of its day, so it's expanded to 23:59
 * before comparing — otherwise a timed `asOfDate` would read it as expired from
 * midnight onwards. Timed cutoffs compare as-is.
 *
 * @param {Tier[] | 'non_refundable' | null} policy
 * @param {string} asOfDate 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'
 */
export function applicableTier(policy, asOfDate) {
  if (!Array.isArray(policy) || policy.length === 0 || !asOfDate) return null
  return policy.find((t) => (t.cutoff.length > 10 ? t.cutoff : `${t.cutoff}T23:59`) >= asOfDate) || null
}

/**
 * What comes back if this booking is cancelled on `asOfDate`.
 *
 * Returns null when there's no policy on file — "unknown", which callers must
 * NOT render as zero: an unrecorded policy is not a non-refundable booking. A
 * policy of 'non_refundable' IS a zero, and says so.
 *
 * `credit` is the voucher side of the same tier, reported ALONGSIDE `refundable`
 * and never folded into it — HK$0 back plus HK$4,000 of flight credit is not a
 * HK$4,000 refund. It's 0 for a tier with no credit, so callers can sum it
 * unconditionally.
 *
 * @param {Tier[] | 'non_refundable' | null} policy
 * @param {number} effectiveCost
 * @param {string} asOfDate 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'
 */
export function refundableAsOf(policy, effectiveCost, asOfDate) {
  if (policy === 'non_refundable') return { refundable: 0, tier: null, credit: 0 }
  if (!Array.isArray(policy) || policy.length === 0) return null
  const cost = Number(effectiveCost) || 0
  const tier = applicableTier(policy, asOfDate)
  if (!tier) return { refundable: 0, tier: null, credit: 0 }
  const raw =
    tier.kind === 'percent'
      ? (cost * tier.value) / 100
      : tier.kind === 'fee'
        ? cost - tier.value
        : tier.value
  // Same clamp as the cash side: a percent of the effective cost, or a flat
  // amount that a shrunken booking can't inflate past what was actually spent.
  const credit = tier.credit
    ? Math.max(
        0,
        tier.credit.kind === 'percent' ? (cost * tier.credit.value) / 100 : Math.min(tier.credit.value, cost),
      )
    : 0
  // Floors a fee bigger than the booking at 0 and clamps a stale flat amount.
  return { refundable: Math.max(0, Math.min(raw, cost)), tier, credit }
}

const pad = (n) => String(n).padStart(2, '0')

/**
 * Today as a naive local 'YYYY-MM-DD'. NOT toISOString(): that's UTC, which is
 * still yesterday for most of the day east of Greenwich (this app's home).
 */
export function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Now as a naive local 'YYYY-MM-DDTHH:mm' — localToday plus the wall clock, for
 * as-of values that need to resolve a same-day timed cutoff. Same anti-UTC
 * rationale as localToday.
 */
export function localNow() {
  const d = new Date()
  return `${localToday()}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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

/**
 * 'Sep 5, 2027' for a credit expiry. Deliberately NOT formatCutoff: a cutoff is
 * days or weeks out and reads fine year-less, but a voucher expiry is usually a
 * year or two after the trip, where a bare 'Sep 5' is ambiguous. Parsed through
 * a local midnight for the same reason as formatCutoff — a bare 'YYYY-MM-DD' is
 * read as UTC and renders a day early west of Greenwich.
 *
 * @param {string} expiry 'YYYY-MM-DD'
 */
export function formatExpiry(expiry) {
  if (!expiry) return ''
  return new Date(`${expiry}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
