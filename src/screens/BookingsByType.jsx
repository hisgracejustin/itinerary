"use client";

import { useMemo, useState } from 'react'
import { useTripContext } from '../lib/trip-context'
import { updateBooking, deleteBooking } from '@/lib/client-actions'
import BookingCard from '../components/BookingCard'
import BookingModal from '../components/BookingModal'
import StatsStrip from '../components/StatsStrip'
import { getBookingStats } from '../lib/bookingStats'
import { TYPE_ICONS } from '../lib/calendar'

const TYPE_LABELS = {
  flight: 'Flights',
  train: 'Trains',
  bus: 'Buses',
  cruise: 'Cruises',
  hotel: 'Accomm',
  activity: 'Activities',
}

export default function BookingsByType({ type, bookings }) {
  const { selectedTrip, tripMeta } = useTripContext()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingBooking, setEditingBooking] = useState(null)

  const filtered = bookings.filter((b) => b.type === type)
  const label = TYPE_LABELS[type] || type
  const icon = TYPE_ICONS[type] || '📌'
  // `bookings` is already trip-scoped by the RSC, so these follow the trip chip
  // without any extra wiring.
  const stats = useMemo(() => getBookingStats(type, filtered), [type, filtered])

  const openEditModal = (booking) => {
    setEditingBooking(booking)
    setModalOpen(true)
  }

  return (
    <div className="h-full flex flex-col w-full max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">{icon}</span>
          <h2 className="text-xl font-medium text-on-surface">{label}</h2>
        </div>
        {tripMeta && (
          <span className="text-xs font-medium bg-primary-light text-primary px-3 py-1 rounded-full">
            {tripMeta.name}
          </span>
        )}
      </div>

      <StatsStrip stats={stats} />

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
            <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4">
              <span className="text-2xl">{icon}</span>
            </div>
            <p className="text-sm font-medium">No {label.toLowerCase()} booked yet</p>
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
