"use client";

import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react'
import { useTripContext } from '../lib/trip-context'
import { createBooking, updateBooking, deleteBooking, upsertDayNote, createDayReminder, updateDayReminder, deleteDayReminder, reorderDayReminders } from '@/lib/client-actions'
import MonthView from '../components/MonthView'
import MobileMonthView from '../components/MobileMonthView'
import WeekView from '../components/WeekView'
import DayView from '../components/DayView'
import JourneyView from '../components/JourneyView'
import BookingModal from '../components/BookingModal'
import { updateTrip } from '@/lib/client-actions'
import { useToast } from '../components/Toast'
import { friendlyError } from '../lib/friendlyError'

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

// Optimistic overlay for the per-day reminders list (add/edit/delete), mirroring
// the todo list. Reminders are keyed by id, so reconciliation is by id.
function dayReminderReducer(state, action) {
  switch (action.type) {
    case 'add':
      return [...state, action.reminder]
    case 'update':
      return state.map((r) => (r.id === action.id ? { ...r, ...action.patch } : r))
    case 'remove':
      return state.filter((r) => r.id !== action.id)
    case 'reorder': {
      // Assign each listed id its index as the new position; others unchanged.
      const pos = new Map(action.order.map((id, i) => [id, i]))
      return state.map((r) => (pos.has(r.id) ? { ...r, position: pos.get(r.id) } : r))
    }
    default:
      return state
  }
}

export default function Calendar({ initialBookings, initialTodos, initialDayNotes, initialDayReminders }) {
  const { selectedTrip, tripMeta, tripMetas, selectedTrips, spanStart, spanEnd } = useTripContext()
  const { toast } = useToast()
  // Props carry the union of every accessible trip's data; the current trip
  // selection (client state) filters it here. A toggle is one instant render.
  const selSet = useMemo(() => new Set(selectedTrips), [selectedTrips])
  const inSelection = (row) => selectedTrips.length === 0 || selSet.has(row.trip_id)
  const bookings = useMemo(() => initialBookings.filter(inSelection), [initialBookings, selSet]) // eslint-disable-line react-hooks/exhaustive-deps
  const todos = useMemo(() => initialTodos.filter(inSelection), [initialTodos, selSet]) // eslint-disable-line react-hooks/exhaustive-deps
  const [allDayNotes, applyOptimisticDayNote] = useOptimistic(initialDayNotes, dayNoteReducer)
  const [, startDayNoteTransition] = useTransition()
  const [allDayReminders, applyOptimisticReminder] = useOptimistic(initialDayReminders ?? [], dayReminderReducer)
  const [, startReminderTransition] = useTransition()
  const dayNotes = useMemo(() => allDayNotes.filter(inSelection), [allDayNotes, selSet]) // eslint-disable-line react-hooks/exhaustive-deps
  const dayReminders = useMemo(() => allDayReminders.filter(inSelection), [allDayReminders, selSet]) // eslint-disable-line react-hooks/exhaustive-deps

  // Journey span — earliest start → latest end across the selected trips. Journey
  // replaces the old Trip view: Trip view is just Journey with one trip selected.
  const journeyStart = spanStart ? new Date(spanStart + 'T00:00:00') : null
  const journeyEnd = spanEnd ? new Date(spanEnd + 'T00:00:00') : null
  const hasSpan = !!(journeyStart && journeyEnd)
  // Journey view disabled 2026-07-24 — Justin prefers Month (its day-select
  // detail panel) as the trip default, and switching defaults between views
  // caused a visible flash on trip toggles. Flip to re-enable: the timeline,
  // trip rails, collapsed gap runs, and gap-day "add to trip" actions all live
  // in JourneyView and come back with this flag.
  const JOURNEY_ENABLED = false
  const VIEWS = JOURNEY_ENABLED && hasSpan ? ['journey', 'month', 'week', 'day'] : ['month', 'week', 'day']

  // Trip toggles are plain state changes now — this component stays mounted,
  // so the chosen view simply persists. No storage, no URL, no remounts.
  const [view, setView] = useState('month')
  const persistView = setView
  const [currentDate, setCurrentDate] = useState(() =>
    spanStart ? new Date(spanStart + 'T00:00:00') : new Date()
  )
  // Jump to the selection's start when the selection changes (the one thing
  // the old remount-per-selection behavior did that we want to keep).
  const selKey = selectedTrips.join('+')
  const prevSelKey = useRef(selKey)
  useEffect(() => {
    if (prevSelKey.current === selKey) return
    prevSelKey.current = selKey
    if (spanStart) setCurrentDate(new Date(spanStart + 'T00:00:00'))
  }, [selKey, spanStart])
  const [calendarCollapsed, setCalendarCollapsed] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingBooking, setEditingBooking] = useState(null)

  const handleViewClick = (v) => {
    if (v === 'month' && view === 'month') {
      setCalendarCollapsed(!calendarCollapsed)
    } else {
      persistView(v)
      setCalendarCollapsed(false)
    }
  }

  const openEditModal = (booking) => {
    setEditingBooking(booking)
    setModalOpen(true)
  }

  const handleUpsertDayNote = ({ date, title, trip_id }) => {
    const resolvedTripId = trip_id ?? selectedTrip ?? null
    // Notes and reminders are trip-scoped (trip_id is NOT NULL) — with "All Trips"
    // selected there is no trip to attach them to.
    if (!resolvedTripId) return Promise.reject(new Error("Select a trip first to add notes"))
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

  // Reminder CRUD — optimistic, returning a promise so the inline editor knows
  // when to close (and can surface an error toast on failure).
  const handleAddReminder = ({ date, text, time, trip_id }) => {
    const resolvedTripId = trip_id ?? selectedTrip ?? null
    // Notes and reminders are trip-scoped (trip_id is NOT NULL) — with "All Trips"
    // selected there is no trip to attach them to.
    if (!resolvedTripId) return Promise.reject(new Error("Select a trip first to add notes"))
    const id = crypto.randomUUID()
    // Append to the end of this day's list (send the position the server will use
    // so the optimistic row lands where the persisted one will).
    const sameDay = dayReminders.filter((r) => r.date === date && (r.trip_id ?? null) === resolvedTripId)
    const position = sameDay.reduce((max, r) => Math.max(max, r.position ?? 0), -1) + 1
    return new Promise((resolve, reject) => {
      startReminderTransition(async () => {
        applyOptimisticReminder({ type: 'add', reminder: { id, date, text, time: time ?? null, trip_id: resolvedTripId, position, _pending: true } })
        try {
          await createDayReminder({ id, date, text, time: time ?? null, trip_id: resolvedTripId, position })
          resolve()
        } catch (err) {
          reject(err)
        }
      })
    })
  }

  const handleReorderReminders = (orderedIds) =>
    new Promise((resolve, reject) => {
      startReminderTransition(async () => {
        applyOptimisticReminder({ type: 'reorder', order: orderedIds })
        try {
          await reorderDayReminders(orderedIds)
          resolve()
        } catch (err) {
          reject(err)
        }
      })
    })

  const handleEditReminder = (id, { text, time }) =>
    new Promise((resolve, reject) => {
      startReminderTransition(async () => {
        applyOptimisticReminder({ type: 'update', id, patch: { text, time: time ?? null } })
        try {
          await updateDayReminder(id, { text, time: time ?? null })
          resolve()
        } catch (err) {
          reject(err)
        }
      })
    })

  const handleRemoveReminder = (id) =>
    new Promise((resolve, reject) => {
      startReminderTransition(async () => {
        applyOptimisticReminder({ type: 'remove', id })
        try {
          await deleteDayReminder(id)
          resolve()
        } catch (err) {
          reject(err)
        }
      })
    })

  const navigate = (direction) => {
    const d = new Date(currentDate)
    if (view === 'month') d.setMonth(d.getMonth() + direction)
    else if (view === 'week') d.setDate(d.getDate() + 7 * direction)
    else d.setDate(d.getDate() + direction)
    setCurrentDate(d)
  }

  const goToToday = () => setCurrentDate(new Date())

  // Reminder data + handlers, threaded into every view that renders days.
  const reminderProps = {
    dayReminders,
    onAddReminder: handleAddReminder,
    onEditReminder: handleEditReminder,
    onRemoveReminder: handleRemoveReminder,
    onReorderReminder: handleReorderReminders,
  }

  const handleSelectDate = (date) => {
    setCurrentDate(date)
    persistView('day')
  }

  // Gap-day action: extend a trip's start_date/end_date to cover uncovered days.
  // This is the same edit as changing dates in Settings (goes through the
  // WRITE_ROLES-guarded updateTrip action) — no extra confirmation, just a toast.
  // On success the layout revalidates, the span grows, and the gap closes.
  const handleExtendTrip = async (tripId, patch) => {
    try {
      await updateTrip(tripId, patch)
      toast.success('Trip dates updated')
    } catch (err) {
      toast.error(friendlyError(err))
    }
  }

  const formatHeader = () => {
    const opts = { month: 'long', year: 'numeric' }
    if (view === 'journey' && hasSpan) {
      const sameYear = journeyStart.getFullYear() === journeyEnd.getFullYear()
      const fmt = (d, withYear) =>
        d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) })
      return `${fmt(journeyStart, !sameYear)} – ${fmt(journeyEnd, true)}`
    }
    if (view === 'day') return currentDate.toLocaleDateString(undefined, { ...opts, day: 'numeric', weekday: 'long' })
    return currentDate.toLocaleDateString(undefined, opts)
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 shrink-0 gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-semibold tracking-tight text-on-surface">{formatHeader()}</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Journey view spans the whole selection, so month paging doesn't apply. */}
          {view !== 'journey' && (
            <>
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
            </>
          )}
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
        {JOURNEY_ENABLED && view === 'journey' && hasSpan && (
          <JourneyView
            bookings={bookings}
            todos={todos}
            dayNotes={dayNotes}
            dayReminders={dayReminders}
            tripMetas={tripMetas}
            spanStart={journeyStart}
            spanEnd={journeyEnd}
            onSelectDate={handleSelectDate}
            onBookingClick={openEditModal}
            onUpsertDayNote={handleUpsertDayNote}
            onAddReminder={reminderProps.onAddReminder}
            onEditReminder={reminderProps.onEditReminder}
            onRemoveReminder={reminderProps.onRemoveReminder}
            onReorderReminder={reminderProps.onReorderReminder}
            onExtendTrip={handleExtendTrip}
          />
        )}
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
                spanStart={journeyStart}
                spanEnd={journeyEnd}
                onSelectDate={handleSelectDate}
                onBookingClick={openEditModal}
                onUpsertDayNote={handleUpsertDayNote}
                {...reminderProps}
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
                spanStart={journeyStart}
                spanEnd={journeyEnd}
                onSelectDate={handleSelectDate}
                onDayHighlight={(date) => setCurrentDate(date)}
                onBookingClick={openEditModal}
                onUpsertDayNote={handleUpsertDayNote}
                collapsed={calendarCollapsed}
                onCollapsedChange={setCalendarCollapsed}
                {...reminderProps}
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
            selectedTrip={selectedTrip}
            onBookingClick={openEditModal}
            {...reminderProps}
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
