import { useEffect, useState } from 'react'
import { formatCurrency } from '../lib/currencies'
import { sanitizeCancellationPolicy, formatCutoff, formatExpiry } from '../lib/cancellation'
import { itemUnitTransfers } from '../lib/split'
import { useTripContext } from '../lib/trip-context'
import { getEntityAudit } from '@/lib/client-actions'
import { memberLabel } from './AssigneePicker'
import AuditFeed from './AuditFeed'

const TYPE_LABELS = {
  flight: '✈️ Flight',
  train: '🚂 Train',
  bus: '🚌 Bus',
  cruise: '🚢 Cruise',
  hotel: '🏡 Accommodation',
  rental: '🚗 Rental',
  activity: '🎯 Activity',
}

// Pretty labels for the type-specific `details` keys (mirrors BookingForm's TYPE_FIELDS).
const DETAIL_LABELS = {
  departure_airport: 'Departure Airport',
  arrival_airport: 'Arrival Airport',
  flight_number: 'Flight Number',
  seat: 'Seat',
  terminal: 'Terminal',
  gate: 'Gate',
  departure_station: 'Departure',
  arrival_station: 'Arrival',
  train_number: 'Train Number',
  bus_number: 'Bus/Route Number',
  car: 'Car',
  vehicle_type: 'Vehicle Type',
  pickup_location: 'Pick-up Location',
  dropoff_location: 'Drop-off Location',
  insurance: 'Insurance',
  ship_name: 'Ship Name',
  cabin: 'Cabin',
  deck: 'Deck',
  departure_port: 'Departure Port',
  arrival_port: 'Arrival Port',
  ports_of_call: 'Ports of Call',
  address: 'Address',
  check_in_time: 'Check-in Time',
  check_out_time: 'Check-out Time',
  room_type: 'Room Type',
  location: 'Location',
  duration: 'Duration',
  notes: 'Notes',
  maps_url: 'Map',
}

// details keys that aren't shown as plain rows here
const SKIP_DETAIL_KEYS = new Set(['informal', 'layovers', 'maps_url', 'cancellation_policy'])

function formatDate(iso, dateOnly) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d)) return iso
  return d.toLocaleString(undefined, dateOnly
    ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
    : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Row({ label, children }) {
  if (children == null || children === '') return null
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-outline/10 last:border-b-0">
      <span className="text-xs font-medium text-on-surface-variant shrink-0">{label}</span>
      <span className="text-sm text-on-surface text-right break-words min-w-0">{children}</span>
    </div>
  )
}

export default function BookingDetails({ booking }) {
  const { trips } = useTripContext()
  // Fetched rather than passed down: it's per-booking, only this view wants it,
  // and a reader who isn't an owner/admin gets an empty list back — so the
  // section simply doesn't appear for them. A failure (offline, no session)
  // leaves it empty too; history is never worth an error state here.
  const [history, setHistory] = useState([])
  const bookingId = booking?.id
  useEffect(() => {
    if (!bookingId) return
    let live = true
    getEntityAudit('booking', bookingId)
      .then((rows) => { if (live) setHistory(rows) })
      .catch(() => {})
    return () => { live = false }
  }, [bookingId])
  if (!booking) return null
  const details = booking.details || {}

  // The creator's name comes from the roster the viewer already has; the column
  // is permanently nullable, so bookings older than it say so rather than
  // pretending nobody added them.
  const creator = booking.created_by
    ? (trips || []).flatMap((t) => t.members || []).find((m) => m.id === booking.created_by)
    : null
  const addedBy = booking.created_by
    ? `Added by ${creator ? memberLabel(creator) : 'someone who has since left'}`
    : 'Added before this was recorded'

  // Net result of this booking's split, aggregated by settlement unit — "who
  // owes the payer's unit for this item". Roster comes from the booking's trip.
  const bookingTrip = (trips || []).find((t) => t.id === booking.trip_id)
  const effectiveCost =
    booking.cost_amount != null ? booking.cost_amount * (booking.cost_share ?? 1) : 0
  const splitResult = bookingTrip
    ? itemUnitTransfers({
        members: bookingTrip.members || [],
        parties: bookingTrip.parties || [],
        amount: effectiveCost,
        paidBy: booking.paid_by,
        splits: booking.splits,
      })
    : null
  const dateOnly = booking.type === 'hotel' && details.informal
  const start = formatDate(booking.start_date, dateOnly)
  const end = formatDate(booking.end_date, dateOnly)
  const detailEntries = Object.entries(details).filter(
    ([k, v]) => !SKIP_DETAIL_KEYS.has(k) && v != null && v !== '' && !(Array.isArray(v) && v.length === 0),
  )
  // Re-sanitized on read: seeded and legacy rows never passed through the Zod layer.
  const policy = sanitizeCancellationPolicy(details.cancellation_policy)

  // A merged layover flight keeps its per-leg data in details.layovers
  // ({ airport, arrival, departure, flight_number-of-the-inbound-leg }).
  // Reconstruct the legs for display; the merge doesn't store the final
  // leg's flight number, so that one renders without it.
  const layovers = Array.isArray(details.layovers) ? details.layovers : []
  const legs =
    layovers.length > 0
      ? [
          ...layovers.map((lo, i) => ({
            from: i === 0 ? details.departure_airport : layovers[i - 1].airport,
            to: lo.airport,
            depart: i === 0 ? booking.start_date : layovers[i - 1].departure,
            arrive: lo.arrival,
            flight: lo.flight_number,
            stopAfter: lo,
          })),
          {
            from: layovers[layovers.length - 1].airport,
            to: details.arrival_airport,
            depart: layovers[layovers.length - 1].departure,
            arrive: booking.end_date,
            flight: null,
            stopAfter: null,
          },
        ]
      : []
  const legTime = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d)) return ''
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }
  const stopDuration = (lo) => {
    const ms = new Date(lo.departure) - new Date(lo.arrival)
    if (!Number.isFinite(ms) || ms <= 0) return ''
    const h = Math.floor(ms / 3600000)
    const m = Math.round((ms % 3600000) / 60000)
    return h > 0 ? (m > 0 ? `${h}h${m}m` : `${h}h`) : `${m}m`
  }

  return (
    <div className="space-y-4 min-w-0">
      <div>
        <span className="inline-block text-xs font-medium bg-surface-container text-on-surface-variant px-2.5 py-1 rounded-full">
          {TYPE_LABELS[booking.type] || booking.type}
        </span>
      </div>

      <div className="rounded-xl border border-outline/20 px-4 py-1">
        <Row label="Provider">{booking.provider}</Row>
        <Row label="Start">{start}</Row>
        <Row label="End">{end}</Row>
        <Row label="Confirmation">{booking.confirmation_number}</Row>
        {booking.cost_amount != null && (
          <Row label="Cost">
            {formatCurrency(booking.cost_amount, booking.cost_currency || 'USD')}
            {booking.cost_share != null && booking.cost_share !== 1 && (
              <span className="text-on-surface-variant"> · your share {formatCurrency(booking.cost_amount * booking.cost_share, booking.cost_currency || 'USD')}</span>
            )}
          </Row>
        )}
        {splitResult && splitResult.lines.length > 0 && (
          <Row label="Split">
            <span className="block space-y-0.5">
              {splitResult.lines.map((l, i) => (
                <span key={i} className="block">
                  {l.fromName}
                  <span className="text-on-surface-variant" aria-hidden> → </span>
                  {l.toName} {formatCurrency(l.amount, booking.cost_currency || 'USD')}
                </span>
              ))}
            </span>
          </Row>
        )}
      </div>

      <p className="text-[11px] text-on-surface-variant">{addedBy}</p>

      {detailEntries.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">Details</h3>
          <div className="rounded-xl border border-outline/20 px-4 py-1">
            {detailEntries.map(([key, value]) => {
              const text = Array.isArray(value) ? value.join(' · ') : String(value)
              return (
                <Row key={key} label={DETAIL_LABELS[key] || key.replace(/_/g, ' ')}>
                  {/* Notes are typed with Enter; without pre-wrap every line
                      collapses into one run-on paragraph. */}
                  {text.includes('\n') ? (
                    <span className="block whitespace-pre-wrap break-words">{text}</span>
                  ) : (
                    text
                  )}
                </Row>
              )
            })}
          </div>
        </div>
      )}

      {legs.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">Flight legs</h3>
          <div className="rounded-xl border border-outline/20 px-4 py-1">
            {legs.map((leg, i) => (
              <div key={i} className={i > 0 ? 'border-t border-outline/10' : ''}>
                <div className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-on-surface">
                      {leg.from || '—'} → {leg.to || '—'}
                      {leg.flight && (
                        <span className="ml-2 text-xs font-mono font-normal bg-surface-container px-1.5 py-0.5 rounded">
                          {leg.flight}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-on-surface-variant text-right shrink-0 whitespace-nowrap">
                    {legTime(leg.depart)}
                    <span className="opacity-60"> → </span>
                    {legTime(leg.arrive)}
                  </div>
                </div>
                {leg.stopAfter && (
                  <div className="pb-2 text-[11px] text-amber-600">
                    {stopDuration(leg.stopAfter) && `${stopDuration(leg.stopAfter)} layover`}
                    {leg.stopAfter.airport && ` in ${leg.stopAfter.airport}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {policy && (
        <div>
          <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">Cancellation</h3>
          <div className="rounded-xl border border-outline/20 px-4 py-1">
            {policy === 'non_refundable' ? (
              <Row label="Policy">Non-refundable</Row>
            ) : (
              <>
                {policy.map((tier, i) => (
                  <Row key={i} label={`Until ${formatCutoff(tier.cutoff)}`}>
                    {tier.kind === 'percent'
                      ? `${tier.value}% refund`
                      : tier.kind === 'fee'
                        ? `Refund minus ${formatCurrency(tier.value, booking.cost_currency || 'USD')} fee`
                        : `${formatCurrency(tier.value, booking.cost_currency || 'USD')} refundable`}
                    {/* Voucher side of the same tier, appended rather than given
                        its own row — one line per tier keeps the ladder readable.
                        'or' vs '+' is the whole difference between a choice and a
                        bonus, so it's carried in the joining word. The expiry
                        carries its year: it's often long after the trip. */}
                    {tier.credit &&
                      `${tier.credit.mode === 'and' ? ' + ' : ' or '}${
                        tier.credit.kind === 'percent'
                          ? `${tier.credit.value}%`
                          : formatCurrency(tier.credit.value, booking.cost_currency || 'USD')
                      } credit${tier.credit.expiry ? ` (expires ${formatExpiry(tier.credit.expiry)})` : ''}`}
                  </Row>
                ))}
                <Row label={`After ${formatCutoff(policy[policy.length - 1].cutoff)}`}>Non-refundable</Row>
              </>
            )}
          </div>
        </div>
      )}

      {details.maps_url && (
        <a
          href={details.maps_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Open in Google Maps
        </a>
      )}

      {history.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">History</h3>
          <div className="rounded-xl border border-outline/20 px-4 py-3">
            <AuditFeed entries={history} scope="entity" />
          </div>
        </div>
      )}
    </div>
  )
}
