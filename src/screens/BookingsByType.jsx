"use client";

import { useBookings } from '../hooks/useBookings'
import { useTripContext } from '../lib/trip-context'
import BookingCard from '../components/BookingCard'
import BookingModal from '../components/BookingModal'
import { useState } from 'react'
import { TYPE_ICONS } from '../lib/calendar'
import Spinner from '../components/Spinner'

const TYPE_LABELS = {
  flight: 'Flights',
  train: 'Trains',
  bus: 'Buses',
  cruise: 'Cruises',
  hotel: 'Accomm',
  activity: 'Activities',
}

export default function BookingsByType({ type }) {
  const { selectedTrip, tripMeta } = useTripContext()
  const { bookings, loading, update, remove } = useBookings(selectedTrip)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingBooking, setEditingBooking] = useState(null)

  const filtered = bookings.filter((b) => b.type === type)
  const label = TYPE_LABELS[type] || type
  const icon = TYPE_ICONS[type] || '📌'

  const openEditModal = (booking) => {
    setEditingBooking(booking)
    setModalOpen(true)
  }

  return (
    <div className="h-full flex flex-col max-w-2xl mx-auto">
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

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Spinner />
            <span className="text-sm text-on-surface-variant">Loading...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
            <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4">
              <span className="text-2xl">{icon}</span>
            </div>
            <p className="text-sm font-medium">No {label.toLowerCase()} booked yet</p>
          </div>
        ) : (
          <div className="space-y-3">
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
            if (id) return await update(id, data)
          }}
          onDelete={async (id) => {
            await remove(id)
          }}
        />
      )}
    </div>
  )
}
