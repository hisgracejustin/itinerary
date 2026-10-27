/**
 * Paying a balance in a currency other than the one it's owed in.
 *
 * A payment always SETTLES in the debt's own currency: `amount` + `currency` on
 * the settlement row, which is all the balance math reads (./split). When the
 * money actually changed hands in another currency, the row also records
 * `paid_currency` + `paid_amount` — what was sent, at the rate the two people
 * agreed. That pair is a record, never balance math, so a CAD debt paid in HKD
 * still clears the CAD balance to exactly zero and leaves HKD balances alone.
 * The rate itself isn't stored; it's read back from the two amounts
 * (shownRate).
 *
 * Pricing works on LEGS — one per settlement row — which may run either way
 * (`reverse`) and may be in different currencies, so the same code prices one
 * transfer, a transfer split across trips, or several currencies settled in one
 * currency at once.
 */
import { FX_RATES_TO_HKD, HOME_CURRENCY } from './currencies'

const ZERO_DECIMAL = ['JPY', 'KRW', 'TWD']

/** @typedef {{ amount: number, currency: string, reverse?: boolean }} Leg */

/** Minor units per major unit: 100 for cents, 1 for whole-yen currencies. */
export const minorScale = (currency) => (ZERO_DECIMAL.includes(currency) ? 1 : 100)
const toMinor = (value, currency) => Math.round(value * minorScale(currency))
const roundMoney = (value, currency) => toMinor(value, currency) / minorScale(currency)

/**
 * The app's daily rate for paying `from` in `to`: 1 `from` = `rate` `to`.
 * Stored rates are "1 ccy = Y HKD", so both sides go through HKD, each using
 * the live daily rate when there is one and the built-in table otherwise.
 * `live` is false when either side needed the built-in table; `rateDate` is
 * the live rates' publication date.
 *
 * @param {string} from
 * @param {string} to
 * @param {{ rates?: Record<string, number>, rateDate?: string | null } | null | undefined} fx
 * @returns {{ rate: number, live: boolean, rateDate: string | null } | null}
 */
export function dailyRate(from, to, fx) {
  if (!from || !to || from === to) return null
  const toHkd = (c) => {
    if (c === 'HKD') return { value: 1, live: true }
    const live = fx?.rates?.[c]
    if (live > 0) return { value: live, live: true }
    const builtIn = FX_RATES_TO_HKD[c]
    return builtIn > 0 ? { value: builtIn, live: false } : null
  }
  const a = toHkd(from)
  const b = toHkd(to)
  if (!a || !b) return null
  const live = a.live && b.live
  return { rate: a.value / b.value, live, rateDate: live ? (fx?.rateDate ?? null) : null }
}

/** A rate as it should start out in an input: six significant figures. */
export const rateInput = (rate) => String(Number(rate.toPrecision(6)))

/**
 * Price `legs` in `paidCurrency`. A leg is `{ amount, currency, reverse? }`; a
 * reverse leg runs the other way and counts against the total. `rates` maps
 * each leg currency to "1 leg currency = rate paidCurrency".
 *
 * The total is the signed sum at those rates, rounded once to the paid
 * currency's minor unit — or `total`, when the payer typed what was actually
 * received, in which case every leg scales by the same factor. Each leg's
 * `paid_amount` is its own price, rounded, with the rounding remainder on the
 * largest leg so forward minus reverse paid amounts equal the total exactly.
 *
 * Returns null when a rate is missing or the total doesn't come out positive
 * (too small to pay in that currency, or legs that net the other way).
 *
 * @template {Leg} T
 * @param {{ legs: T[], paidCurrency: string, rates: Record<string, number>,
 *           total?: number | null }} input
 * @returns {{ total: number, legs: Array<T & { paid_amount: number }> } | null}
 */
export function priceLegs({ legs, paidCurrency, rates, total = null }) {
  if (!legs?.length || !paidCurrency) return null
  if (legs.some((l) => !(rates?.[l.currency] > 0) || !(l.amount > 0))) return null
  const scale = minorScale(paidCurrency)
  const sign = (l) => (l.reverse ? -1 : 1)
  const values = legs.map((l) => l.amount * rates[l.currency])
  const signed = legs.reduce((s, l, i) => s + sign(l) * values[i], 0)
  if (!(signed > 0)) return null
  const totalMinor = total == null ? Math.round(signed * scale) : toMinor(total, paidCurrency)
  if (!(totalMinor > 0)) return null

  const factor = total == null ? 1 : totalMinor / scale / signed
  const minors = values.map((v) => Math.round(v * factor * scale))
  const drift = totalMinor - legs.reduce((s, l, i) => s + sign(l) * minors[i], 0)
  if (drift) {
    let big = 0
    for (let i = 1; i < minors.length; i++) if (minors[i] > minors[big]) big = i
    minors[big] += sign(legs[big]) * drift
    if (minors[big] < 0) return null
  }
  return {
    total: totalMinor / scale,
    legs: legs.map((l, i) => ({ ...l, paid_amount: minors[i] / scale })),
  }
}

/**
 * The rate to show for `settled` that was paid as `paid`: the simplest decimal
 * (fewest places) that turns `settled` into exactly `paid` after rounding to
 * the paid currency's minor unit, so an agreed 5.68 reads back as 5.68 rather
 * than 5.679864… from the rounded amounts. Falls back to six significant
 * figures.
 *
 * @returns {number | null}
 */
export function shownRate(settled, paid, paidCurrency) {
  if (!(settled > 0) || !(paid > 0)) return null
  const exact = paid / settled
  const target = toMinor(paid, paidCurrency)
  for (let d = 0; d <= 8; d++) {
    const r = Math.round(exact * 10 ** d) / 10 ** d
    if (r > 0 && toMinor(settled * r, paidCurrency) === target) return r
  }
  return Number(exact.toPrecision(6))
}

/**
 * Starting state for "paid in another currency" on a payment owed in
 * `settleCurrency`: paid in `preferred` when that's a different currency, else
 * the home currency (or nothing yet when the debt is itself in the home
 * currency), at the latest daily rate.
 *
 * State is `{ currency, rate, received, source }`: `rate` and `received` are
 * the raw input strings, and `source` is whichever of them was typed last —
 * that one stays as typed and the other follows it.
 *
 * @param {string} settleCurrency
 * @param {{ rates?: Record<string, number>, rateDate?: string | null } | null | undefined} fx
 * @param {string | null} [preferred]
 * @returns {{ currency: string, rate: string, received: string, source: string }}
 */
export function startPaid(settleCurrency, fx, preferred = null) {
  const currency =
    preferred && preferred !== settleCurrency
      ? preferred
      : settleCurrency !== HOME_CURRENCY
        ? HOME_CURRENCY
        : ''
  const daily = dailyRate(settleCurrency, currency, fx)
  return { currency, rate: daily ? rateInput(daily.rate) : '', received: '', source: 'rate' }
}

/**
 * Resolve that state against the legs being settled, all in ONE currency (a
 * single payment, or one transfer split across trips).
 *
 * @template {Leg} T
 * @param {{ currency: string, rate: string, received: string, source: string } | null} state
 * @param {T[] | null} legs
 * @returns {null | { error: string } | { paidCurrency: string, rate: number | null,
 *   total: number, legs: Array<T & { paid_amount: number }> }}
 */
export function resolvePaid(state, legs) {
  if (!state || !legs?.length) return null
  const settleCurrency = legs[0].currency
  const paidCurrency = state.currency
  if (!paidCurrency) return { error: 'Pick the currency it was paid in' }
  if (legs.some((l) => l.currency === paidCurrency)) {
    return { error: `Pick a currency other than ${settleCurrency}` }
  }
  const settled = legs.reduce((s, l) => s + (l.reverse ? -l.amount : l.amount), 0)
  if (state.source === 'received') {
    const received = Number.parseFloat(state.received)
    if (!(received > 0)) return { error: 'Enter the amount received' }
    // Any positive rate works here: the typed total decides the price, and the
    // rate only sets each leg's share of it.
    const priced = priceLegs({ legs, paidCurrency, rates: { [settleCurrency]: 1 }, total: received })
    if (!priced) return { error: `That's too small to pay in ${paidCurrency}` }
    return { paidCurrency, rate: shownRate(settled, priced.total, paidCurrency), ...priced }
  }
  const rate = Number.parseFloat(state.rate)
  if (!(rate > 0)) return { error: 'Enter the rate' }
  const priced = priceLegs({ legs, paidCurrency, rates: { [settleCurrency]: rate } })
  if (!priced) return { error: `That's too small to pay in ${paidCurrency}` }
  return { paidCurrency, rate, ...priced }
}

/**
 * How the Payments list reads a payment: one row for a plain payment, or a
 * multi-trip payment's per-trip rows. Oriented on whichever direction carries
 * more money; `settled` is the net per currency in that direction, and `paid`
 * the net that changed hands when every row was paid in the same other
 * currency (with the rate when one currency was settled).
 *
 * @param {Array<{ from_user: string, to_user: string, amount: number, currency: string,
 *   paid_currency?: string | null, paid_amount?: number | null }>} rows settlement rows
 * @returns {{ fromUser: string, toUser: string, sign: (row: { from_user: string }) => number,
 *   settled: Array<{ currency: string, amount: number }>,
 *   paid: { currency: string, amount: number, rate: number | null } | null }}
 */
export function summarizePayment(rows) {
  const first = rows[0]
  const paidCurrency =
    first.paid_currency && rows.every((r) => r.paid_currency === first.paid_currency)
      ? first.paid_currency
      : null
  // Compare directions on comparable money: what changed hands when that's one
  // currency, else what was settled.
  const handed = (r) => Number(paidCurrency ? r.paid_amount : r.amount) || 0
  const sumDir = (from, to) =>
    rows.reduce((s, r) => s + (r.from_user === from && r.to_user === to ? handed(r) : 0), 0)
  const flip = sumDir(first.to_user, first.from_user) > sumDir(first.from_user, first.to_user)
  const fromUser = flip ? first.to_user : first.from_user
  const toUser = flip ? first.from_user : first.to_user
  const sign = (r) => (r.from_user === fromUser ? 1 : -1)

  const byCurrency = new Map()
  for (const r of rows) {
    byCurrency.set(r.currency, (byCurrency.get(r.currency) || 0) + sign(r) * (Number(r.amount) || 0))
  }
  const settled = [...byCurrency].map(([currency, amount]) => ({
    currency,
    amount: roundMoney(amount, currency),
  }))
  const paidAmount = paidCurrency
    ? roundMoney(rows.reduce((s, r) => s + sign(r) * (Number(r.paid_amount) || 0), 0), paidCurrency)
    : 0
  const paid = paidCurrency
    ? {
        currency: paidCurrency,
        amount: paidAmount,
        rate: settled.length === 1 ? shownRate(settled[0].amount, paidAmount, paidCurrency) : null,
      }
    : null
  return { fromUser, toUser, sign, settled, paid }
}
