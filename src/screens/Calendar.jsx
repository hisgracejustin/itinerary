"use client";

import { useState, useEffect } from 'react'
import { useTripContext } from '../lib/trip-context'
import { useBookings } from '../hooks/useBookings'
import { useTodos } from '../hooks/useTodos'
import { useDayNotes } from '../hooks/useDayNotes'
import MonthView from '../components/MonthView'
import MobileMonthView from '../components/MobileMonthView'
import WeekView from '../components/WeekView'
import DayView from '../components/DayView'
import BookingModal from '../components/BookingModal'
import Spinner from '../components/Spinner'
import { useToast } from '../components/Toast'

const VIEWS = ['month', 'week', 'day']

export default function Calendar() {
  const { selectedTrip, tripMeta, onOpenAdd } = useTripContext()
  const [view, setView] = useState('month')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [calendarCollapsed, setCalendarCollapsed] = useState(false)
  const { bookings, loading, error, add, update, remove } = useBookings(selectedTrip)
  const { todos } = useTodos(selectedTrip)
  const { dayNotes, upsert: upsertDayNote } = useDayNotes(selectedTrip)
  const { toast } = useToast()
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

  // Show toast when error occurs
  useEffect(() => {
    if (error) toast.error('Failed to load bookings: ' + error)
  }, [error])

  // Jump to the trip's start month when a trip is selected, or today when deselected
  useEffect(() => {
    if (tripMeta?.start_date) {
      setCurrentDate(new Date(tripMeta.start_date + 'T00:00:00'))
    } else {
      setCurrentDate(new Date())
    }
  }, [selectedTrip, tripMeta])

  // Expose open-add to Layout via ref-like pattern
  // Layout calls onOpenAdd which sets this
  const openAddModal = () => {
    setEditingBooking(null)
    setModalOpen(true)
  }

  const openEditModal = (booking) => {
    setEditingBooking(booking)
    setModalOpen(true)
  }

  // Register the openAdd handler so Header can call it
  if (onOpenAdd) onOpenAdd.current = openAddModal

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
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center gap-3">
            <Spinner size="lg" />
            <span className="text-sm text-on-surface-variant">Loading bookings...</span>
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center gap-3">
            <svg className="w-8 h-8 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-red-500">Failed to load bookings</span>
            <p className="text-xs text-on-surface-variant">{error}</p>
          </div>
        ) : (
          <>
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
                    onSelectDate={handleSelectDate}
                    onBookingClick={openEditModal}
                    onUpsertDayNote={upsertDayNote}
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
                    onSelectDate={handleSelectDate}                    onDayHighlight={(date) => setCurrentDate(date)}                    onBookingClick={openEditModal}
                    onUpsertDayNote={upsertDayNote}
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
          </>
        )}
      </div>

      {modalOpen && (
        <BookingModal
          booking={editingBooking}
          selectedTrip={selectedTrip}
          tripName={tripMeta?.name}
          onClose={() => setModalOpen(false)}
          onSave={async (data) => {
            if (editingBooking) {
              await update(editingBooking.id, data)
            } else {
              await add(data)
            }
          }}
          onDelete={async (id) => {
            await remove(id)
          }}
        />
      )}
    </div>
  )
}
