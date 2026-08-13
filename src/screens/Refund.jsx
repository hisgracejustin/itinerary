"use client";

import { useEffect, useState } from 'react'
import { useTripContext } from '../lib/trip-context'
import { updateBooking, deleteBooking } from '@/lib/client-actions'
import { formatCurrency } from '../lib/currencies'
import { wallClockInZone } from '../lib/airports'
import { makeZoneResolver } from '../lib/booking-zones'
import {
  sanitizeCancellationPolicy,
  refundableAsOf,
  localNow,
  nowInstant,
  formatCutoff,
  formatExpiry,
  daysUntilCutoff,
} from '../lib/cancellation'
import {
  bookingCostItem,
  hkdOf,
  itemContribution,
  scopeUserIds,
} from '../lib/cost-items'
import { TYPE_ICONS } from '../lib/calendar'
import FilterChip from '../components/FilterChip'
import BookingModal from '../components/BookingModal'
import { memberFirstName } from '../components/AssigneePicker'

// A tier's cash terms on one line. Shared by the refund row's sub-line and its
// deadline warning, so "drops to 50%" is worded the same as the 50% it will read
// once that cutoff passes. The minus keeps a fee from looking like a payout.
const tierLabel = (tier, currency) =>
  tier.kind === 'percent'
    ? `${tier.value}%`
    : tier.kind === 'fee'
      ? `−${formatCurrency(tier.value, currency)} fee`
      : formatCurrency(tier.value, currency)

/**
 * What comes back if you cancel, as of a moment you pick. Expenses have nothing
 * to cancel, so this page is bookings only — its sibling /costs answers the
 * other question, what everything cost in the first place.
 */
export default function Refund({ bookings: allBookings, currentUserId }) {
  const { tripMeta, selectedTrip, selectedTrips, trips, fx } = useTripContext()
  const rates = fx?.rates
  const [scope, setScope] = useState('everyone') // 'everyone' | 'me' | 'us'
  const [modalOpen, setModalOpen] = useState(false)
  const [editingBooking, setEditingBooking] = useState(null)
  // 'all' | <tripId>. Only offered on the All Trips view — with a sidebar
  // selection the list is already scoped by it, so chips would be dead.
  const [tripFilter, setTripFilter] = useState('all')
  // "What comes back if I cancel at this moment", as the picker holds it: the
  // viewer's own naive 'YYYY-MM-DDTHH:mm', which is what a datetime-local means.
  // Null until mounted — seeding it here would run on the UTC server and hand
  // the input a value the client disagrees with on hydration. The math below
  // works off the instant, which needs no such wait.
  const [asOf, setAsOf] = useState(null)
  useEffect(() => setAsOf(localNow()), [])
  // DESELECTED refundable rows, not selected ones: everything is counted by
  // default, including rows that appear later when the chips, trip filter or
  // as-of moment change. Ids of rows that fall out of the list linger here
  // harmlessly, so a row keeps its state if the user filters back to it.
  const [deselected, setDeselected] = useState(() => new Set())
  const showTripChips = selectedTrips.length === 0 && trips.length > 1

  // Props carry the union of every trip; filter by the client-side selection.
  const selSet = new Set(selectedTrips)
  const inSel = (tripId) => selectedTrips.length === 0 || selSet.has(tripId)
  const bookings = (allBookings || []).filter((b) => inSel(b.trip_id))

  const tripById = new Map((trips || []).map((t) => [t.id, t]))

  // The as-of as an INSTANT. A cancellation cutoff belongs to the provider's
  // wall clock, so the one thing that travels between the picker and a booking
  // is the moment itself; each booking then reads it on its own clock below.
  const picked = asOf ? new Date(asOf).getTime() : NaN
  const nowMs = nowInstant()
  const asOfMs = Number.isFinite(picked) ? picked : nowMs
  // Countdowns stay in the READER's days (see daysUntilCutoff) — the deliberate
  // asymmetry with tier selection, which is provider-zone.
  const readerAsOf = asOf ?? wallClockInZone(asOfMs, null)

  // Unfiltered on purpose: the flight that placed a booking in a zone is often
  // on a different trip (see chronologicalZone).
  const zoneOf = makeZoneResolver(allBookings || [])

  const items = bookings.filter((b) => b.cost_amount && b.cost_currency).map(bookingCostItem)

  // Trip chips sub-filter the sidebar selection (the same compose pattern as the
  // per-type booking lists). Ignored while the chips are hidden — a sidebar
  // selection takes the row away, and a filter still applying from a control
  // nobody can see leaves an all-zero page with no way back.
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

  // Refund exposure as of `asOf`, FOLLOWING the scope chips: under Me/Us every
  // figure is the viewer's share, so the page answers "how much of MY money
  // comes back".
  const refundRows = []
  let noPolicyCount = 0
  let noPolicyHKD = 0
  filteredItems.forEach((it) => {
    // Everything this row decides is read on the provider's clock, so the two
    // sides of every compare below are that clock's wall time.
    const asOfThere = wallClockInZone(asOfMs, zoneOf(it.booking))
    // Already underway at the as-of moment — there's nothing left to cancel.
    // start_date is 'YYYY-MM-DDTHH:mm:ss'; slicing to 16 aligns it with asOfThere.
    if (String(it.booking.start_date).slice(0, 16) < asOfThere) return
    const base = contribution(it)
    // Under Me/Us, no share means no stake.
    if (base == null || (scope !== 'everyone' && base <= 0)) return
    const policy = sanitizeCancellationPolicy(it.booking.details?.cancellation_policy)
    const r = refundableAsOf(policy, it.effective, asOfThere)
    // No policy on file is UNKNOWN, not zero — its own bucket, never summed into
    // the non-refundable figure. A policy of 'non_refundable' is a real zero and
    // falls through to the non-refundable total below.
    if (!r) {
      noPolicyCount += 1
      noPolicyHKD += hkdOf(it, base, rates)
      return
    }
    // The refund is computed on the whole cost (so a flat tier clamps against the
    // real total), then scaled to the viewer's fraction of it: a HK$500 refund on
    // a 50/50 split gives each payer back HK$250.
    const frac = it.effective > 0 ? base / it.effective : 0
    const refundable = r.refundable * frac
    // Voucher/flight credit rides the same scaling, and stays OUT of both money
    // figures: it isn't cash back, and it isn't money lost either.
    const credit = r.credit * frac
    // Deadline pressure: what these terms turn into when the applicable tier's
    // cutoff passes, surfaced only once that's inside a week. The next tier down
    // the sorted array is what takes over; nothing after the last one means
    // non-refundable. `days` is calendar-day DISPLAY math in the READER's zone
    // (see daysUntilCutoff) — which tier applies is still decided by a string
    // compare on the provider's clock, above.
    const warning = (() => {
      if (!r.tier) return null
      const days = daysUntilCutoff(r.tier.cutoff, readerAsOf)
      if (days == null || days < 0 || days > 7) return null
      const next = policy[policy.indexOf(r.tier) + 1]
      const becomes = next ? `drops to ${tierLabel(next, it.currency)}` : 'becomes non-refundable'
      // A same-day deadline is the one case where the hour still matters, so
      // 'today' carries it; past today the time of day is noise.
      const when =
        days === 0
          ? `today${r.tier.cutoff.length > 10 ? `, ${r.tier.cutoff.slice(11, 16)}` : ''}`
          : days === 1
            ? 'tomorrow'
            : `in ${days} days`
      return { days, label: `${becomes} ${when}`, urgent: days <= 2 }
    })()
    refundRows.push({
      it,
      base,
      refundable,
      credit,
      tier: r.tier,
      policy,
      warning,
      hkd: hkdOf(it, refundable, rates),
      nonRefHkd: hkdOf(it, base - refundable, rates),
      creditHkd: hkdOf(it, credit, rates),
      // What's actually gone if the vouchers get spent. An 'or' credit is a
      // choice, so only the better of the two is recoverable; an 'and' credit
      // stacks on the cash. With no credit `credit` is 0 and both branches
      // collapse to the plain base − refundable.
      netLossHkd: hkdOf(
        it,
        Math.max(
          0,
          base -
            (r.tier?.credit?.mode === 'and' ? refundable + credit : Math.max(refundable, credit)),
        ),
        rates,
      ),
    })
  })
  // Ordered by money at RISK, not money coming back: the list is read to decide
  // what to cancel, and the booking with the most to lose is the one to look at
  // first — a fully refundable HK$20k flight needs less attention than a HK$3k
  // hotel that refunds nothing.
  refundRows.sort((a, b) => b.nonRefHkd - a.nonRefHkd)

  // The two headline figures count SELECTED rows only, so the page can answer
  // "what if I cancel just these". The no-policy bucket has no rows of its own
  // and stays selection-independent.
  const selectedRows = refundRows.filter((row) => !deselected.has(row.it.id))
  const refundableHKD = selectedRows.reduce((sum, row) => sum + row.hkd, 0)
  const nonRefundableHKD = selectedRows.reduce((sum, row) => sum + row.nonRefHkd, 0)
  // Third figure, shown only when there is one — most trips have no vouchers,
  // and an always-on "~HK$0 as credit" would just be noise.
  const creditHKD = selectedRows.reduce((sum, row) => sum + row.creditHkd, 0)
  // ...and broken out by issuer, because credit is only spendable with the
  // provider that issued it: HK$13k of United credit and HK$800 of hotel voucher
  // are not one HK$13.8k pot. Keyed on the row subtitle (the provider), falling
  // back to the title when a booking has none.
  const creditByProvider = (() => {
    const byName = new Map()
    selectedRows.forEach((row) => {
      if (row.creditHkd <= 0) return
      const name = row.it.subtitle || row.it.title
      byName.set(name, (byName.get(name) || 0) + row.creditHkd)
    })
    return [...byName.entries()].sort((a, b) => b[1] - a[1])
  })()
  // The bottom line once vouchers are counted as recovered value. Only worth
  // showing when credits exist — otherwise it's the non-refundable figure again.
  const netLossHKD = selectedRows.reduce((sum, row) => sum + row.netLossHkd, 0)
  const allSelected = refundRows.every((row) => !deselected.has(row.it.id))
  const toggleRow = (id) =>
    setDeselected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  // Only the rows currently on screen change state — ids deselected under a
  // different filter keep theirs.
  const toggleAll = () =>
    setDeselected((prev) => {
      const next = new Set(prev)
      refundRows.forEach((row) => (allSelected ? next.add(row.it.id) : next.delete(row.it.id)))
      return next
    })

  const typeIcon = (type) => TYPE_ICONS[type] || '📌'

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
            <span className="text-2xl">↩️</span>
          </div>
          <p className="text-sm font-medium">Nothing to cancel yet</p>
          <p className="text-xs mt-1 text-on-surface-variant/70">
            Bookings with a cost show up here with what you&apos;d get back
          </p>
        </div>
      ) : (
        <div className="pb-10">
          <div className="mat-surface p-6 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">
                Refundable if cancelled
              </div>
              <input
                type="datetime-local"
                // Empty until mount, when the device clock becomes available.
                value={asOf ?? ''}
                // Clearing the field would leave every tier looking expired —
                // fall back to now rather than showing a silent all-zero.
                onChange={(e) => setAsOf(e.target.value || localNow())}
                className="mat-input w-52 text-xs"
              />
            </div>
            {/* Two scenario panels: cash-world on the left, credit-world on
                the right. The wall between them is the point — the two
                worlds' figures are alternatives and must never be cross-
                added. Forfeit and True loss share the loss red: both are
                money gone, just under different assumptions. */}
            <div className={`grid gap-3 mt-4 ${creditHKD > 0 ? 'sm:grid-cols-2' : ''}`}>
              <div className="rounded-xl border border-outline/20 px-4 py-3 min-w-0">
                <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
                  If you take cash
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs text-on-surface-variant">Get back</span>
                  <span className="text-xl font-medium text-emerald-600">
                    ~HK${refundableHKD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 mt-1">
                  <span className="text-xs text-on-surface-variant">Forfeit</span>
                  <span className="text-xl font-medium text-red-600">
                    ~HK${nonRefundableHKD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
              </div>
              {/* With no credits anywhere this panel would just restate the
                  one on the left, so it only appears when vouchers exist. */}
              {creditHKD > 0 && (
                <div className="rounded-xl border border-outline/20 px-4 py-3 min-w-0">
                  <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-2">
                    If you use credits
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs text-on-surface-variant">Hold in credits</span>
                    <span className="text-xl font-medium text-primary">
                      ~HK${creditHKD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  {creditByProvider.slice(0, 3).map(([name, hkd]) => (
                    <div key={name} className="flex items-baseline justify-between gap-3 pl-3 min-w-0">
                      {/* Airline names run long; truncate rather than wrap. */}
                      <span className="text-xs text-on-surface-variant truncate min-w-0">{name}</span>
                      <span className="text-xs text-on-surface-variant shrink-0">
                        {hkd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  ))}
                  {creditByProvider.length > 3 && (
                    <div className="text-xs text-on-surface-variant/70 pl-3">
                      + {creditByProvider.length - 3} more
                    </div>
                  )}
                  <div className="flex items-baseline justify-between gap-3 mt-1">
                    <span className="text-xs text-on-surface-variant">True loss</span>
                    <span className="text-xl font-medium text-red-600">
                      ~HK${netLossHKD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
              )}
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
              <>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-xs text-primary font-medium hover:underline"
                  >
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="mt-1 space-y-1">
                  {refundRows.map(({ it, base, refundable, credit, tier, policy, warning }) => {
                    const selected = !deselected.has(it.id)
                    return (
                      <div
                        key={it.id}
                        onClick={() => openEditModal(it.booking)}
                        className="flex items-center justify-between gap-3 py-3 border-b border-outline/20 last:border-0 cursor-pointer hover:bg-surface-container/50 -mx-2 px-2 rounded-lg transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleRow(it.id)}
                          // The row opens the booking; the checkbox must not.
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Count ${it.title}`}
                          className="w-4 h-4 shrink-0 rounded border-outline/50 text-primary focus:ring-primary/30"
                        />
                        <div className={`flex flex-1 items-center justify-between gap-3 min-w-0 ${selected ? '' : 'opacity-50'}`}>
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-base">{typeIcon(it.type)}</span>
                            <div className="min-w-0">
                              <div className="text-sm text-on-surface font-medium truncate">{it.title}</div>
                              <div className="text-xs text-on-surface-variant truncate">{it.subtitle}</div>
                              {/* The terms are about to change — the one thing
                                  on this row that's time-critical, so it gets
                                  colour the rest of the row doesn't. */}
                              {warning && (
                                <div
                                  className={`flex items-center gap-1 min-w-0 text-[11px] ${
                                    warning.urgent ? 'text-red-600' : 'text-amber-600'
                                  }`}
                                >
                                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.59 3z" />
                                  </svg>
                                  <span className="truncate">{warning.label}</span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-medium text-on-surface">
                              {formatCurrency(refundable, it.currency)}
                              <span className="text-on-surface-variant font-normal">
                                {' '}of {formatCurrency(base, it.currency)}
                              </span>
                            </div>
                            {/* Capped and truncating: with a credit and an
                                expiry this line runs long, and unbounded it
                                would squeeze the title off a phone screen. */}
                            <div className="text-[11px] text-on-surface-variant truncate max-w-[10rem] sm:max-w-[20rem] ml-auto">
                              {tier
                                ? `${tierLabel(tier, it.currency)} until ${formatCutoff(tier.cutoff)}`
                                : Array.isArray(policy)
                                  ? `expired ${formatCutoff(policy[policy.length - 1].cutoff)}`
                                  : 'Non-refundable'}
                              {/* The voucher this row also returns — kept off
                                  the money line above, which is cash only. */}
                              {credit > 0 &&
                                ` · ${tier?.credit?.mode === 'and' ? '' : 'or '}+${formatCurrency(
                                  credit,
                                  it.currency,
                                )} credit${tier?.credit?.expiry ? ` (exp ${formatExpiry(tier.credit.expiry)})` : ''}`}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
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
    </div>
  )
}
