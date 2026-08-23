"use client";

import { useMemo, useState } from 'react'
import { useTripContext } from '../lib/trip-context'
import { updateBooking, deleteBooking } from '@/lib/client-actions'
import BookingCard from '../components/BookingCard'
import BookingModal from '../components/BookingModal'
import FilterChip from '../components/FilterChip'
import StatsStrip from '../components/StatsStrip'
import { getBookingStats } from '../lib/bookingStats'
import { TYPE_ICONS } from '../lib/calendar'
import { isCancelled } from '../lib/booking-cost'

const TYPE_LABELS = {
  flight: 'Flights',
  train: 'Trains',
  bus: 'Buses',
  rental: 'Rentals',
  cruise: 'Cruises',
  hotel: 'Accomm',
  activity: 'Activities',
}

export default function BookingsByType({ type, bookings: allBookings }) {
  const { selectedTrip, tripMeta, trips, selectedTrips, fx } = useTripContext()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingBooking, setEditingBooking] = useState(null)
  // 'all' | <tripId>. Only offered on the All Trips view — with a sidebar
  // selection the list is already scoped by it, so chips would be dead.
  const [tripFilter, setTripFilter] = useState('all')
  const [showCancelled, setShowCancelled] = useState(true)
  const showTripChips = selectedTrips.length === 0 && trips.length > 1

  // Props carry the union of every trip; filter by the client-side selection.
  const selSet = new Set(selectedTrips)
  const bookings = selectedTrips.length
    ? allBookings.filter((b) => selSet.has(b.trip_id))
    : allBookings

  const ofType = bookings.filter((b) => b.type === type)
  const byTrip =
    tripFilter === 'all' ? ofType : ofType.filter((b) => b.trip_id === tripFilter)
  // Cancelled bookings are kept in the list — struck through — but hideable,
  // since a long-planned trip accumulates them and they aren't what you came to
  // this page to read. The chip only appears when there is one to hide.
  const cancelledCount = byTrip.filter(isCancelled).length
  const filtered = showCancelled ? byTrip : byTrip.filter((b) => !isCancelled(b))
  const label = TYPE_LABELS[type] || type
  const icon = TYPE_ICONS[type] || '📌'
  // `bookings` is already trip-scoped by the RSC when a trip is selected in the
  // sidebar; the chips above only sub-filter the All Trips view. Stats follow
  // whichever filter is active.
  // `byTrip`, not `filtered`: the Cancelled chip decides what the LIST shows,
  // and the stats must not move when someone toggles it. getBookingStats drops
  // cancelled bookings itself, so this is the live set either way.
  const stats = useMemo(() => getBookingStats(type, byTrip, fx?.rates), [type, byTrip, fx])

  const openEditModal = (booking) => {
    setEditingBooking(booking)
    setModalOpen(true)
  }

  return (
    <div className="w-full max-w-5xl lg:max-w-6xl mx-auto">
      {/* Trip filter — same chip row as the To-dos board. */}
      {showTripChips && (
        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1 shrink-0">
          <FilterChip
            active={tripFilter === 'all'}
            onClick={() => setTripFilter('all')}
            label="All trips"
          />
          {trips.map((trip) => {
            const count = ofType.filter((b) => b.trip_id === trip.id).length
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

      {cancelledCount > 0 && (
        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1 shrink-0">
          <FilterChip
            active={showCancelled}
            onClick={() => setShowCancelled((v) => !v)}
            label="Cancelled"
            count={cancelledCount}
          />
        </div>
      )}

      {/* Stats describe the trip that actually happened, so they read off the
          live bookings regardless of whether cancelled ones are on screen
          (getBookingStats filters them out itself). */}
      <StatsStrip stats={stats} />

      <div className="pb-10">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
            <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4">
              <span className="text-2xl">{icon}</span>
            </div>
            <p className="text-sm font-medium">
              {tripFilter !== 'all'
                ? `No ${label.toLowerCase()} on this trip`
                : `No ${label.toLowerCase()} booked yet`}
            </p>
            {tripFilter !== 'all' && (
              <button
                onClick={() => setTripFilter('all')}
                className="text-xs text-primary font-medium mt-2 hover:underline"
              >
                Show all trips
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                onClick={openEditModal}
              />
            ))}
          </div>
        )}
      </div>

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
