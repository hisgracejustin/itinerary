import { Fragment } from 'react'
import { TYPE_COLORS, TYPE_ICONS, formatTime } from '../lib/calendar'
import { getFlightDuration } from '../lib/airports'

function layoverDuration(arrivalISO, departureISO) {
  const arr = new Date(arrivalISO)
  const dep = new Date(departureISO)
  const diffMs = dep - arr
  if (diffMs <= 0) return ''
  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  const mins = Math.round((diffMs % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 0 && mins > 0) return `${hours}h${mins}m`
  if (hours > 0) return `${hours}h`
  return `${mins}m`
}

function parseDetails(booking) {
  if (!booking.details) return {}
  if (typeof booking.details === 'string') {
    try { return JSON.parse(booking.details) } catch { return {} }
  }
  return booking.details
}

function FlightDetails({ booking, details }) {
  const flyingTime = getFlightDuration(
    booking.start_date,
    booking.end_date,
    details.departure_airport,
    details.arrival_airport
  )
  const stops = details.layovers?.length ? details.layovers : []
  // "SFO 1h21m" — the only facts a layover adds beyond the endpoints, which the
  // title and the timeline already state.
  const stopSummary = stops
    .map((lo) => {
      const dur = lo.arrival && lo.departure ? layoverDuration(lo.arrival, lo.departure) : ''
      return dur ? `${lo.airport} ${dur}` : lo.airport
    })
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">✈️</span>
          <div>
            <div className="font-semibold text-sm">{booking.title}</div>
            {(booking.provider || stops.length > 0) && (
              <div className="text-xs opacity-70">
                {booking.provider}
                {booking.provider && stops.length > 0 && ' · '}
                {stops.length > 0 && `${stops.length} stop${stops.length > 1 ? 's' : ''}`}
              </div>
            )}
          </div>
        </div>
        {details.flight_number && (
          <span className="text-xs font-mono bg-white/50 px-2 py-0.5 rounded">{details.flight_number}</span>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs">
        <div className="text-center">
          <div className="font-bold text-base">{details.departure_airport || '—'}</div>
          <div className="opacity-70">{formatTime(booking.start_date)}</div>
        </div>
        {/* The stop belongs on the line, not in a footnote: the midpoint already
            existed, it was just holding a decorative plane instead of the data.
            Direct flights keep the plane, so a stop reads at a glance. */}
        <div className="flex-1 flex flex-col items-center min-w-0">
          <div className="flex items-center w-full">
            <div className="h-px flex-1 bg-current opacity-30" />
            {stops.length === 0 ? (
              <svg className="w-4 h-4 mx-1 opacity-50" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            ) : (
              stops.map((lo, i) => (
                <Fragment key={i}>
                  <span
                    className="w-[5px] h-[5px] rounded-full bg-orange-500 shrink-0 mx-1 ring-2 ring-white"
                    aria-hidden
                  />
                  <div className="h-px flex-1 bg-current opacity-30" />
                </Fragment>
              ))
            )}
          </div>
          {stopSummary && (
            <span className="text-[10px] leading-tight text-orange-600 font-medium mt-0.5 max-w-full truncate">
              {stopSummary}
            </span>
          )}
          {flyingTime && (
            <span className="text-[10px] leading-tight opacity-50">{flyingTime}</span>
          )}
        </div>
        <div className="text-center">
          <div className="font-bold text-base">{details.arrival_airport || '—'}</div>
          <div className="opacity-70">{booking.end_date ? formatTime(booking.end_date) : ''}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-70">
        {details.terminal && <span>Terminal {details.terminal}</span>}
        {details.gate && <span>Gate {details.gate}</span>}
        {details.seat && <span>Seat {details.seat}</span>}
        {booking.confirmation_number && <span>Conf: {booking.confirmation_number}</span>}
      </div>
    </div>
  )
}

function TrainDetails({ booking, details }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🚂</span>
          <div>
            <div className="font-semibold text-sm">{booking.title}</div>
            {booking.provider && <div className="text-xs opacity-70">{booking.provider}</div>}
          </div>
        </div>
        {details.train_number && (
          <span className="text-xs font-mono bg-white/50 px-2 py-0.5 rounded">{details.train_number}</span>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs">
        <div className="text-center">
          <div className="font-bold text-sm">{details.departure_station || '—'}</div>
          <div className="opacity-70">{formatTime(booking.start_date)}</div>
        </div>
        <div className="flex-1 flex items-center">
          <div className="h-px flex-1 bg-current opacity-30" />
          <span className="mx-1 opacity-50">→</span>
          <div className="h-px flex-1 bg-current opacity-30" />
        </div>
        <div className="text-center">
          <div className="font-bold text-sm">{details.arrival_station || '—'}</div>
          <div className="opacity-70">{booking.end_date ? formatTime(booking.end_date) : ''}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-70">
        {details.car && <span>Car {details.car}</span>}
        {details.seat && <span>Seat {details.seat}</span>}
        {booking.confirmation_number && <span>Conf: {booking.confirmation_number}</span>}
      </div>
    </div>
  )
}

function CruiseDetails({ booking, details }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-lg">🚢</span>
        <div>
          <div className="font-semibold text-sm">{booking.title}</div>
          {booking.provider && <div className="text-xs opacity-70">{booking.provider}</div>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {details.ship_name && (
          <div>
            <span className="opacity-60">Ship:</span> <span className="font-medium">{details.ship_name}</span>
          </div>
        )}
        {details.cabin && (
          <div>
            <span className="opacity-60">Cabin:</span> <span className="font-medium">{details.cabin}</span>
          </div>
        )}
        {details.deck && (
          <div>
            <span className="opacity-60">Deck:</span> <span className="font-medium">{details.deck}</span>
          </div>
        )}
        {booking.confirmation_number && (
          <div>
            <span className="opacity-60">Conf:</span> <span className="font-medium">{booking.confirmation_number}</span>
          </div>
        )}
      </div>
      {details.departure_port && (
        <div className="text-xs">
          <span className="opacity-60">Route:</span> {details.departure_port}
          {details.arrival_port && <span> → {details.arrival_port}</span>}
        </div>
      )}
      {details.ports_of_call?.length > 0 && (
        <div className="text-xs">
          <span className="opacity-60">Ports:</span> {details.ports_of_call.join(' · ')}
        </div>
      )}
      <div className="flex gap-4 text-xs opacity-70">
        <span>{formatTime(booking.start_date)}</span>
        {booking.end_date && <span>→ {formatTime(booking.end_date)}</span>}
      </div>
    </div>
  )
}

function HotelDetails({ booking, details }) {
  const startDate = booking.start_date ? new Date(booking.start_date) : null
  const endDate = booking.end_date ? new Date(booking.end_date) : null
  const nights = startDate && endDate
    ? Math.round((endDate - startDate) / (1000 * 60 * 60 * 24))
    : null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🏡</span>
          <div>
            <div className="font-semibold text-sm">{booking.title}</div>
            {booking.provider && <div className="text-xs opacity-70">{booking.provider}</div>}
          </div>
        </div>
        {nights && (
          <span className="text-xs bg-white/50 px-2 py-0.5 rounded">{nights} night{nights !== 1 ? 's' : ''}</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {details.check_in_time && (
          <div>
            <span className="opacity-60">Check-in:</span> <span className="font-medium">{details.check_in_time}</span>
          </div>
        )}
        {details.check_out_time && (
          <div>
            <span className="opacity-60">Check-out:</span> <span className="font-medium">{details.check_out_time}</span>
          </div>
        )}
        {details.room_type && (
          <div>
            <span className="opacity-60">Room:</span> <span className="font-medium">{details.room_type}</span>
          </div>
        )}
        {booking.confirmation_number && (
          <div>
            <span className="opacity-60">Conf:</span> <span className="font-medium">{booking.confirmation_number}</span>
          </div>
        )}
      </div>
      {details.address && (
        <div className="text-xs opacity-70">📍 {details.address}</div>
      )}
    </div>
  )
}

function ActivityDetails({ booking, details }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-lg">🎯</span>
        <div>
          <div className="font-semibold text-sm">{booking.title}</div>
          {booking.provider && <div className="text-xs opacity-70">{booking.provider}</div>}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="opacity-70">{formatTime(booking.start_date)}</span>
        {details.duration && <span className="opacity-70">Duration: {details.duration}</span>}
        {booking.confirmation_number && <span className="opacity-70">Conf: {booking.confirmation_number}</span>}
      </div>
      {details.location && (
        <div className="text-xs opacity-70">📍 {details.location}</div>
      )}
      {details.address && !details.location && (
        <div className="text-xs opacity-70">📍 {details.address}</div>
      )}
      {details.notes && (
        <div className="text-xs opacity-60 italic">{details.notes}</div>
      )}
    </div>
  )
}

const DETAIL_COMPONENTS = {
  flight: FlightDetails,
  train: TrainDetails,
  bus: TrainDetails,
  cruise: CruiseDetails,
  hotel: HotelDetails,
  activity: ActivityDetails,
}

export default function BookingCard({ booking, onClick, hideTrip, displayDate }) {
  const colors = TYPE_COLORS[booking.type] || TYPE_COLORS.activity
  const details = parseDetails(booking)
  const DetailComponent = DETAIL_COMPONENTS[booking.type] || ActivityDetails
  const mapsUrl = details.maps_url

  // Determine check-in / check-out context for multi-day bookings
  const stayNote = (() => {
    if (!displayDate || !booking.end_date) return null
    const start = new Date(booking.start_date)
    const end = new Date(booking.end_date)
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
    if (endDay <= startDay) return null
    const viewDay = new Date(displayDate.getFullYear(), displayDate.getMonth(), displayDate.getDate())
    if (booking.type === 'flight') {
      if (viewDay.getTime() === startDay.getTime()) return 'Take-off'
      if (viewDay.getTime() === endDay.getTime()) return 'Land'
    } else if (booking.type === 'train' || booking.type === 'bus') {
      if (viewDay.getTime() === startDay.getTime()) return 'Depart'
      if (viewDay.getTime() === endDay.getTime()) return 'Arrive'
    } else {
      if (viewDay.getTime() === startDay.getTime()) return '🔑 Check-in'
      if (viewDay.getTime() === endDay.getTime()) return '🚪 Check-out'
    }
    return null
  })()

  return (
    <div
      onClick={() => onClick?.(booking)}
      className={`p-4 rounded-xl border-l-4 ${colors.border} bg-white shadow-elevation-1 hover:shadow-elevation-2 transition-all duration-150 cursor-pointer relative mat-press`}
    >
      <DetailComponent booking={booking} details={details} />
      {((!hideTrip && booking.trip) || mapsUrl || stayNote) && (
        <div className="mt-2.5 pt-2 border-t border-outline/20 flex items-center justify-between">
          <span className="text-xs text-on-surface-variant">
            {stayNote && <span className="text-on-surface font-medium">{stayNote}</span>}
            {stayNote && !hideTrip && booking.trip && <span className="mx-1.5 opacity-40">·</span>}
            {!hideTrip && (booking.trip || '')}
          </span>
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-on-surface-variant/50 hover:text-primary transition-colors duration-150"
              title="Open in Google Maps"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </a>
          )}
        </div>
      )}
    </div>
  )
}
