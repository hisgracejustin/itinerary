/**
 * Everything the trip-summary PDF shows, worked out from the same numbers as
 * Settle up — computeBalances and suggestTransfers (./split) — so the two can
 * never disagree. Pure: the route gathers one trip's rows and the renderer
 * (./trip-summary-pdf) only lays this out.
 *
 * People are settlement UNITS, as on Settle up: a couple who share costs is one
 * row. Amounts stay exact in their own currency; ≈ home-currency figures use
 * one set of daily rates (toHKD) — the trip's last day's once it's over — and
 * are only a guide.
 */
import { computeBalances, suggestTransfers } from './split'
import { FX_RATES_TO_HKD, HOME_CURRENCY, formatCurrency, toHKD } from './currencies'
import { expenseCategory } from './expense-categories'
import { bookingEffective, bookingOriginal, isCancelled } from './booking-cost'
import { avatarIndex } from './avatar'

/**
 * @typedef {{ currency: string, amount: number }} Money
 * @typedef {{ id: string, name: string, initials: string, bg: string, fg: string }} SummaryPerson
 * @typedef {{ date: string | null, title: string, sub: string | null, notes: string[], icon: string,
 *   paidBy: SummaryPerson | null, otherPayers: number, amount: number, currency: string,
 *   shares: Record<string, number>, approx: number }} SummaryCost
 * @typedef {{ key: string, label: string, icon: string, color: string, approx: number,
 *   totals: Money[], costs: SummaryCost[] }} SummaryCategory
 * @typedef {{ currency: string, amount: number, approx: number, share: number,
 *   rate: number | null }} SummaryCurrency  shared costs in one currency; rate is
 *   "1 currency = rate home", null for home itself
 * @typedef {{
 *   trip: { name: string, start: string | null, end: string | null, nights: number | null },
 *   preparedBy: string, generatedOn: string, home: string,
 *   people: Array<{ key: string, name: string, members: SummaryPerson[] }>,
 *   settleUp: Array<{ from: string, to: string, amounts: Money[], approx: number }>,
 *   balances: Array<{ key: string, paid: number, share: number, net: Money[], owed: Money[] }>,
 *   categories: SummaryCategory[],
 *   currencies: SummaryCurrency[],
 *   upfront: Array<{ key: string, approx: number, share: number }>,
 *   payments: Array<{ date: string | null, from: SummaryPerson, to: SummaryPerson, amount: number,
 *     currency: string, paid: Money | null, note: string | null }>,
 *   totals: { approx: number, perPerson: number, costCount: number, paymentCount: number },
 *   notSplit: number,
 *   rates: { live: boolean, date: string | null, basis: 'trip-end' | 'latest', missing: string[],
 *     list: Array<{ currency: string, rate: number | null }> },
 * }} TripSummary
 */

/** Avatar palette as [background, text], matching AssigneePicker's colours. */
export const AVATAR_COLORS = [
  ['#ffe4e6', '#be123c'],
  ['#fef3c7', '#b45309'],
  ['#d1fae5', '#047857'],
  ['#e0f2fe', '#0369a1'],
  ['#ede9fe', '#6d28d9'],
  ['#ccfbf1', '#0f766e'],
  ['#fae8ff', '#a21caf'],
]

const BOOKING_CATEGORIES = {
  flight: { label: 'Flights', color: '#33ab9f' },
  hotel: { label: 'Accommodation', color: '#e37400' },
  cruise: { label: 'Cruises', color: '#7627bb' },
  train: { label: 'Trains', color: '#0d652d' },
  bus: { label: 'Buses', color: '#0d9488' },
  rental: { label: 'Rentals', color: '#3f51b5' },
}
const EXPENSE_COLORS = {
  food: '#b45309',
  groceries: '#188038',
  transport: '#b08900',
  shopping: '#c2185b',
  other: '#5f6368',
}
// Booked tours and pay-at-the-door tickets read as one "Activities" group; each
// row keeps its own icon (🎯 booked, 🎟️ paid on the day) so they're tellable apart.
const ACTIVITIES = { key: 'activities', label: 'Activities', icon: 'activities', color: '#c5221f' }

const ZERO_DECIMAL = ['JPY', 'KRW', 'TWD']
const dust = (currency) => (ZERO_DECIMAL.includes(currency) ? 1 : 0.005)
const round = (value, currency) => {
  const scale = ZERO_DECIMAL.includes(currency) ? 1 : 100
  return Math.round(value * scale) / scale
}
/** Home currency first, then alphabetical — the order every list uses. */
const byCurrency = (a, b) =>
  a.currency === HOME_CURRENCY ? -1 : b.currency === HOME_CURRENCY ? 1 : a.currency.localeCompare(b.currency)
const amounts = (map) =>
  Object.entries(map || {})
    .filter(([c, v]) => Math.abs(v) >= dust(c))
    .map(([currency, amount]) => ({ currency, amount: round(amount, currency) }))
    .sort(byCurrency)

/**
 * The PDF's fonts can't draw emoji (category icons are images), so they come
 * out of free text rather than printing as boxes.
 */
export function plainText(value) {
  return String(value ?? '')
    .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}‍️⃣]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const label = (m) => plainText(m?.name) || (m?.email ? m.email.split('@')[0] : 'Someone')
const initialsOf = (m) => {
  const parts = label(m).split(/\s+/).filter(Boolean)
  return (parts.length >= 2 ? parts[0][0] + parts[1][0] : label(m).slice(0, 2)).toUpperCase()
}

// Dates stored as text ("2026-11-12", or a booking's local "2026-11-12T09:00")
// are already the right day.
const dateOnly = (value) => (value ? String(value).slice(0, 10) : null)
// A moment in time (a payment's created_at, a Date from the database) is the
// day it was in the exporter's time zone.
const dayIn = (value, timeZone) => {
  if (!value) return null
  const when = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(when.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(when)
}
const timeOf = (value) => (value ? new Date(value).getTime() || 0 : 0)
const nightsBetween = (start, end) => {
  if (!start || !end) return null
  const n = Math.round((Date.parse(dateOnly(end)) - Date.parse(dateOnly(start))) / 86400000)
  return n > 0 ? n : null
}
const route = (from, to) => (from && to ? `${from} → ${to}` : from || to || null)

/** The grey second line under a cost's title. */
function costSubtitle(row, kind) {
  if (kind === 'expense') return null
  const d = row.details || {}
  const parts = (() => {
    switch (row.type) {
      case 'flight':
        return [d.flight_number, route(d.departure_airport, d.arrival_airport)]
      case 'hotel': {
        const n = nightsBetween(row.start_date, row.end_date)
        return [n ? `${n} night${n === 1 ? '' : 's'}` : null, row.provider]
      }
      case 'train':
      case 'bus':
        return [route(d.departure_station, d.arrival_station)]
      case 'rental':
        return [d.vehicle_type, route(d.pickup_location, d.dropoff_location)]
      case 'cruise':
        return [d.ship_name, route(d.departure_port, d.arrival_port)]
      case 'activity':
        return [d.location]
      default:
        return []
    }
  })()
  return plainText(parts.filter(Boolean).join(' · ')) || null
}

/** Where a cost sits: its category group and its own row icon. */
function categoryOf(row, kind) {
  if (kind === 'booking') {
    if (row.type === 'activity') return { ...ACTIVITIES, rowIcon: 'activity' }
    const c = BOOKING_CATEGORIES[row.type] ?? { label: 'Other', color: '#5f6368' }
    return { key: row.type, label: c.label, icon: row.type, color: c.color, rowIcon: row.type }
  }
  const cat = expenseCategory(row.category)
  if (cat.value === 'activities') return { ...ACTIVITIES, rowIcon: 'activities' }
  return {
    key: `expense:${cat.value}`,
    label: cat.label,
    icon: cat.value,
    color: EXPENSE_COLORS[cat.value] ?? '#5f6368',
    rowIcon: cat.value,
  }
}

/**
 * @param {object} input
 * @param {{ name: string, start_date?: string, end_date?: string }} input.trip
 * @param {Array} input.members      this trip's member rows (id, name, email, party_id, trip_id)
 * @param {Array} input.parties
 * @param {Array} input.bookings     with `splits`
 * @param {Array} input.expenses     with `splits`
 * @param {Array} input.settlements
 * @param {Record<string, number>} [input.rates]  live "1 ccy = Y HKD" rates
 * @param {string|null} [input.rateDate]
 * @param {'trip-end'|'latest'} [input.rateBasis]  whether those are the rates at
 *   the trip's end or the latest ones
 * @param {string} input.preparedBy
 * @param {string} input.generatedOn  YYYY-MM-DD
 * @param {string} [input.timeZone]   the exporter's IANA zone, for payment dates
 * @returns {TripSummary}
 */
export function buildTripSummary({
  trip,
  members = [],
  parties = [],
  bookings = [],
  expenses = [],
  settlements = [],
  rates = {},
  rateDate = null,
  rateBasis = 'latest',
  preparedBy,
  generatedOn,
  timeZone = 'UTC',
}) {
  const { units, costs, unallocated, missingPayer } = computeBalances({ members, parties, bookings, expenses, settlements })
  const hkd = (amount, currency) => toHKD(amount, currency, rates)
  const hkdOf = (map) => Object.entries(map || {}).reduce((s, [c, v]) => s + hkd(v, c), 0)
  const memberById = new Map(members.map((m) => [m.id, m]))
  const person = (id) => {
    const m = memberById.get(id) ?? { id }
    const [bg, fg] = AVATAR_COLORS[avatarIndex(id, AVATAR_COLORS.length)]
    return { id, name: label(m), initials: initialsOf(m), bg, fg }
  }

  // Units that took part (paid, owed or settled), alphabetical like the chips.
  const people = units
    .filter((u) => Object.keys(u.paid).length || Object.keys(u.owed).length || amounts(u.net).length)
    .map((u) => ({ key: u.key, name: plainText(u.name) || 'Someone', members: u.memberIds.map(person) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const unitByKey = new Map(units.map((u) => [u.key, u]))

  // ---- Costs, grouped by category --------------------------------------
  const rows = costs.map((cost) => {
    const row = cost.ref
    const cat = categoryOf(row, cost.kind)
    const nativeCurrency = cost.kind === 'booking' ? row.cost_currency : row.currency
    const nativeAmount = cost.kind === 'booking' ? bookingEffective(row) : Number(row.amount) || 0
    const notes = []
    if (cost.kind === 'booking' && isCancelled(row)) {
      notes.push(`Cancelled · ${formatCurrency(nativeAmount, nativeCurrency)} kept of ${formatCurrency(bookingOriginal(row), nativeCurrency)}`)
    }
    if (cost.currency !== nativeCurrency) {
      notes.push(`${formatCurrency(nativeAmount, nativeCurrency)} charged in ${cost.currency} at ${Number(row.charged_rate)}`)
    }
    // Several people can fund one cost; the largest is "paid by". By person,
    // not unit: within a couple it's still Sophie who paid.
    const payers = [...cost.payers].sort((a, b) => b[1] - a[1]).map(([id]) => id)
    return {
      date: dateOnly(cost.kind === 'booking' ? row.start_date : row.date),
      title: plainText(row.title) || 'Untitled',
      sub: costSubtitle(row, cost.kind),
      notes,
      icon: cat.rowIcon,
      category: cat,
      paidBy: payers.length ? person(payers[0]) : null,
      otherPayers: Math.max(0, payers.length - 1),
      amount: round(cost.amount, cost.currency),
      currency: cost.currency,
      shares: Object.fromEntries([...cost.shares].map(([key, v]) => [key, round(v, cost.currency)])),
      approx: hkd(cost.amount, cost.currency),
    }
  })
  const groups = new Map()
  for (const r of rows) {
    if (!groups.has(r.category.key)) groups.set(r.category.key, { ...r.category, costs: [] })
    groups.get(r.category.key).costs.push(r)
  }
  const categories = [...groups.values()]
    .map((g) => {
      const totals = {}
      for (const r of g.costs) totals[r.currency] = (totals[r.currency] || 0) + r.amount
      g.costs.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.title.localeCompare(b.title))
      return {
        key: g.key,
        label: g.label,
        icon: g.icon,
        color: g.color,
        approx: g.costs.reduce((s, r) => s + r.approx, 0),
        totals: amounts(totals),
        costs: g.costs.map(({ category, ...r }) => r),
      }
    })
    .sort((a, b) => b.approx - a.approx)
  const total = categories.reduce((s, c) => s + c.approx, 0)
  const travellers = people.reduce((s, p) => s + p.members.length, 0)

  // ---- The same costs by the currency they're split in -------------------
  const rateOf = (currency) =>
    currency === HOME_CURRENCY ? null : rates?.[currency] > 0 ? rates[currency] : FX_RATES_TO_HKD[currency] ?? null
  const byCur = new Map()
  for (const r of rows) {
    const c = byCur.get(r.currency) ?? { currency: r.currency, amount: 0, approx: 0 }
    c.amount += r.amount
    c.approx += r.approx
    byCur.set(r.currency, c)
  }
  const currencies = [...byCur.values()]
    .map((c) => ({
      currency: c.currency,
      amount: round(c.amount, c.currency),
      approx: c.approx,
      share: total > 0 ? c.approx / total : 0,
      rate: rateOf(c.currency),
    }))
    .sort((a, b) => b.approx - a.approx || byCurrency(a, b))

  // ---- Settle up: fewest transfers, one line per pair ------------------
  const pairs = new Map()
  for (const t of suggestTransfers(units)) {
    const key = `${t.fromUnit.key}>${t.toUnit.key}`
    if (!pairs.has(key)) pairs.set(key, { from: t.fromUnit.key, to: t.toUnit.key, amounts: [], approx: 0 })
    const p = pairs.get(key)
    p.amounts.push({ currency: t.currency, amount: round(t.amount, t.currency) })
    p.approx += hkd(t.amount, t.currency)
  }
  const settleUp = [...pairs.values()]
    .map((p) => ({ ...p, amounts: p.amounts.sort(byCurrency) }))
    .sort((a, b) => b.approx - a.approx)

  const balances = people.map((p) => {
    const u = unitByKey.get(p.key)
    return { key: p.key, paid: hkdOf(u.paid), share: hkdOf(u.owed), net: amounts(u.net), owed: amounts(u.owed) }
  })

  const payments = [...settlements]
    .sort((a, b) => timeOf(a.created_at) - timeOf(b.created_at))
    .map((s) => ({
      date: dayIn(s.created_at, timeZone),
      from: person(s.from_user),
      to: person(s.to_user),
      amount: round(Number(s.amount) || 0, s.currency),
      currency: s.currency,
      paid: s.paid_currency && s.paid_amount != null
        ? { currency: s.paid_currency, amount: round(Number(s.paid_amount), s.paid_currency) }
        : null,
      note: plainText(s.note) || null,
    }))

  const notSplit = [...unallocated, ...missingPayer]
  const used = new Set()
  for (const r of rows) used.add(r.currency)
  for (const s of settlements) used.add(s.currency)
  used.delete(HOME_CURRENCY)
  // Currencies with no daily rate fall back to the built-in table.
  const missing = [...used].filter((c) => !(rates?.[c] > 0)).sort()
  const live = missing.length === 0

  return {
    trip: {
      name: plainText(trip.name) || 'Trip',
      start: dateOnly(trip.start_date),
      end: dateOnly(trip.end_date),
      nights: nightsBetween(trip.start_date, trip.end_date),
    },
    preparedBy: plainText(preparedBy) || 'Itinerary',
    generatedOn,
    home: HOME_CURRENCY,
    people,
    settleUp,
    balances,
    categories,
    currencies,
    upfront: people.map((p) => {
      const paid = hkdOf(unitByKey.get(p.key).paid)
      return { key: p.key, approx: paid, share: total > 0 ? paid / total : 0 }
    }),
    payments,
    totals: {
      approx: total,
      perPerson: travellers ? total / travellers : 0,
      costCount: rows.length,
      paymentCount: settlements.length,
    },
    notSplit: notSplit.length,
    rates: {
      live,
      // The daily rates' date, when any of them were used.
      date: used.size > missing.length ? rateDate : null,
      basis: rateBasis === 'trip-end' ? 'trip-end' : 'latest',
      missing,
      list: [...used].sort().map((c) => ({ currency: c, rate: rateOf(c) })),
    },
  }
}
