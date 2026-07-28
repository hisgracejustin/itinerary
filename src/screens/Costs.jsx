"use client";

import { useState } from 'react'
import { useTripContext } from '../lib/trip-context'
import { updateBooking, deleteBooking } from '@/lib/client-actions'
import { toHKD, formatCurrency } from '../lib/currencies'
import { sanitizeCancellationPolicy, refundableAsOf, localNow, formatCutoff } from '../lib/cancellation'
import { TYPE_ICONS } from '../lib/calendar'
import FilterChip from '../components/FilterChip'
import BookingModal from '../components/BookingModal'
import { memberFirstName } from '../components/AssigneePicker'

const EXPENSE_ICON = '🧾'

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
  expense: 'Expenses',
}

export default function Costs({ bookings: allBookings, expenses: allExpenses, currentUserId }) {
  const { tripMeta, selectedTrip, selectedTrips, trips, fx } = useTripContext()
  const rates = fx?.rates
  const [scope, setScope] = useState('everyone') // 'everyone' | 'me' | 'us'
  const [modalOpen, setModalOpen] = useState(false)
  const [editingBooking, setEditingBooking] = useState(null)
  // 'all' | <tripId>. Only offered on the All Trips view — with a sidebar
  // selection the list is already scoped by it, so chips would be dead.
  const [tripFilter, setTripFilter] = useState('all')
  // "What comes back if I cancel at this moment" — naive 'YYYY-MM-DDTHH:mm'
  // throughout, so a same-day cancellation deadline resolves to the right side.
  const [asOf, setAsOf] = useState(localNow)
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
        charged: Number(b.charged_rate) > 0 && b.charged_currency ? { rate: Number(b.charged_rate), currency: b.charged_currency } : null,
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
      charged: Number(e.charged_rate) > 0 && e.charged_currency ? { rate: Number(e.charged_rate), currency: e.charged_currency } : null,
    })),
  ]

  // The approximate HKD value of a native `amount` for one item. A charged rate
  // re-denominates it exactly: charged-in-HKD contributes its EXACT charged
  // value (no approx FX); charged-in-other converts the charged value via live
  // rates; otherwise convert the native amount.
  const hkdOf = (it, amount) => {
    if (it.charged) {
      const v = amount * it.charged.rate
      return it.charged.currency === 'HKD' ? v : toHKD(v, it.charged.currency, rates)
    }
    return toHKD(amount, it.currency, rates)
  }

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

  // Items with a cost but no split rows: excluded from Me/Us, surfaced as a note
  // (with the total still-to-assign, so the low personal figure reads correctly).
  const unsplitItems = scope === 'everyone' ? [] : filteredItems.filter((it) => it.splits.length === 0)
  const unsplitCount = unsplitItems.length
  const unsplitTotalHKD = unsplitItems.reduce((sum, it) => sum + hkdOf(it, it.effective), 0)

  // Refund exposure as of `asOf`, FOLLOWING the scope chips: under Me/Us every
  // figure is the viewer's share, so the card answers "how much of MY money
  // comes back". Unsplit items drop out under Me/Us exactly as they do from
  // `scoped` below — the warning above already accounts for them.
  const refundRows = []
  let refundableHKD = 0
  let nonRefundableHKD = 0
  let noPolicyCount = 0
  let noPolicyHKD = 0
  filteredItems.forEach((it) => {
    if (it.kind !== 'booking') return
    // Already underway at the as-of moment — there's nothing left to cancel.
    // start_date is 'YYYY-MM-DDTHH:mm:ss'; slicing to 16 aligns it with asOf.
    if (String(it.booking.start_date).slice(0, 16) < asOf) return
    const base = scope === 'everyone' ? it.effective : contribution(it)
    // Under Me/Us, no share means no stake — mirror `scoped` below, which also
    // drops zero-contribution items rather than listing them at $0.00.
    if (base == null || (scope !== 'everyone' && base <= 0)) return
    const policy = sanitizeCancellationPolicy(it.booking.details?.cancellation_policy)
    const r = refundableAsOf(policy, it.effective, asOf)
    // No policy on file is UNKNOWN, not zero — its own bucket, never summed into
    // the non-refundable figure. A policy of 'non_refundable' is a real zero and
    // falls through to the non-refundable total below.
    if (!r) {
      noPolicyCount += 1
      noPolicyHKD += hkdOf(it, base)
      return
    }
    // The refund is computed on the whole cost (so a flat tier clamps against the
    // real total), then scaled to the viewer's fraction of it: a HK$500 refund on
    // a 50/50 split gives each payer back HK$250.
    const frac = it.effective > 0 ? base / it.effective : 0
    const refundable = r.refundable * frac
    const hkd = hkdOf(it, refundable)
    refundableHKD += hkd
    nonRefundableHKD += hkdOf(it, base - refundable)
    refundRows.push({ it, refundable, tier: r.tier, policy, hkd })
  })
  refundRows.sort((a, b) => b.hkd - a.hkd)
  const hasBookings = filteredItems.some((it) => it.kind === 'booking')

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

  // By type (bookings by type + a single "Expenses" category), in HKD.
  const byType = {}
  scoped.forEach((s) => {
    byType[s.it.type] = (byType[s.it.type] || 0) + hkdOf(s.it, s.amount)
  })
  const typeBreakdown = Object.entries(byType).sort((a, b) => b[1] - a[1])
  const typeLabel = (type) => TYPE_LABELS[type] || type
  const typeIcon = (type) => (type === 'expense' ? EXPENSE_ICON : TYPE_ICONS[type] || '📌')

  const sorted = [...scoped].sort(
    (a, b) => hkdOf(b.it, b.amount) - hkdOf(a.it, a.amount),
  )

  const headerLabel =
    scope === 'everyone' ? 'Trip total' : scope === 'me' ? 'Your share' : `${usParty?.name || 'Our'}'s share`

  const openEditModal = (booking) => {
    setEditingBooking(booking)
    setModalOpen(true)
  }

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

          {/* Refundable if cancelled */}
          {hasBookings && (
            <div className="mat-surface p-6 lg:col-span-2 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
                  Refundable if cancelled
                </div>
                <input
                  type="datetime-local"
                  value={asOf}
                  // Clearing the field would leave every tier looking expired —
                  // fall back to now rather than showing a silent all-zero.
                  onChange={(e) => setAsOf(e.target.value || localNow())}
                  className="mat-input w-52 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div className="min-w-0">
                  <div className="text-2xl font-medium text-emerald-600">
                    ~HK${refundableHKD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-xs text-on-surface-variant mt-0.5">Refundable</div>
                </div>
                <div className="min-w-0">
                  <div className="text-2xl font-medium text-on-surface">
                    ~HK${nonRefundableHKD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-xs text-on-surface-variant mt-0.5">Non-refundable</div>
                </div>
              </div>
              <p className="text-xs text-on-surface-variant/60 mt-3">
                Follows the scope selected above — under {meLabel}
                {showUs ? ` or ${usParty.name}` : ''} these figures are your share of each refund.
                Bookings already underway at this time are left out.
              </p>
              {noPolicyCount > 0 && (
                <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
                  <svg className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.59 3z" />
                  </svg>
                  <p className="text-xs text-amber-700 min-w-0">
                    {noPolicyCount} booking{noPolicyCount === 1 ? '' : 's'}{' '}
                    <span className="font-semibold whitespace-nowrap">
                      (~HK${noPolicyHKD.toLocaleString(undefined, { maximumFractionDigits: 0 })})
                    </span>{' '}
                    {noPolicyCount === 1 ? 'has' : 'have'} no cancellation policy info and{' '}
                    {noPolicyCount === 1 ? "isn't" : "aren't"} counted.
                  </p>
                </div>
              )}
              {refundRows.length > 0 && (
                <div className="mt-4 space-y-1">
                  {refundRows.map(({ it, refundable, tier, policy }) => (
                    <div
                      key={it.id}
                      onClick={() => openEditModal(it.booking)}
                      className="flex items-center justify-between py-3 border-b border-outline/20 last:border-0 cursor-pointer hover:bg-surface-container/50 -mx-2 px-2 rounded-lg transition-colors"
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
                          {formatCurrency(refundable, it.currency)}
                        </div>
                        <div className="text-[11px] text-on-surface-variant">
                          {tier
                            ? `${tier.kind === 'percent' ? `${tier.value}%` : formatCurrency(tier.value, it.currency)} until ${formatCutoff(tier.cutoff)}`
                            : Array.isArray(policy)
                              ? `expired ${formatCutoff(policy[policy.length - 1].cutoff)}`
                              : 'Non-refundable'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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
          <div className="mat-surface p-6 min-w-0">
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
