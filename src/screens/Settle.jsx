"use client";

import { useEffect, useMemo, useState } from 'react'
import { useTripContext } from '../lib/trip-context'
import { computeBalances, suggestTransfers, itemViewerNet } from '../lib/split'
// toHKD is for the Split-costs SORT ORDER only — every displayed amount on this
// page stays exact per-currency (no ~ conversions).
import { formatCurrency, FX_RATES_TO_HKD, toHKD } from '../lib/currencies'
import { TYPE_ICONS } from '../lib/calendar'
import { expenseCategory } from '../lib/expense-categories'
import { Avatar, memberLabel, memberFirstName } from '../components/AssigneePicker'
import BookingModal from '../components/BookingModal'
import ExpenseModal from '../components/ExpenseModal'
import PaymentModal from '../components/PaymentModal'
import { useToast } from '../components/Toast'
import { useConfirmDanger } from '../components/ConfirmDanger'
import { friendlyError } from '../lib/friendlyError'
import { isTripWritable, writableTripsInSelection } from '../lib/trip-permissions'
import {
  updateExpense,
  deleteSettlement,
  updateBooking, deleteBooking,
} from '../lib/client-actions'

// Same zero-decimal set the settle math special-cases; used here only to hide
// dust (a net a fraction of a unit away from zero reads as "settled up").
const ZERO_DECIMAL = ['JPY', 'KRW', 'TWD']
const epsFor = (c) => (ZERO_DECIMAL.includes(c) ? 1 : 0.01)

/** Non-dust net entries for a unit, as [currency, amount]. */
function netEntries(net) {
  return Object.entries(net || {}).filter(([c, a]) => Math.abs(a) >= epsFor(c))
}

export default function Settle({
  members: allMembers,
  parties: allParties,
  bookings: allBookings,
  expenses: allExpenses,
  settlements: allSettlements,
  currentUserId,
}) {
  const { selectedTrips, selectedTrip, tripMeta, trips, fx } = useTripContext()
  const rates = fx?.rates
  const { toast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirmDanger()
  const [busy, setBusy] = useState(false)
  // Booking modal for "Needs attention" rows — same local wiring as Costs.jsx.
  const [bookingModalOpen, setBookingModalOpen] = useState(false)
  const [editingBooking, setEditingBooking] = useState(null)
  const [editingExpense, setEditingExpense] = useState(null)
  const [paymentInitialValues, setPaymentInitialValues] = useState(null)
  const [paymentModalKey, setPaymentModalKey] = useState(0)
  const openBooking = (booking) => {
    setEditingBooking(booking)
    setBookingModalOpen(true)
  }

  // Props carry the union of every accessible trip; filter to the selection
  // (empty selection = all trips) and recompute balances client-side.
  const selSet = new Set(selectedTrips)
  const inSel = (tripId) => selectedTrips.length === 0 || selSet.has(tripId)
  const writableTrips = trips.filter(isTripWritable)
  const writableSelectedTrips = writableTripsInSelection(trips, selectedTrips)
  const writableTripIds = new Set(writableTrips.map((trip) => trip.id))
  const selectedWritableTrip = selectedTrip && writableTripIds.has(selectedTrip) ? selectedTrip : ''
  const openAttentionItem = (item) => {
    if (!writableTripIds.has(item.trip_id)) return
    if (item.type) openBooking(item)
    else setEditingExpense(item)
  }
  const openPayment = (initialValues) => {
    setPaymentModalKey((key) => key + 1)
    setPaymentInitialValues(initialValues)
  }

  const members = (allMembers || []).filter((m) => inSel(m.trip_id))
  const parties = (allParties || []).filter((p) => inSel(p.trip_id))
  const bookings = (allBookings || []).filter((b) => inSel(b.trip_id))
  const expenses = (allExpenses || []).filter((e) => inSel(e.trip_id))
  const settlements = (allSettlements || []).filter((s) => inSel(s.trip_id))

  // Name/avatar lookup across the filtered roster (a user may appear once per
  // trip; first row wins).
  const memberByUserId = useMemo(() => {
    const map = new Map()
    for (const m of members) if (m.id && !map.has(m.id)) map.set(m.id, m)
    return map
  }, [members])
  const personLabel = (id) => memberLabel(memberByUserId.get(id) ?? { id })

  const { units, unallocated, missingPayer, pairTransfers } = useMemo(
    () => computeBalances({ members, parties, bookings, expenses, settlements }),
    [members, parties, bookings, expenses, settlements],
  )
  const simplified = useMemo(() => suggestTransfers(units), [units])


  // "Simplify settlements" — ON: min-cash-flow across the group (fewest
  // transfers); OFF: direct pairwise debts. Remembered per trip selection on
  // this device, mirroring the sibling splitter app.
  const [simplify, setSimplify] = useState(true)
  const simplifyKey = `simplify-settlements-${selectedTrip ?? 'all'}`
  useEffect(() => {
    const saved = window.localStorage.getItem(simplifyKey)
    setSimplify(saved === null ? true : saved === 'true')
  }, [simplifyKey])
  const toggleSimplify = () => {
    setSimplify((v) => {
      window.localStorage.setItem(simplifyKey, String(!v))
      return !v
    })
  }
  const transfers = simplify ? simplified : pairTransfers

  // ---- Hero: the viewer's own position -------------------------------------
  // A user can now belong to MULTIPLE units (partied in one trip, solo in
  // another), so aggregate the viewer's net across every unit that contains them.
  const heroNet = {}
  for (const u of units) {
    if (!u.memberIds.includes(currentUserId)) continue
    for (const [cur, amt] of Object.entries(u.net || {})) heroNet[cur] = (heroNet[cur] || 0) + amt
  }
  const heroNets = netEntries(heroNet)
  const heroLabel = heroNets.every(([, a]) => a > 0)
    ? "You're owed"
    : heroNets.every(([, a]) => a < 0)
      ? 'You owe'
      : 'Your balance'
  // Headline figure: the whole position rolled into ~HKD, with the exact
  // per-currency amounts underneath. A pure-HKD balance is already exact, so it
  // drops the tilde and the (identical) breakdown line.
  const heroTotalHKD = heroNets.reduce(
    (s, [cur, amt]) => s + (cur === 'HKD' ? amt : toHKD(amt, cur, rates)),
    0,
  )
  const heroHkdOnly = heroNets.length === 1 && heroNets[0][0] === 'HKD'

  // Transfers grouped by currency, order of first appearance.
  const transferGroups = []
  {
    const idx = new Map()
    for (const t of transfers) {
      if (!idx.has(t.currency)) {
        idx.set(t.currency, transferGroups.length)
        transferGroups.push({ currency: t.currency, list: [] })
      }
      transferGroups[idx.get(t.currency)].list.push(t)
    }
  }

  // Split-costs segmented filter: on the row's viewer net in its DISPLAY
  // currency, dust-aware. "all" keeps even/null rows too.
  const [splitFilter, setSplitFilter] = useState('all')

  // The viewer's settlement unit in a given trip: them plus anyone sharing
  // their party there. Feeds the per-item "+/− for you" pills.
  const viewerUnitIds = (tripId) => {
    const rows = members.filter((m) => m.trip_id === tripId)
    const me = rows.find((m) => m.id === currentUserId)
    if (!me?.party_id) return [currentUserId]
    return rows.filter((m) => m.party_id === me.party_id).map((m) => m.id)
  }
  // Split costs cover BOTH cost-bearing bookings and ad-hoc expenses (the same
  // pair computeBalances settles), so these accessors take either shape: a
  // booking carries cost_amount/cost_share/cost_currency/type, an expense just
  // amount + currency.
  const effectiveOf = (row) =>
    row.cost_amount != null
      ? (row.cost_amount || 0) * (row.cost_share != null ? row.cost_share : 1)
      : row.amount || 0
  const currencyOf = (row) => row.cost_currency ?? row.currency
  const iconOf = (row) => (row.type ? TYPE_ICONS[row.type] || '🗂️' : expenseCategory(row.category).icon)
  const rowKey = (row) => `${row.type ? 'bk' : 'ex'}-${row.id}`
  const openSplitItem = (row) => {
    if (row.type) return openBooking(row)
    // Opens for read-only trips too — the modal shows the details and simply
    // offers no pencil there, the same as a booking.
    setEditingExpense(row)
  }

  // How many WAYS an item is split — settlement units, not people: a couple in
  // the split counts once (4 people in 2 couples = ÷2).
  const unitCountOf = (b) => {
    const rows = members.filter((m) => m.trip_id === b.trip_id)
    const partyOf = new Map(rows.map((m) => [m.id, m.party_id]))
    const keys = new Set()
    for (const s of b.splits || []) keys.add(partyOf.get(s.user_id) || `solo-${s.user_id}`)
    return keys.size
  }

  // An item's charged currency + rate (booking or expense), or null. When set,
  // the whole settlement contribution re-denominates at this exact rate.
  const chargedOf = (row) =>
    Number(row.charged_rate) > 0 && row.charged_currency
      ? { rate: Number(row.charged_rate), currency: row.charged_currency }
      : null
  // The viewer net (computed native) shown in the item's settle currency: the
  // charged currency when set, else native.
  const displayNet = (net, row) => {
    const ch = chargedOf(row)
    if (ch) return { net: net == null ? null : net * ch.rate, currency: ch.currency }
    return { net, currency: row.cost_currency ?? row.currency }
  }
  // The HKD magnitude of a net for the split-costs sort/column: a charged-in-HKD
  // item is EXACT (used directly); others convert the charged/native value with
  // live rates.
  const netHkdOf = (net, row) => {
    if (net == null) return null
    const d = displayNet(net, row)
    return d.currency === 'HKD' ? d.net : toHKD(d.net, d.currency, rates)
  }
  // Per-item breakdown: every fully split cost-bearing item in the selection —
  // bookings AND expenses — with the viewer's unit-level net for it.
  const splitCostRows = [
    ...bookings.filter((b) => b.cost_amount && b.cost_currency),
    ...expenses.filter((e) => e.amount && e.currency),
  ]
    .filter((b) => (b.splits || []).length > 0 && b.paid_by)
    .map((b) => ({
      b,
      net: itemViewerNet({
        amount: effectiveOf(b),
        paidBy: b.paid_by,
        splits: b.splits,
        unitMemberIds: viewerUnitIds(b.trip_id),
      }),
    }))

  const matchesSplitFilter = ({ b, net }) => {
    if (splitFilter === 'all') return true
    const d = displayNet(net, b)
    if (d.net == null) return false
    const eps = epsFor(d.currency)
    return splitFilter === 'owed' ? d.net >= eps : d.net <= -eps
  }
  // One filtered + sorted array feeds BOTH renderings (the existing |HKD|-desc
  // order the table always had).
  const sortedSplitRows = splitCostRows.filter(matchesSplitFilter).sort((a, b) => {
    const key = (r) => netHkdOf(r.net, r.b) ?? 0
    return key(b) - key(a)
  })
  // Mobile grouping: by DISPLAY currency, keeping the sorted order within each
  // group; the group sum is the viewer's net over its rows.
  const splitGroups = []
  {
    const idx = new Map()
    for (const row of sortedSplitRows) {
      const d = displayNet(row.net, row.b)
      if (!idx.has(d.currency)) {
        idx.set(d.currency, splitGroups.length)
        splitGroups.push({ currency: d.currency, rows: [], sum: 0 })
      }
      const g = splitGroups[idx.get(d.currency)]
      g.rows.push(row)
      if (d.net != null) g.sum += d.net
    }
  }

  // ---- Stats: Everyone-scope trip spend, mirroring Costs.jsx's hkdOf ---------
  // (charged-in-HKD items contribute their EXACT charged value; everything else
  // converts via live rates — approximations, hence the ~ prefix.)
  const statHkdOf = (effective, currency, charged) => {
    if (charged) {
      const v = effective * charged.rate
      return charged.currency === 'HKD' ? v : toHKD(v, charged.currency, rates)
    }
    return toHKD(effective, currency, rates)
  }
  const statItems = [
    ...bookings
      .filter((b) => b.cost_amount && b.cost_currency)
      .map((b) => statHkdOf(effectiveOf(b), b.cost_currency, chargedOf(b))),
    ...expenses.map((e) => statHkdOf(e.amount || 0, e.currency, chargedOf(e))),
  ]
  const totalSpendHKD = statItems.reduce((s, v) => s + v, 0)
  const perPersonHKD = memberByUserId.size > 0 ? totalSpendHKD / memberByUserId.size : 0
  const wholeHKD = (v) => `HK$${Math.round(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

  // Only surface units that actually took part (paid, owed, or settled).
  const activeUnits = units
    .filter((u) => netEntries(u.net).length || Object.keys(u.paid).length || Object.keys(u.owed).length)
    .sort((a, b) => {
      const am = a.memberIds.includes(currentUserId) ? 0 : 1
      const bm = b.memberIds.includes(currentUserId) ? 0 : 1
      return am - bm || a.name.localeCompare(b.name)
    })

  const markPaid = (t) => {
    openPayment({
      trip_id: selectedWritableTrip,
      from_user: t.fromUnit.memberIds[0] ?? null,
      to_user: t.toUnit.memberIds[0] ?? null,
      amount: String(ZERO_DECIMAL.includes(t.currency) ? Math.round(t.amount) : Math.round(t.amount * 100) / 100),
      currency: t.currency,
    })
  }

  const run = async (fn, success) => {
    setBusy(true)
    try {
      await fn()
      if (success) toast.success(success)
      return true
    } catch (err) {
      toast.error(friendlyError(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  // Even-split quick help for "Needs attention" (not-split-yet) items: give every
  // member of the item's trip an equal (weight 1) share, keeping any recorded
  // payer or defaulting it to the current user. A couple nets to zero at
  // settlement regardless of who's marked as payer, so this "just works" for a
  // solo/couple trip; on a multi-person trip, fix the payer if it's wrong.
  const evenSplitPayload = (item) => {
    const roster = members.filter((m) => m.trip_id === item.trip_id)
    if (roster.length === 0) return null
    return {
      splits: roster.map((m) => ({
        user_id: m.id,
        weight: 1,
        extra_amount: 0,
        paid_amount: 0,
      })),
      paid_by: item.paid_by ?? currentUserId,
    }
  }
  const saveEvenSplit = (item) => {
    const payload = evenSplitPayload(item)
    if (!payload) return Promise.resolve()
    return item.type ? updateBooking(item.id, payload) : updateExpense(item.id, payload)
  }
  const splitItemEvenly = (item) => run(() => saveEvenSplit(item), 'Split evenly')
  const writableUnallocated = unallocated.filter((item) => writableTripIds.has(item.trip_id))
  const splitAllEvenly = () => {
    const targets = writableUnallocated.filter((it) => members.some((m) => m.trip_id === it.trip_id))
    if (targets.length === 0) return
    return run(async () => {
      for (const it of targets) await saveEvenSplit(it)
    }, `Split ${targets.length} item${targets.length === 1 ? '' : 's'} evenly`)
  }

  return (
    <div className="w-full max-w-3xl lg:max-w-5xl mx-auto">
      {confirmDialog}
      <div className="space-y-4 pb-10">
        {/* 1 — Hero: your position. */}
        <section className="rounded-2xl bg-gradient-to-br from-primary to-primary-dark text-white p-6">
          {heroNets.length === 0 ? (
            <>
              <p className="text-sm font-medium text-white/75">All settled</p>
              <p className="text-2xl font-bold tracking-tight mt-1">🎉 Nothing outstanding</p>
              {transfers.length > 0 && (
                <p className="text-sm text-white/75 mt-2">
                  {transfers.length} transfer{transfers.length === 1 ? '' : 's'} pending between others
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-white/75">{heroLabel}</p>
              <p className="text-3xl font-bold tracking-tight mt-1">
                {heroHkdOnly ? '' : '~'}
                {heroTotalHKD >= 0 ? '+' : '−'}
                {wholeHKD(Math.abs(heroTotalHKD))}
              </p>
              {!heroHkdOnly && (
                <div className="mt-1 space-y-0.5 text-white/85">
                  {heroNets.map(([cur, amt]) => (
                    <p key={cur} className="text-lg font-semibold tracking-tight">
                      {amt > 0 ? '+' : '−'}{formatCurrency(Math.abs(amt), cur)}
                    </p>
                  ))}
                </div>
              )}
              <p className="text-sm text-white/75 mt-2">
                settles in {transfers.length} transfer{transfers.length === 1 ? '' : 's'}
              </p>
            </>
          )}
          {statItems.length > 0 && (
            <div className="mt-4 pt-3 border-t border-white/15 space-y-0.5 text-[12.5px]">
              <p className="flex items-baseline justify-between text-white/65">
                <span>Total trip spend</span>
                <span className="font-semibold text-white/90">~{wholeHKD(totalSpendHKD)}</span>
              </p>
              <p className="flex items-baseline justify-between text-white/65">
                <span>Per person average</span>
                <span className="font-semibold text-white/90">~{wholeHKD(perPersonHKD)}</span>
              </p>
            </div>
          )}
        </section>

        {/* Needs attention — items excluded from every balance above until fixed.
            Sits directly under the hero, styled as a warning so it can't be missed. */}
        {(unallocated.length > 0 || missingPayer.length > 0) && (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.59 3z" />
                </svg>
                <h2 className="text-sm font-semibold text-amber-800 m-0">Needs attention</h2>
              </div>
              {writableUnallocated.length > 0 && (
                <button
                  type="button"
                  onClick={splitAllEvenly}
                  disabled={busy}
                  className="text-xs font-medium text-amber-800 border border-amber-400 rounded-full px-2.5 py-1 hover:bg-amber-100 disabled:opacity-40 shrink-0 transition-colors"
                >
                  Split all evenly
                </button>
              )}
            </div>
            <p className="text-xs text-amber-700 mb-3">
              {unallocated.length + missingPayer.length} item
              {unallocated.length + missingPayer.length === 1 ? '' : 's'} left out of the balances
              above until fixed.
            </p>
            <div className="space-y-1.5">
              {unallocated.map((ref, i) => (
                <NeedsAttentionRow
                  key={`u-${i}`}
                  item={ref}
                  reason="Not split yet"
                  onOpen={writableTripIds.has(ref.trip_id) ? openAttentionItem : undefined}
                  onSplitEven={writableTripIds.has(ref.trip_id) ? () => splitItemEvenly(ref) : undefined}
                  busy={busy}
                />
              ))}
              {missingPayer.map((ref, i) => (
                <NeedsAttentionRow
                  key={`p-${i}`}
                  item={ref}
                  reason="No payer set"
                  onOpen={writableTripIds.has(ref.trip_id) ? openAttentionItem : undefined}
                />
              ))}
            </div>
          </section>
        )}

        {/* Simplify toggle — mirrors the sibling splitter app. */}
        {(simplified.length > 0 || pairTransfers.length > 0) && (
          <div className="flex items-center justify-between gap-3 px-1">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <svg
                  className={`w-4 h-4 shrink-0 ${simplify ? 'text-primary' : 'text-on-surface-variant/50'}`}
                  fill="currentColor" viewBox="0 0 24 24"
                >
                  <path d="M13 2L4.09 12.11a.6.6 0 00.45 1h5.27l-1.72 8.13a.3.3 0 00.53.25L19.9 11.9a.6.6 0 00-.45-1h-5.27l1.35-8.65A.3.3 0 0015 2z" />
                </svg>
                <span className="text-sm font-semibold text-on-surface">Simplify settlements</span>
              </div>
              <p className="text-[11px] text-on-surface-variant ml-[22px] truncate">
                {simplify ? 'Fewest transfers across the group' : 'Everyone settles their own debts'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={simplify}
              aria-label="Simplify settlements"
              onClick={toggleSimplify}
              className={`w-11 h-6 rounded-full shrink-0 transition-colors relative ${
                simplify ? 'bg-primary' : 'bg-outline/40'
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
                  simplify ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        )}

        {/* 2 — Transfers, grouped by currency, straight under the hero (no
            wrapping card — each transfer is its own card, splitter-style). */}
        {transfers.length > 0 && (
          <div className="space-y-3">
            {transferGroups.map(({ currency, list }) => (
              <div key={currency}>
                <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1.5 px-1">
                  {currency}
                </div>
                <div className="space-y-2">
                  {list.map((t, i) => (
                    <TransferCard
                      key={i}
                      t={t}
                      memberByUserId={memberByUserId}
                      currentUserId={currentUserId}
                      onSettle={selectedWritableTrip ? () => markPaid(t) : undefined}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 3 — Balances */}
        <section className="mat-surface p-5">
          <SectionTitle>Balances</SectionTitle>
          {activeUnits.length === 0 ? (
            <EmptyLine>Nothing to settle yet — add a payer and split to a cost or expense.</EmptyLine>
          ) : (
            <div className="space-y-1">
              {activeUnits.map((u) => (
                <BalanceRow key={u.key} unit={u} memberByUserId={memberByUserId} />
              ))}
            </div>
          )}
        </section>

        {/* 4 — Per-item breakdown: each split booking + what it means for you,
            sorted most-receiving first. All HKD conversions route through
            toHKD — the single point the live-FX work (todo 1) will upgrade. */}
        {splitCostRows.length > 0 && (
          <section className="mat-surface p-5">
            <SectionTitle>Split costs</SectionTitle>

            {/* Segmented filter on the row's viewer net. */}
            <div className="bg-surface-container rounded-full p-1 flex mb-3">
              {[
                ['owed', 'Owed to you'],
                ['owe', 'You owe'],
                ['all', 'All'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSplitFilter(key)}
                  className={`flex-1 text-center text-xs font-semibold rounded-full py-1.5 transition-colors ${
                    splitFilter === key ? 'bg-white shadow-sm text-on-surface' : 'text-on-surface-variant'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {sortedSplitRows.length === 0 && (
              <EmptyLine>Nothing in this view.</EmptyLine>
            )}

            {/* MOBILE — two-line rows grouped by display currency. */}
            <div className="lg:hidden">
              {splitGroups.map(({ currency, rows, sum }) => (
                <div key={currency} className="mb-3 last:mb-0">
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
                      {currency}
                    </span>
                    <span className={`text-xs font-semibold ${sum >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {sum >= 0 ? '+' : '−'}{formatCurrency(Math.abs(sum), currency)}
                    </span>
                  </div>
                  {rows.map(({ b, net }) => {
                    const payer = memberByUserId.get(b.paid_by)
                    const disp = displayNet(net, b)
                    const eps = epsFor(disp.currency)
                    const netHKD = netHkdOf(net, b)
                    return (
                      <div
                        key={rowKey(b)}
                        onClick={() => openSplitItem(b)}
                        className="py-2 border-b border-outline/20 last:border-0 cursor-pointer hover:bg-surface-container/50 -mx-2 px-2 rounded-lg transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-base shrink-0">{iconOf(b)}</span>
                          <span className="text-sm font-medium text-on-surface truncate min-w-0 flex-1">{b.title}</span>
                          <NetPill net={disp.net} currency={disp.currency} />
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-on-surface-variant min-w-0">
                          <Avatar member={payer} size="xs" />
                          <span className="truncate min-w-0 flex-1">
                            {memberFirstName(payer)} paid {formatCurrency(effectiveOf(b), currencyOf(b))}
                            <span className="text-on-surface-variant/70"> · ÷{unitCountOf(b)}</span>
                          </span>
                          {disp.currency !== 'HKD' && netHKD != null && Math.abs(disp.net) >= eps && (
                            <span className="text-[11px] shrink-0">
                              ≈ HK${Math.abs(netHKD).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>

            {/* DESKTOP — the existing table, just filtered. */}
            <div className="hidden lg:block overflow-x-auto -mx-2 px-2">
              <table className="w-full min-w-[540px] text-sm">
                <thead>
                  <tr className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
                    <th className="text-left font-semibold pb-2">Cost</th>
                    <th className="text-center font-semibold pb-2 px-2">Paid by</th>
                    <th className="text-left font-semibold pb-2 px-2">Split by</th>
                    <th className="text-right font-semibold pb-2 px-2 whitespace-nowrap">Net result</th>
                    <th className="text-right font-semibold pb-2 pl-2 whitespace-nowrap">Net result (HKD)</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSplitRows
                    .map(({ b, net }) => {
                      const payer = memberByUserId.get(b.paid_by)
                      const splitters = (b.splits || []).map(
                        (s) => memberByUserId.get(s.user_id) ?? { id: s.user_id },
                      )
                      const disp = displayNet(net, b)
                      const eps = epsFor(disp.currency)
                      const netHKD = netHkdOf(net, b)
                      return (
                        <tr
                          key={rowKey(b)}
                          onClick={() => openSplitItem(b)}
                          className="border-t border-outline/20 cursor-pointer hover:bg-surface-container/50 transition-colors"
                        >
                          <td className="py-2 pr-2">
                            <div className="flex items-center gap-2 min-w-0 max-w-[220px]">
                              <span className="text-base shrink-0">{iconOf(b)}</span>
                              <div className="min-w-0">
                                <div className="text-sm text-on-surface font-medium truncate">{b.title}</div>
                                <div className="text-xs text-on-surface-variant truncate">
                                  paid {formatCurrency(effectiveOf(b), currencyOf(b))}
                                  <span className="text-on-surface-variant/70"> · ÷{unitCountOf(b)}</span>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className="inline-flex" title={`Paid by ${memberLabel(payer)}`}>
                              <Avatar member={payer} size="xs" />
                            </span>
                          </td>
                          <td className="py-2 px-2">
                            <span
                              className="flex -space-x-1.5"
                              title={`Split between ${splitters.map((m) => memberLabel(m)).join(', ')}`}
                            >
                              {splitters.slice(0, 4).map((m) => (
                                <Avatar key={m.id} member={m} size="xs" />
                              ))}
                              {splitters.length > 4 && (
                                <span className="w-5 h-5 rounded-full bg-surface-container text-[9px] flex items-center justify-center text-on-surface-variant border border-white shrink-0">
                                  +{splitters.length - 4}
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-right">
                            <NetPill net={disp.net} currency={disp.currency} />
                          </td>
                          <td className="py-2 pl-2 text-right whitespace-nowrap">
                            {netHKD == null || Math.abs(disp.net) < eps ? (
                              <span className="text-xs text-on-surface-variant">—</span>
                            ) : (
                              <span className={`text-xs font-medium ${netHKD > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                                {netHKD > 0 ? '+' : '−'}
                                HK${Math.abs(netHKD).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
            <RatesDisclosure
              currencies={[...new Set(splitCostRows.map(({ b }) => currencyOf(b)).filter((c) => c && c !== 'HKD'))]}
              fx={fx}
            />
          </section>
        )}

        {/* Payments stay with balances; expense management lives on /expenses. */}
        <section className="mat-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <SectionTitle className="mb-0">Payments</SectionTitle>
            {writableSelectedTrips.length > 0 && (
              <button
                type="button"
                onClick={() => openPayment({ trip_id: selectedWritableTrip })}
                className="mat-btn-outlined text-xs"
              >
                + Record a payment
              </button>
            )}
          </div>

          {settlements.length === 0 ? (
            <EmptyLine>No payments recorded yet.</EmptyLine>
          ) : (
            <div className="space-y-1">
              {settlements.map((s) => (
                <div key={s.id} className="flex items-center gap-2 py-2 border-b border-outline/20 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-on-surface truncate">
                      <span className="font-medium">{personLabel(s.from_user)}</span>
                      <span className="text-on-surface-variant"> → </span>
                      <span className="font-medium">{personLabel(s.to_user)}</span>
                    </div>
                    {s.note && <div className="text-xs text-on-surface-variant truncate">{s.note}</div>}
                  </div>
                  <span className="text-sm font-medium text-on-surface shrink-0">
                    {formatCurrency(Number(s.amount) || 0, s.currency)}
                  </span>
                  {writableTripIds.has(s.trip_id) && (
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await ask({
                          title: 'Delete this payment?',
                          message: `${personLabel(s.from_user)} → ${personLabel(s.to_user)} (${formatCurrency(Number(s.amount) || 0, s.currency)}) will be permanently removed. This cannot be undone.`,
                          confirmLabel: 'Delete',
                        })
                        if (!ok) return
                        run(() => deleteSettlement(s.id), 'Payment deleted')
                      }}
                      disabled={busy}
                      aria-label="Delete payment"
                      className="text-on-surface-variant hover:text-red-500 p-1 rounded-full hover:bg-red-50 transition-colors disabled:opacity-30 shrink-0"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

      </div>

      {bookingModalOpen && (
        <BookingModal
          booking={editingBooking}
          selectedTrip={selectedTrip}
          allBookings={allBookings}
          tripName={tripMeta?.name}
          onClose={() => setBookingModalOpen(false)}
          onSave={async (data, existingId) => {
            const id = existingId ?? editingBooking?.id
            if (id) return await updateBooking(id, data)
          }}
          onDelete={async (id) => {
            await deleteBooking(id)
          }}
        />
      )}
      {editingExpense && (
        <ExpenseModal
          key={editingExpense.id}
          expense={editingExpense}
          selectedTrip={selectedTrip}
          availableTrips={writableTrips}
          onClose={() => setEditingExpense(null)}
        />
      )}
      {paymentInitialValues && (
        <PaymentModal
          key={paymentModalKey}
          initialValues={paymentInitialValues}
          selectedTrip={selectedTrip}
          availableTrips={writableSelectedTrips}
          onClose={() => setPaymentInitialValues(null)}
        />
      )}
    </div>
  )
}

function SectionTitle({ children, className = '' }) {
  return (
    <h3 className={`text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-3 ${className}`}>
      {children}
    </h3>
  )
}

function EmptyLine({ children }) {
  return <p className="text-sm text-on-surface-variant/80 py-2">{children}</p>
}

/**
 * The split-costs footnote + an inline "Rates" disclosure. When every row is
 * HKD (no non-HKD currencies) it renders nothing. Otherwise it names when the
 * rates were last updated (or the built-in fallback) and, on toggle, lists each
 * non-HKD currency's rate to HKD — live (with its ECB publication date and
 * fetch time) or the built-in approximate rate.
 *
 * The headline date is the FETCH date, not `rateDate`: the ECB publishes on
 * business days only, so a Monday-morning refresh legitimately carries Friday's
 * rate_date and "as of <Friday>" reads like the app stopped updating. The
 * publication date still shows in the expanded table.
 */
function RatesDisclosure({ currencies, fx }) {
  const [open, setOpen] = useState(false)
  if (!currencies || currencies.length === 0) return null
  const rates = fx?.rates
  const rateDate = fx?.rateDate ?? null
  const fetchedAt = fx?.fetchedAt ? new Date(fx.fetchedAt) : null
  const fetchedLabel = fetchedAt
    ? fetchedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : null
  const updatedLabel = fetchedAt
    ? fetchedAt.toLocaleDateString(undefined, { dateStyle: 'medium' })
    : rateDate
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[11px] text-on-surface-variant/70 min-w-0 truncate">
          {updatedLabel
            ? `Non-HKD amounts converted at rates updated ${updatedLabel}`
            : 'Non-HKD amounts converted at approximate built-in rates'}
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[11px] text-primary shrink-0"
        >
          {open ? 'Hide' : 'Rates'}
        </button>
      </div>
      {open && (
        <div className="mt-1.5 overflow-x-auto">
          <table className="text-[11px] text-on-surface-variant">
            <thead>
              <tr className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/70">
                <th className="text-left font-semibold pr-4 pb-1">From</th>
                <th className="text-left font-semibold pr-4 pb-1">To</th>
                <th className="text-right font-semibold pr-4 pb-1">Rate</th>
                <th className="text-left font-semibold pr-4 pb-1 whitespace-nowrap">Published</th>
                <th className="text-left font-semibold pb-1 whitespace-nowrap">Last fetched</th>
              </tr>
            </thead>
            <tbody>
              {currencies.map((c) => {
                const live = rates && rates[c] > 0
                const rate = live ? rates[c] : FX_RATES_TO_HKD[c]
                return (
                  <tr key={c}>
                    <td className="pr-4 py-0.5">{c}</td>
                    <td className="pr-4 py-0.5">HKD</td>
                    {/* Up to 4dp, trailing zeros trimmed — ¥ is 0.048, not 0.05. */}
                    <td className="pr-4 py-0.5 text-right tabular-nums">
                      {parseFloat((rate ?? 0).toFixed(4))}
                    </td>
                    {/* ECB publishes business days only, so this trails the
                        fetch date over weekends and holidays. */}
                    <td className="pr-4 py-0.5 whitespace-nowrap">
                      {live ? (rateDate ?? '—') : '—'}
                    </td>
                    <td className="py-0.5 whitespace-nowrap">
                      {live ? (fetchedLabel ?? '—') : 'built-in approximate rate'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * The viewer's take on one item: green "+X" (your unit is owed), red "−X"
 * (your unit owes), a muted "even" when it nets out, nothing when the item
 * doesn't involve you at all or isn't settleable.
 */
function NetPill({ net, currency }) {
  if (net == null) return null
  const eps = epsFor(currency)
  if (Math.abs(net) < eps) {
    return (
      <span className="text-xs text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-full shrink-0">
        even
      </span>
    )
  }
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
        net > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
      }`}
      title={net > 0 ? 'your side is owed' : 'your side owes'}
    >
      {net > 0 ? '+' : '−'}{formatCurrency(Math.abs(net), currency)}
    </span>
  )
}

/**
 * One suggested transfer as an actionable card: avatar stacks + a teal Settle
 * pill (prefills the record-payment form), then a viewer-aware sentence and the
 * exact amount.
 */
function TransferCard({ t, memberByUserId, currentUserId, onSettle }) {
  const viewerIn = (u) => u.memberIds.includes(currentUserId)
  let sentence
  if (viewerIn(t.toUnit)) {
    sentence = `${t.fromUnit.name} ${t.fromUnit.memberIds.length === 1 ? 'pays' : 'pay'} you`
  } else if (viewerIn(t.fromUnit)) {
    sentence = `You pay ${t.toUnit.name}`
  } else {
    sentence = `${t.fromUnit.name} pay ${t.toUnit.name}`
  }
  return (
    <div className="mat-surface p-4">
      <div className="flex items-center gap-2 min-w-0">
        <UnitAvatars unit={t.fromUnit} memberByUserId={memberByUserId} />
        <svg className="w-3.5 h-3.5 text-on-surface-variant shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
        </svg>
        <UnitAvatars unit={t.toUnit} memberByUserId={memberByUserId} />
        <span className="flex-1" />
        {onSettle && (
          <button
            type="button"
            onClick={onSettle}
            className="rounded-full bg-primary/10 text-primary-dark font-semibold text-xs px-4 py-2 inline-flex items-center gap-1.5 shrink-0 hover:bg-primary/20 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            Settle
          </button>
        )}
      </div>
      <div className="mt-2 flex justify-between items-baseline gap-3">
        <span className="text-sm text-on-surface truncate min-w-0">{sentence}</span>
        <span className="text-xl font-bold tracking-tight text-on-surface shrink-0">
          {formatCurrency(t.amount, t.currency)}
        </span>
      </div>
    </div>
  )
}

/** Overlapping avatars for a settlement unit (up to 3). */
function UnitAvatars({ unit, memberByUserId }) {
  const rows = unit.memberIds.map((id) => memberByUserId.get(id) ?? { id })
  return (
    <span className="flex -space-x-1.5 shrink-0">
      {rows.slice(0, 3).map((m) => (
        <Avatar key={m.id} member={m} size="xs" />
      ))}
    </span>
  )
}

function BalanceRow({ unit, memberByUserId }) {
  const [open, setOpen] = useState(false)
  const nets = netEntries(unit.net)
  const settled = nets.length === 0
  const currencies = [...new Set([...Object.keys(unit.paid), ...Object.keys(unit.owed)])]

  return (
    <div className="py-2 border-b border-outline/20 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left"
      >
        <UnitAvatars unit={unit} memberByUserId={memberByUserId} />
        <span className="text-sm text-on-surface font-medium truncate min-w-0 flex-1">{unit.name}</span>
        <span className="flex flex-wrap justify-end gap-1 min-w-0">
          {settled ? (
            <span className="text-xs text-on-surface-variant bg-surface-container px-2 py-0.5 rounded-full">settled up</span>
          ) : (
            nets.map(([cur, amt]) => (
              <span
                key={cur}
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  amt > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                }`}
                title={amt > 0 ? 'is owed' : 'owes'}
              >
                {amt > 0 ? '' : '-'}{formatCurrency(Math.abs(amt), cur)}
              </span>
            ))
          )}
        </span>
        <svg
          className={`w-4 h-4 text-on-surface-variant shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open && (
        <div className="mt-2 pl-8 space-y-1">
          {currencies.length === 0 && (
            <p className="text-[11px] text-on-surface-variant">No costs recorded.</p>
          )}
          {currencies.map((cur) => (
            <div key={cur} className="flex items-center justify-between text-[11px] text-on-surface-variant">
              <span>Paid {formatCurrency(unit.paid[cur] || 0, cur)}</span>
              <span>Share {formatCurrency(unit.owed[cur] || 0, cur)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Actionable items open their matching editor in place. */
function NeedsAttentionRow({ item, reason, onOpen, onSplitEven, busy }) {
  const isBooking = !!item.type
  const title = item.title || 'Untitled'
  const icon = isBooking ? (TYPE_ICONS[item.type] || '🗂️') : expenseCategory(item.category).icon
  const content = (
    <>
      <span className="text-base shrink-0">{icon}</span>
      <span className="text-sm text-on-surface truncate min-w-0 flex-1">{title}</span>
      {!onSplitEven && <span className="text-[11px] text-amber-600 shrink-0">{reason}</span>}
    </>
  )
  return (
    <div className="flex items-center gap-2 py-2 border-b border-outline/20 last:border-0 -mx-2 px-2 rounded-lg">
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="flex flex-1 items-center gap-2 min-w-0 text-left rounded-lg hover:bg-surface-container/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors"
        >
          {content}
        </button>
      ) : (
        <div className="flex flex-1 items-center gap-2 min-w-0">{content}</div>
      )}
      {onSplitEven && (
        <button
          type="button"
          onClick={onSplitEven}
          disabled={busy}
          className="text-[11px] font-medium text-amber-800 border border-amber-400 rounded-full px-2 py-0.5 hover:bg-amber-100 disabled:opacity-40 shrink-0 transition-colors"
        >
          Split evenly
        </button>
      )}
    </div>
  )
}
