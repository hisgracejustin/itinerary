"use client";

import { useState, useOptimistic, useTransition } from 'react'
import { useTripContext } from '../lib/trip-context'
import { createBooking, updateBooking, deleteBooking, upsertDayNote } from '@/lib/client-actions'
import MonthView from '../components/MonthView'
import MobileMonthView from '../components/MobileMonthView'
import WeekView from '../components/WeekView'
import DayView from '../components/DayView'
import BookingModal from '../components/BookingModal'

const VIEWS = ['month', 'week', 'day']

// Day notes are props-only (server-rendered), so a plain `await onUpsertDayNote()`
// then close-the-editor can flash blank for a frame or two: the save resolves
// before the revalidated RSC payload commits new props. Layer a small optimistic
// overlay (mirroring useTodoList.js) so the saved/deleted note is reflected the
// instant the editor closes, then reconciles silently once fresh props land.
// A day note is unique per (date, trip_id) — in the all-trips view the same date
// can carry both a tripless note and a trip's note, so the overlay must match the
// exact slot the server will touch (resolvedTripId), not every note on that date.
const sameSlot = (n, date, tripId) => n.date === date && (n.trip_id ?? null) === (tripId ?? null)

function dayNoteReducer(state, action) {
  switch (action.type) {
    case 'upsert': {
      const { date, trip_id } = action.note
      const exists = state.some((n) => sameSlot(n, date, trip_id))
      if (exists) return state.map((n) => (sameSlot(n, date, trip_id) ? { ...n, ...action.note } : n))
      return [...state, action.note]
    }
    case 'remove':
      return state.filter((n) => !sameSlot(n, action.date, action.trip_id))
    default:
      return state
  }
}

export default function Calendar({ initialBookings, initialTodos, initialDayNotes }) {
  const { selectedTrip, tripMeta, onOpenAdd } = useTripContext()
  const bookings = initialBookings
  const todos = initialTodos
  const [dayNotes, applyOptimisticDayNote] = useOptimistic(initialDayNotes, dayNoteReducer)
  const [, startDayNoteTransition] = useTransition()

  const [view, setView] = useState('month')
  // The component is remounted (keyed by trip) on trip change, so the initial
  // month is derived once here — jumping to the trip's start, or today otherwise.
  const [currentDate, setCurrentDate] = useState(() =>
    tripMeta?.start_date ? new Date(tripMeta.start_date + 'T00:00:00') : new Date()
  )
  const [calendarCollapsed, setCalendarCollapsed] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingBooking, setEditingBooking] = useState(null)

  const handleViewClick = (v) => {
    if (v === 'month' && view === 'month') {
      setCalendarCollapsed(!calendarCollapsed)
    } else {
      setView(v)
      setCalendarCollapsed(false)
    }
  }

  const openAddModal = () => {
    setEditingBooking(null)
    setModalOpen(true)
  }

  const openEditModal = (booking) => {
    setEditingBooking(booking)
    setModalOpen(true)
  }

  // Register the openAdd handler so the Header's "+" button can call it.
  if (onOpenAdd) onOpenAdd.current = openAddModal

  const handleUpsertDayNote = ({ date, title, trip_id }) => {
    const resolvedTripId = trip_id ?? selectedTrip ?? null
    const trimmed = title.trim()
    return new Promise((resolve, reject) => {
      startDayNoteTransition(async () => {
        try {
          if (trimmed) {
            applyOptimisticDayNote({ type: 'upsert', note: { id: `optimistic-${date}`, date, title: trimmed, trip_id: resolvedTripId } })
          } else {
            applyOptimisticDayNote({ type: 'remove', date, trip_id: resolvedTripId })
          }
          await upsertDayNote({ date, title, trip_id: resolvedTripId })
          resolve()
        } catch (err) {
          reject(err)
        }
      })
    })
  }

  const navigate = (direction) => {
    const d = new Date(currentDate)
    if (view === 'month') d.setMonth(d.getMonth() + direction)
    else if (view === 'week') d.setDate(d.getDate() + 7 * direction)
    else d.setDate(d.getDate() + direction)
    setCurrentDate(d)
  }

  const goToToday = () => setCurrentDate(new Date())

  const handleSelectDate = (date) => {
    setCurrentDate(date)
    setView('day')
  }

  const formatHeader = () => {
    const opts = { month: 'long', year: 'numeric' }
    if (view === 'day') return currentDate.toLocaleDateString(undefined, { ...opts, day: 'numeric', weekday: 'long' })
    return currentDate.toLocaleDateString(undefined, opts)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 shrink-0 gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg sm:text-xl font-medium text-on-surface">{formatHeader()}</h2>
          {tripMeta && (
            <span className="text-xs font-medium bg-primary-light text-primary px-3 py-1 rounded-full">
              {tripMeta.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={goToToday}
            className="mat-btn-outlined text-xs px-3 py-1.5"
          >
            Today
          </button>
          <button
            onClick={() => navigate(-1)}
            className="mat-icon-btn"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => navigate(1)}
            className="mat-icon-btn"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <div className="ml-3 flex bg-surface-container rounded-full p-1">
            {VIEWS.map((v) => (
              <button
                key={v}
                onClick={() => handleViewClick(v)}
                className={`px-3.5 py-1.5 text-xs rounded-full capitalize transition-all duration-200 flex items-center gap-1 font-medium ${
                  view === v
                    ? 'bg-white text-on-surface shadow-elevation-1'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-white/50'
                }`}
              >
                {v}
                {v === 'month' && view === 'month' && (
                  <svg
                    className={`w-3 h-3 transition-transform duration-200 ${calendarCollapsed ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 mat-surface overflow-hidden">
        {view === 'month' && (
          <>
            {/* Desktop: full month grid */}
            <div className="hidden sm:block h-full">
              <MonthView
                currentDate={currentDate}
                bookings={bookings}
                todos={todos}
                dayNotes={dayNotes}
                tripMeta={tripMeta}
                selectedTrip={selectedTrip}
                onSelectDate={handleSelectDate}
                onBookingClick={openEditModal}
                onUpsertDayNote={handleUpsertDayNote}
              />
            </div>
            {/* Mobile: compact calendar + agenda */}
            <div className="sm:hidden h-full">
              <MobileMonthView
                currentDate={currentDate}
                bookings={bookings}
                todos={todos}
                dayNotes={dayNotes}
                tripMeta={tripMeta}
                selectedTrip={selectedTrip}
                onSelectDate={handleSelectDate}
                onDayHighlight={(date) => setCurrentDate(date)}
                onBookingClick={openEditModal}
                onUpsertDayNote={handleUpsertDayNote}
                collapsed={calendarCollapsed}
                onCollapsedChange={setCalendarCollapsed}
              />
            </div>
          </>
        )}
        {view === 'week' && (
          <WeekView
            currentDate={currentDate}
            bookings={bookings}
            onSelectDate={handleSelectDate}
            onBookingClick={openEditModal}
          />
        )}
        {view === 'day' && (
          <DayView
            currentDate={currentDate}
            bookings={bookings}
            todos={todos}
            onBookingClick={openEditModal}
          />
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
            return id ? await updateBooking(id, data) : await createBooking(data)
          }}
          onDelete={async (id) => {
            await deleteBooking(id)
          }}
        />
      )}
    </div>
  )
}
