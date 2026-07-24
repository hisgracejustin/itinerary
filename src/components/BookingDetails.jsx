import { formatCurrency } from '../lib/currencies'
import { itemUnitTransfers } from '../lib/split'
import { useTripContext } from '../lib/trip-context'

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
const SKIP_DETAIL_KEYS = new Set(['informal', 'layovers', 'maps_url'])

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
  if (!booking) return null
  const details = booking.details || {}

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
    ([k, v]) => !SKIP_DETAIL_KEYS.has(k) && v != null && v !== '',
  )

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
                  {l.name}
                  <span className="text-on-surface-variant" aria-hidden> → </span>
                  {splitResult.payerName} {formatCurrency(l.amount, booking.cost_currency || 'USD')}
                </span>
              ))}
            </span>
          </Row>
        )}
      </div>

      {detailEntries.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">Details</h3>
          <div className="rounded-xl border border-outline/20 px-4 py-1">
            {detailEntries.map(([key, value]) => (
              <Row key={key} label={DETAIL_LABELS[key] || key.replace(/_/g, ' ')}>
                {String(value)}
              </Row>
            ))}
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
    </div>
  )
}
