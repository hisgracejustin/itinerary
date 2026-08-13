"use client";

import { useState } from 'react'
import { useTripContext } from '../lib/trip-context'
import { updateBooking, deleteBooking } from '@/lib/client-actions'
import { toHKD, formatCurrency } from '../lib/currencies'
import { wallClockInZone } from '../lib/airports'
import { makeZoneResolver } from '../lib/booking-zones'
import { sanitizeCancellationPolicy, nowInstant } from '../lib/cancellation'
import { TYPE_ICONS } from '../lib/calendar'
import { EXPENSE_CATEGORIES } from '../lib/expense-categories'
import {
  bookingCostItem,
  expenseCostItem,
  expenseTypeEntry,
  hkdOf as itemHkd,
  itemContribution,
  scopeUserIds,
} from '../lib/cost-items'
import { isTripWritable } from '../lib/trip-permissions'
import FilterChip from '../components/FilterChip'
import BookingModal from '../components/BookingModal'
import ExpenseModal from '../components/ExpenseModal'
import { memberFirstName } from '../components/AssigneePicker'

// Plural labels for the By Type bars — naive `${type}s` gave "Activitys"/"Buss".
// Wording matches the rest of the app (Sidebar/Header/BookingsByType), with the
// full "Accommodation" like the Header page title since there's room here.
const TYPE_LABELS = {
  flight: 'Flights',
  train: 'Trains',
  bus: 'Buses',
  rental: 'Rentals',
  cruise: 'Cruises',
  hotel: 'Accommodation',
  activity: 'Activities',
}

export default function Costs({ bookings: allBookings, expenses: allExpenses, currentUserId }) {
  const { tripMeta, selectedTrip, selectedTrips, trips, fx } = useTripContext()
  const rates = fx?.rates
  const [scope, setScope] = useState('everyone') // 'everyone' | 'me' | 'us'
  const [modalOpen, setModalOpen] = useState(false)
  const [editingBooking, setEditingBooking] = useState(null)
  const [viewingExpense, setViewingExpense] = useState(null)
  // 'all' | <tripId>. Only offered on the All Trips view — with a sidebar
  // selection the list is already scoped by it, so chips would be dead.
  const [tripFilter, setTripFilter] = useState('all')
  // Expense categories the All Costs list is narrowed to; empty = everything.
  const [categoryFilter, setCategoryFilter] = useState(() => new Set())
  const showTripChips = selectedTrips.length === 0 && trips.length > 1

  // Props carry the union of every trip; filter by the client-side selection.
  const selSet = new Set(selectedTrips)
  const inSel = (tripId) => selectedTrips.length === 0 || selSet.has(tripId)
  const bookings = (allBookings || []).filter((b) => inSel(b.trip_id))
  const expenses = (allExpenses || []).filter((e) => inSel(e.trip_id))

  const tripById = new Map((trips || []).map((t) => [t.id, t]))

  // Whether a booking has already started is a provider-zone question, which is
  // all the clock work this screen still does — the as-of picker moved to
  // /refund along with the cancellation figures.
  const nowMs = nowInstant()
  // Unfiltered on purpose: the flight that placed a booking in a zone is often
  // on a different trip (see chronologicalZone).
  const zoneOf = makeZoneResolver(allBookings || [])

  // Unify cost-bearing bookings + ad-hoc expenses into one item shape. Effective
  // cost = amount × share for bookings (share is 1 for expenses).
  const items = [
    ...bookings.filter((b) => b.cost_amount && b.cost_currency).map(bookingCostItem),
    ...expenses.map(expenseCostItem),
  ]

  const hkdOf = (it, amount) => itemHkd(it, amount, rates)

  // Trip chips sub-filter the sidebar selection (the same compose pattern as the
  // per-type booking lists). Cost math below runs on the chip-filtered set, and
  // the filter is ignored while the chips are hidden — a sidebar selection takes
  // the row away, and a filter nobody can see leaves an all-zero page.
  const activeTripFilter = showTripChips ? tripFilter : 'all'
  const filteredItems =
    activeTripFilter === 'all' ? items : items.filter((it) => it.trip_id === activeTripFilter)

  // Whether the viewer belongs to a party in any relevant (filtered) trip — the
  // "Us" chip only appears then. The label is that party's name.
  const relevantTrips = (trips || []).filter((t) => inSel(t.id))
  let usParty = null
  for (const t of relevantTrips) {
    const row = (t.members || []).find((m) => m.id === currentUserId)
    if (row?.party_id) {
      usParty = (t.parties || []).find((p) => p.id === row.party_id) || null
      if (usParty) break
    }
  }
  const showUs = !!usParty

  const viewerMember = (trips || []).flatMap((t) => t.members || []).find((m) => m.id === currentUserId)
  const meLabel = viewerMember ? memberFirstName(viewerMember) : 'Me'

  const contribution = (item) =>
    itemContribution(item, scopeUserIds({ scope, trip: tripById.get(item.trip_id), currentUserId }))

  // Items with a cost but no split rows: excluded from Me/Us, surfaced as a note
  // (with the total still-to-assign, so the low personal figure reads correctly).
  const unsplitItems = scope === 'everyone' ? [] : filteredItems.filter((it) => it.splits.length === 0)
  const unsplitCount = unsplitItems.length
  const unsplitTotalHKD = unsplitItems.reduce((sum, it) => sum + hkdOf(it, it.effective), 0)

  // Which costs still have a cancellation decision to make: an upcoming booking
  // with nothing recorded. Same set the amber note counts (minus its scope
  // nuances), flagged inline so the culprits are findable.
  const missingPolicy = (it) =>
    it.kind === 'booking' &&
    !sanitizeCancellationPolicy(it.booking.details?.cancellation_policy) &&
    String(it.booking.start_date).slice(0, 16) >= wallClockInZone(nowMs, zoneOf(it.booking))

  const scoped = filteredItems
    .map((it) => ({ it, amount: contribution(it) }))
    .filter((s) => s.amount != null && (scope === 'everyone' || s.amount > 0))

  const totalHKD = scoped.reduce((sum, s) => sum + hkdOf(s.it, s.amount), 0)

  // Breakdown by currency.
  const byCurrency = {}
  scoped.forEach((s) => {
    byCurrency[s.it.currency] = (byCurrency[s.it.currency] || 0) + s.amount
  })
  const currencyBreakdown = Object.entries(byCurrency).sort(
    (a, b) => toHKD(b[1], b[0], rates) - toHKD(a[1], a[0], rates),
  )

  // By type (each booking type, plus one bar per expense category), in HKD.
  const byType = {}
  scoped.forEach((s) => {
    byType[s.it.type] = (byType[s.it.type] || 0) + hkdOf(s.it, s.amount)
  })
  const typeBreakdown = Object.entries(byType).sort((a, b) => b[1] - a[1])
  const typeLabel = (type) => expenseTypeEntry(type)?.label || TYPE_LABELS[type] || type
  const typeIcon = (type) => expenseTypeEntry(type)?.icon || TYPE_ICONS[type] || '📌'

  const sorted = [...scoped].sort(
    (a, b) => hkdOf(b.it, b.amount) - hkdOf(a.it, a.amount),
  )

  // Category chips for the All Costs list. Only categories actually present are
  // offered — a chip that can only ever show an empty list is noise — and
  // picking any of them narrows to expenses, so bookings drop out. They filter
  // that list ALONE: the total, the currency pills and the By Type bars keep
  // answering for the whole scope, which is what the cards above them claim.
  const categoryCounts = new Map()
  sorted.forEach(({ it }) => {
    const entry = expenseTypeEntry(it.type)
    if (entry) categoryCounts.set(entry.value, (categoryCounts.get(entry.value) || 0) + 1)
  })
  const categoryChips = EXPENSE_CATEGORIES.filter((c) => categoryCounts.has(c.value))
  const toggleCategory = (value) =>
    setCategoryFilter((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  // Selections for categories that have since left the list (a trip chip
  // changed, an expense was recategorized) would silently empty it.
  const activeCategories = new Set([...categoryFilter].filter((v) => categoryCounts.has(v)))
  const listed =
    activeCategories.size === 0
      ? sorted
      : sorted.filter(({ it }) => activeCategories.has(expenseTypeEntry(it.type)?.value))

  const headerLabel =
    scope === 'everyone' ? 'Trip total' : scope === 'me' ? 'Your share' : `${usParty?.name || 'Our'}'s share`

  const openEditModal = (booking) => {
    setEditingBooking(booking)
    setModalOpen(true)
  }

  // Both kinds open read-only first, so every row is clickable — including a
  // read-only trip's, where the modal simply offers no pencil.
  const openItem = (it) => {
    if (it.kind === 'booking') openEditModal(it.booking)
    else setViewingExpense(it.expense)
  }
  const writableTrips = (trips || []).filter(isTripWritable)

  return (
    <div className="w-full max-w-5xl lg:max-w-6xl mx-auto">
      {/* Scope toggle */}
      <div className={`flex flex-wrap gap-1.5 ${showTripChips ? 'mb-3' : 'mb-5'}`}>
        <FilterChip active={scope === 'everyone'} onClick={() => setScope('everyone')} label="Everyone" />
        <FilterChip active={scope === 'me'} onClick={() => setScope('me')} label={meLabel} />
        {showUs && (
          <FilterChip active={scope === 'us'} onClick={() => setScope('us')} label={usParty.name} />
        )}
      </div>

      {/* Trip filter — same chip row as the per-type booking lists. */}
      {showTripChips && (
        <div className="flex items-center gap-1.5 mb-5 overflow-x-auto pb-1 shrink-0">
          <FilterChip
            active={tripFilter === 'all'}
            onClick={() => setTripFilter('all')}
            label="All trips"
          />
          {trips.map((trip) => {
            const count = items.filter((it) => it.trip_id === trip.id).length
            return (
              <FilterChip
                key={trip.id}
                active={tripFilter === trip.id}
                onClick={() => setTripFilter(tripFilter === trip.id ? 'all' : trip.id)}
                label={trip.name}
                count={count}
              />
            )
          })}
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
          <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4">
            <span className="text-2xl">💰</span>
          </div>
          <p className="text-sm font-medium">No costs recorded yet</p>
          <p className="text-xs mt-1 text-on-surface-variant/70">Add costs to your bookings to see the breakdown here</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 auto-rows-min content-start pb-10">
          {/* Total */}
          <div className="mat-surface p-6 lg:col-span-2 min-w-0">
            <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1">
              {headerLabel} (approx. HKD)
            </div>
            <div className="text-3xl font-medium text-on-surface">
              ~HK${totalHKD.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            {/* Currency breakdown */}
            <div className="mt-4 flex flex-wrap gap-2">
              {currencyBreakdown.map(([currency, amount]) => (
                <div key={currency} className="text-sm text-accent-ink bg-primary-light px-3 py-1.5 rounded-full font-medium">
                  {formatCurrency(amount, currency)}
                </div>
              ))}
            </div>
            {scope !== 'everyone' && unsplitCount > 0 && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
                <svg className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.59 3z" />
                </svg>
                <p className="text-xs text-amber-700 min-w-0">
                  {unsplitCount} cost{unsplitCount === 1 ? " isn't" : "s aren't"} assigned to anyone yet, so {unsplitCount === 1 ? "it's" : "they're"} not in this figure.{' '}
                  <span className="font-semibold whitespace-nowrap">~HK${unsplitTotalHKD.toLocaleString(undefined, { maximumFractionDigits: 0 })} still to assign.</span>
                </p>
              </div>
            )}
          </div>

          {/* By type summary */}
          <div className="mat-surface p-6 min-w-0">
            <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-4">By Type</div>
            <div className="space-y-3">
              {typeBreakdown.map(([type, hkdAmount]) => {
                const pct = totalHKD > 0 ? (hkdAmount / totalHKD) * 100 : 0
                return (
                  <div key={type} className="flex items-center gap-3">
                    <span className="text-base w-7">{typeIcon(type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between text-sm">
                        {/* Not `capitalize`: every label is already cased the
                            way it should read, and the class would turn "Food
                            & drink" into "Food & Drink". */}
                        <span className="text-on-surface font-medium truncate">{typeLabel(type)}</span>
                        <span className="text-on-surface-variant shrink-0 ml-2">
                          ~HK${hkdAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 bg-surface-container rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500 ease-material"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Individual items */}
          <div className="mat-surface p-6 min-w-0">
            <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-3">All Costs (by amount)</div>
            {categoryChips.length > 0 && (
              <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1">
                <FilterChip
                  active={activeCategories.size === 0}
                  onClick={() => setCategoryFilter(new Set())}
                  label="All"
                />
                {categoryChips.map((category) => (
                  <FilterChip
                    key={category.value}
                    active={activeCategories.has(category.value)}
                    onClick={() => toggleCategory(category.value)}
                    label={`${category.icon} ${category.label}`}
                    count={categoryCounts.get(category.value)}
                  />
                ))}
              </div>
            )}
            <div className="space-y-1">
              {listed.map(({ it, amount }) => {
                const clickable = it.kind === 'booking' ? !!it.booking : !!it.expense
                return (
                <div
                  key={it.id}
                  onClick={clickable ? () => openItem(it) : undefined}
                  className={`flex items-center justify-between py-3 border-b border-outline/20 last:border-0 ${
                    clickable ? 'cursor-pointer hover:bg-surface-container/50 -mx-2 px-2 rounded-lg transition-colors' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-base">{typeIcon(it.type)}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm text-on-surface font-medium truncate">{it.title}</span>
                        {missingPolicy(it) && (
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                            title="No cancellation policy recorded"
                          />
                        )}
                      </div>
                      <div className="text-xs text-on-surface-variant truncate">{it.subtitle}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className="text-sm font-medium text-on-surface">
                      {formatCurrency(amount, it.currency)}
                      {scope === 'everyone' && it.cost_share != null && it.cost_share !== 1 && (
                        <span className="text-[10px] text-on-surface-variant ml-1">(×{parseFloat(it.cost_share.toFixed(2))})</span>
                      )}
                    </div>
                    {it.charged ? (
                      <div className="text-[11px] text-on-surface-variant">
                        @{parseFloat(it.charged.rate.toFixed(4))} → {formatCurrency(amount * it.charged.rate, it.charged.currency)}
                      </div>
                    ) : (
                      it.currency !== 'HKD' && (
                        <div className="text-[11px] text-on-surface-variant">
                          ~HK${toHKD(amount, it.currency, rates).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                      )
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <BookingModal
          booking={editingBooking}
          selectedTrip={selectedTrip}
          allBookings={allBookings}
          tripName={tripMeta?.name}
          onClose={() => setModalOpen(false)}
          onSave={async (data, existingId) => {
            const id = existingId ?? editingBooking?.id
            if (id) return await updateBooking(id, data)
          }}
          onDelete={async (id) => {
            await deleteBooking(id)
          }}
        />
      )}

      {viewingExpense && (
        <ExpenseModal
          key={viewingExpense.id}
          expense={viewingExpense}
          selectedTrip={selectedTrip}
          availableTrips={writableTrips}
          onClose={() => setViewingExpense(null)}
        />
      )}
    </div>
  )
}
