"use client";

import { useState } from 'react'
import { useTripContext } from '../lib/trip-context'
import { updateBooking, deleteBooking } from '@/lib/client-actions'
import { toHKD, formatCurrency } from '../lib/currencies'
import { TYPE_ICONS } from '../lib/calendar'
import FilterChip from '../components/FilterChip'
import BookingModal from '../components/BookingModal'
import { memberFirstName } from '../components/AssigneePicker'

const EXPENSE_ICON = '🧾'

export default function Costs({ bookings: allBookings, expenses: allExpenses, currentUserId }) {
  const { tripMeta, selectedTrip, selectedTrips, trips, fx } = useTripContext()
  const rates = fx?.rates
  const [scope, setScope] = useState('everyone') // 'everyone' | 'me' | 'us'
  const [modalOpen, setModalOpen] = useState(false)
  const [editingBooking, setEditingBooking] = useState(null)
  // 'all' | <tripId>. Only offered on the All Trips view — with a sidebar
  // selection the list is already scoped by it, so chips would be dead.
  const [tripFilter, setTripFilter] = useState('all')
  const showTripChips = selectedTrips.length === 0 && trips.length > 1

  // Props carry the union of every trip; filter by the client-side selection.
  const selSet = new Set(selectedTrips)
  const inSel = (tripId) => selectedTrips.length === 0 || selSet.has(tripId)
  const bookings = (allBookings || []).filter((b) => inSel(b.trip_id))
  const expenses = (allExpenses || []).filter((e) => inSel(e.trip_id))

  const tripById = new Map((trips || []).map((t) => [t.id, t]))

  // Unify cost-bearing bookings + ad-hoc expenses into one item shape. Effective
  // cost = amount × share for bookings (share is 1 for expenses).
  const items = [
    ...bookings
      .filter((b) => b.cost_amount && b.cost_currency)
      .map((b) => ({
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
        booking: b,
      })),
    ...expenses.map((e) => ({
      id: `ex-${e.id}`,
      kind: 'expense',
      type: 'expense',
      title: e.title,
      subtitle: e.date || 'Expense',
      trip_id: e.trip_id,
      currency: e.currency,
      cost_share: 1,
      effective: e.amount || 0,
      splits: Array.isArray(e.splits) ? e.splits : [],
    })),
  ]

  // Trip chips sub-filter the sidebar selection (the same compose pattern as the
  // per-type booking lists). Cost math below runs on the chip-filtered set.
  const filteredItems = tripFilter === 'all' ? items : items.filter((it) => it.trip_id === tripFilter)

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

  // The set of user ids that count toward the viewer's scope for a given item.
  const scopeUsersFor = (item) => {
    if (scope === 'me') return new Set([currentUserId])
    // 'us' — the viewer's party in THAT item's trip (correct even if the partner
    // set differs between trips). Falls back to just the viewer when unpartied.
    const trip = tripById.get(item.trip_id)
    const row = (trip?.members || []).find((m) => m.id === currentUserId)
    if (!row?.party_id) return new Set([currentUserId])
    return new Set((trip.members || []).filter((m) => m.party_id === row.party_id).map((m) => m.id))
  }

  // Per-item contribution in its own currency. `null` = excluded from Me/Us
  // (an item with no splits contributes nothing there).
  const contribution = (item) => {
    if (scope === 'everyone') return item.effective
    if (item.splits.length === 0) return null
    // Same extras-off-the-top formula as split.js: scope share =
    //   Σ_{scope} extra + (Σ_{scope} weight / Σweight) × (effective − Σextras)
    const sumW = item.splits.reduce((s, r) => s + (Number(r.weight) || 0), 0)
    const sumExtras = item.splits.reduce((s, r) => s + (Number(r.extra_amount) || 0), 0)
    if (sumExtras > item.effective + 0.01) return null // extras exceed the cost
    const remainder = item.effective - sumExtras
    if (remainder > 0.01 && sumW <= 0) return null // nothing to divide by
    const users = scopeUsersFor(item)
    const scopeExtras = item.splits.reduce((s, r) => s + (users.has(r.user_id) ? Number(r.extra_amount) || 0 : 0), 0)
    const scopeW = item.splits.reduce((s, r) => s + (users.has(r.user_id) ? Number(r.weight) || 0 : 0), 0)
    return scopeExtras + (sumW > 0 ? (scopeW / sumW) * remainder : 0)
  }

  // Items with a cost but no split rows: excluded from Me/Us, surfaced as a note.
  const unsplitCount = scope === 'everyone' ? 0 : filteredItems.filter((it) => it.splits.length === 0).length

  const scoped = filteredItems
    .map((it) => ({ it, amount: contribution(it) }))
    .filter((s) => s.amount != null && (scope === 'everyone' || s.amount > 0))

  const totalHKD = scoped.reduce((sum, s) => sum + toHKD(s.amount, s.it.currency, rates), 0)

  // Breakdown by currency.
  const byCurrency = {}
  scoped.forEach((s) => {
    byCurrency[s.it.currency] = (byCurrency[s.it.currency] || 0) + s.amount
  })
  const currencyBreakdown = Object.entries(byCurrency).sort(
    (a, b) => toHKD(b[1], b[0], rates) - toHKD(a[1], a[0], rates),
  )

  // By type (bookings by type + a single "Expenses" category), in HKD.
  const byType = {}
  scoped.forEach((s) => {
    byType[s.it.type] = (byType[s.it.type] || 0) + toHKD(s.amount, s.it.currency, rates)
  })
  const typeBreakdown = Object.entries(byType).sort((a, b) => b[1] - a[1])
  const typeLabel = (type) => (type === 'expense' ? 'Expenses' : `${type}s`)
  const typeIcon = (type) => (type === 'expense' ? EXPENSE_ICON : TYPE_ICONS[type] || '📌')

  const sorted = [...scoped].sort(
    (a, b) => toHKD(b.amount, b.it.currency, rates) - toHKD(a.amount, a.it.currency, rates),
  )

  const headerLabel =
    scope === 'everyone' ? 'Trip total' : scope === 'me' ? 'Your share' : `${usParty?.name || 'Our'}'s share`

  const openEditModal = (booking) => {
    setEditingBooking(booking)
    setModalOpen(true)
  }

  return (
    <div className="h-full flex flex-col w-full max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-medium text-on-surface">Costs</h2>
        {tripMeta && (
          <span className="text-xs font-medium bg-primary-light text-primary px-3 py-1 rounded-full">
            {tripMeta.name}
          </span>
        )}
      </div>

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
        <div className="flex-1 min-h-0 overflow-y-auto grid gap-4 lg:grid-cols-2 auto-rows-min content-start">
          {/* Total */}
          <div className="mat-surface p-6 lg:col-span-2">
            <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1">
              {headerLabel} (approx. HKD)
            </div>
            <div className="text-3xl font-medium text-on-surface">
              ~HK${totalHKD.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            {/* Currency breakdown */}
            <div className="mt-4 flex flex-wrap gap-2">
              {currencyBreakdown.map(([currency, amount]) => (
                <div key={currency} className="text-sm text-on-surface-variant bg-surface-container px-3 py-1.5 rounded-full font-medium">
                  {formatCurrency(amount, currency)}
                </div>
              ))}
            </div>
            {unsplitCount > 0 && (
              <p className="text-[11px] text-on-surface-variant/70 mt-3">
                {unsplitCount} cost{unsplitCount === 1 ? '' : 's'} not split yet — shown under Everyone only.
              </p>
            )}
          </div>

          {/* By type summary */}
          <div className="mat-surface p-6">
            <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-4">By Type</div>
            <div className="space-y-3">
              {typeBreakdown.map(([type, hkdAmount]) => {
                const pct = totalHKD > 0 ? (hkdAmount / totalHKD) * 100 : 0
                return (
                  <div key={type} className="flex items-center gap-3">
                    <span className="text-base w-7">{typeIcon(type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between text-sm">
                        <span className="capitalize text-on-surface font-medium truncate">{typeLabel(type)}</span>
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
          <div className="mat-surface p-6">
            <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-4">All Costs (by amount)</div>
            <div className="space-y-1">
              {sorted.map(({ it, amount }) => {
                const clickable = it.kind === 'booking' && it.booking
                return (
                <div
                  key={it.id}
                  onClick={clickable ? () => openEditModal(it.booking) : undefined}
                  className={`flex items-center justify-between py-3 border-b border-outline/20 last:border-0 ${
                    clickable ? 'cursor-pointer hover:bg-surface-container/50 -mx-2 px-2 rounded-lg transition-colors' : ''
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-base">{typeIcon(it.type)}</span>
                    <div className="min-w-0">
                      <div className="text-sm text-on-surface font-medium truncate">{it.title}</div>
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
                    {it.currency !== 'HKD' && (
                      <div className="text-[11px] text-on-surface-variant">
                        ~HK${toHKD(amount, it.currency, rates).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
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
    </div>
  )
}
