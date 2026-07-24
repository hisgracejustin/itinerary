import { useState, useEffect, useRef } from 'react'
import { getMonthGrid, getBookingsForDate, isSameDay, hasOvernightCoverage, getStayEdge, TYPE_ICONS, getRentalIcon } from '../lib/calendar'
import BookingChip from './BookingChip'
import BookingCard from './BookingCard'
import DayReminders from './DayReminders'
import useMediaQuery from '../hooks/useMediaQuery'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_CHIPS = 4

// Timezone-safe local date string (YYYY-MM-DD) — matches MobileMonthView so day
// notes written on either view resolve to the same key (avoids a UTC off-by-one).
function toLocalDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Sort bookings: check-outs first, then normal by time, then check-ins last
function sortBookingsForDay(dayBookings, day) {
  const viewDay = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  const getCategory = (bk) => {
    if (!bk.end_date) return 1
    const start = new Date(bk.start_date)
    const end = new Date(bk.end_date)
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
    if (endDay > startDay && viewDay.getTime() === endDay.getTime()) return 0 // check-out/arrive
    if (endDay > startDay && viewDay.getTime() === startDay.getTime()) return 2 // check-in/depart
    return 1
  }
  return [...dayBookings].sort((a, b) => {
    const catA = getCategory(a)
    const catB = getCategory(b)
    if (catA !== catB) return catA - catB
    const timeA = catA === 0 ? new Date(a.end_date).getTime() : new Date(a.start_date).getTime()
    const timeB = catB === 0 ? new Date(b.end_date).getTime() : new Date(b.start_date).getTime()
    return timeA - timeB
  })
}

export default function MonthView({ currentDate, days: propDays, bookings, todos = [], dayNotes = [], dayReminders = [], tripMeta, selectedTrip, spanStart, spanEnd, onSelectDate, onBookingClick, onUpsertDayNote, onAddReminder, onEditReminder, onRemoveReminder, onReorderReminder }) {
  // Wide desktop → show the agenda side panel and select-a-day inline; below that
  // width the panel is hidden and clicking a day navigates to the Day view.
  const isWide = useMediaQuery('(min-width: 1024px)')
  const [selectedDay, setSelectedDay] = useState(currentDate)
  const [editingNoteDate, setEditingNoteDate] = useState(null)
  const [noteText, setNoteText] = useState('')

  // Day panel: user-resizable width + collapse, persisted so it sticks across
  // day/trip switches and reloads. Clamped to a sensible range.
  const PANEL_MIN = 280
  const PANEL_MAX = 640
  const [panelWidth, setPanelWidth] = useState(360)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const asideRef = useRef(null)
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem('calendar.agendaWidth'))
      if (w >= PANEL_MIN && w <= PANEL_MAX) setPanelWidth(w)
      setPanelCollapsed(localStorage.getItem('calendar.agendaCollapsed') === '1')
    } catch { /* localStorage unavailable — use defaults */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('calendar.agendaWidth', String(panelWidth)) } catch { /* ignore */ }
  }, [panelWidth])
  useEffect(() => {
    try { localStorage.setItem('calendar.agendaCollapsed', panelCollapsed ? '1' : '0') } catch { /* ignore */ }
  }, [panelCollapsed])

  const startResize = (e) => {
    e.preventDefault()
    // The panel is right-anchored, so width = (its fixed right edge) − pointer X.
    const right = asideRef.current?.getBoundingClientRect().right ?? window.innerWidth
    const onMove = (ev) => setPanelWidth(Math.min(PANEL_MAX, Math.max(PANEL_MIN, right - ev.clientX)))
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  // Trip view passes an explicit multi-week span; month view derives its grid.
  const rangeMode = !!propDays
  const days = propDays ?? getMonthGrid(year, month)
  const today = new Date()

  // Anchor the agenda's selected day to the trip start when a single trip is
  // picked. Deliberately nothing else: growing the selection to several trips
  // (selectedTrip → null) or clearing it must NOT yank the panel to today —
  // whatever day is showing just stays.
  useEffect(() => {
    if (selectedTrip && tripMeta?.start_date) {
      setSelectedDay(new Date(tripMeta.start_date + 'T00:00:00'))
    }
  }, [selectedTrip, tripMeta?.start_date])

  // Trip date range (if a trip with dates is selected)
  const tripStart = tripMeta?.start_date ? new Date(tripMeta.start_date + 'T00:00:00') : null
  const tripEnd = tripMeta?.end_date ? new Date(tripMeta.end_date + 'T23:59:59') : null

  const isOutsideTrip = (day) => {
    if (!tripStart || !tripEnd) return false
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate())
    return d < tripStart || d > tripEnd
  }

  // Completed to-dos are hidden from the month grid to save space — they still
  // show in the day-detail panel and the to-do list.
  const getTodosForDate = (date) => {
    return todos.filter((t) => {
      if (t.status === 'done') return false
      if (!t.due_date) return false
      return isSameDay(new Date(t.due_date + 'T00:00:00'), date)
    })
  }

  // A day tap selects it (wide) or opens Day view (narrow).
  const handleDayActivate = (day) => {
    if (isWide) setSelectedDay(day)
    else onSelectDate(day)
  }

  return (
    <div className="h-full flex">
      {/* Calendar grid column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-outline/40 shrink-0">
          {DAY_NAMES.map((name) => (
            <div key={name} className="py-2 text-center text-[11px] font-medium text-on-surface-variant uppercase tracking-wide">
              {name}
            </div>
          ))}
        </div>

        {/* Scrollable day grid */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-7 auto-rows-[minmax(116px,auto)]">
            {days.map((day, i) => {
              const isToday = isSameDay(day, today)
              const outsideTrip = isOutsideTrip(day)
              // "In view" = belongs to the displayed month, or (in trip view) falls
              // within the trip. Week-padding days outside that render as blanks.
              const inView = rangeMode ? !outsideTrip : day.getMonth() === month

              if (!inView && (!tripMeta || outsideTrip)) {
                return <div key={i} className="border-b border-r border-outline/20" />
              }

              const dayBookings = sortBookingsForDay(getBookingsForDate(bookings, day), day)
              const dayTodos = getTodosForDate(day)
              const dateStr = toLocalDateStr(day)
              const dayNote = dayNotes.find((n) => n.date === dateStr)
              const isEditingThis = editingNoteDate === dateStr
              const isSelected = isWide && isSameDay(day, selectedDay)

              return (
                <div
                  key={i}
                  onClick={() => handleDayActivate(day)}
                  className={`group border-b border-r border-outline/20 p-1.5 cursor-pointer transition-colors duration-150 ${
                    isSelected ? 'bg-primary-light/60 ring-1 ring-inset ring-primary/40' : 'hover:bg-primary-light/30'
                  } ${outsideTrip ? 'bg-surface-container/50 opacity-40' : ''}`}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span
                      className={`text-xs w-6 h-6 flex items-center justify-center rounded-full transition-colors ${
                        isToday
                          ? 'bg-primary text-white font-medium'
                          : 'text-on-surface-variant'
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    {/* Add note button */}
                    {!isEditingThis && !dayNote && onUpsertDayNote && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingNoteDate(dateStr); setNoteText('') }}
                        className="text-outline hover:text-on-surface-variant transition-colors duration-150 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                        title="Add day title"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Day note / title */}
                  {isEditingThis ? (
                    <form
                      className="mb-1"
                      onClick={(e) => e.stopPropagation()}
                      onSubmit={async (e) => {
                        e.preventDefault()
                        await onUpsertDayNote?.({ date: dateStr, title: noteText })
                        setEditingNoteDate(null)
                      }}
                    >
                      <input
                        type="text"
                        autoFocus
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        onBlur={async () => {
                          await onUpsertDayNote?.({ date: dateStr, title: noteText })
                          setEditingNoteDate(null)
                        }}
                        placeholder="Day title"
                        className="w-full px-1.5 py-0.5 text-[10px] italic text-on-surface-variant bg-surface-container border-0 rounded focus:outline-none focus:ring-1 focus:ring-primary/30"
                      />
                    </form>
                  ) : dayNote ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingNoteDate(dateStr); setNoteText(dayNote.title) }}
                      className="text-[10px] italic text-on-surface-variant mb-1 block truncate hover:text-primary transition-colors duration-150 max-w-full"
                    >
                      {dayNote.title}
                    </button>
                  ) : null}

                  {onAddReminder && (
                    <div className="mb-1">
                      <DayReminders
                        reminders={dayReminders.filter((r) => r.date === dateStr)}
                        date={dateStr}
                        tripId={selectedTrip ?? null}
                        onAdd={onAddReminder}
                        onEdit={onEditReminder}
                        onRemove={onRemoveReminder}
                        onReorder={onReorderReminder}
                        variant="cell"
                      />
                    </div>
                  )}

                  <div className="space-y-0.5">
                    {/* Hotel mid-stay chips */}
                    {dayBookings.filter((b) => {
                      if (b.type !== 'hotel' || !b.end_date) return false
                      const details = typeof b.details === 'string' ? (() => { try { return JSON.parse(b.details) } catch { return {} } })() : (b.details || {})
                      const start = new Date(b.start_date)
                      const end = new Date(b.end_date)
                      const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
                      const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
                      const viewDay = new Date(day.getFullYear(), day.getMonth(), day.getDate())
                      if (endDay <= startDay) return false
                      // Informal stays: chip on all days (not check-out)
                      if (details.informal) return viewDay.getTime() !== endDay.getTime()
                      // Regular hotels: chip on middle days only
                      return viewDay.getTime() !== endDay.getTime() && viewDay.getTime() !== startDay.getTime()
                    }).map((b) => {
                      const start = new Date(b.start_date)
                      const end = new Date(b.end_date)
                      const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
                      const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
                      const viewDay = new Date(day.getFullYear(), day.getMonth(), day.getDate())
                      const totalNights = Math.round((endDay - startDay) / (1000 * 60 * 60 * 24))
                      const nightNumber = Math.round((viewDay - startDay) / (1000 * 60 * 60 * 24)) + 1
                      return (
                        <button
                          key={b.id}
                          onClick={(e) => { e.stopPropagation(); onBookingClick?.(b) }}
                          className="w-full text-left inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-medium hover:bg-amber-200 transition-colors truncate"
                        >
                          🏡 {b.title}
                          <span className="text-amber-600 font-normal ml-auto shrink-0">{nightNumber}/{totalNights}</span>
                        </button>
                      )
                    })}
                    {/* Cruise mid-stay chips */}
                    {dayBookings.filter((b) => {
                      if (b.type !== 'cruise' || !b.end_date) return false
                      const start = new Date(b.start_date)
                      const end = new Date(b.end_date)
                      const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
                      const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
                      const viewDay = new Date(day.getFullYear(), day.getMonth(), day.getDate())
                      return endDay > startDay && viewDay.getTime() !== endDay.getTime() && viewDay.getTime() !== startDay.getTime()
                    }).map((b) => {
                      const start = new Date(b.start_date)
                      const end = new Date(b.end_date)
                      const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
                      const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
                      const viewDay = new Date(day.getFullYear(), day.getMonth(), day.getDate())
                      const totalNights = Math.round((endDay - startDay) / (1000 * 60 * 60 * 24))
                      const nightNumber = Math.round((viewDay - startDay) / (1000 * 60 * 60 * 24)) + 1
                      return (
                        <button
                          key={b.id}
                          onClick={(e) => { e.stopPropagation(); onBookingClick?.(b) }}
                          className="w-full text-left inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-medium hover:bg-purple-200 transition-colors truncate"
                        >
                          🚢 On board
                          <span className="text-purple-600 font-normal ml-auto shrink-0">{nightNumber}/{totalNights}</span>
                        </button>
                      )
                    })}
                    {/* Rental mid-stay chips */}
                    {dayBookings.filter((b) => {
                      if (b.type !== 'rental' || !b.end_date) return false
                      const start = new Date(b.start_date)
                      const end = new Date(b.end_date)
                      const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
                      const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
                      const viewDay = new Date(day.getFullYear(), day.getMonth(), day.getDate())
                      return endDay > startDay && viewDay.getTime() !== endDay.getTime() && viewDay.getTime() !== startDay.getTime()
                    }).map((b) => {
                      const details = typeof b.details === 'string' ? (() => { try { return JSON.parse(b.details) } catch { return {} } })() : (b.details || {})
                      const start = new Date(b.start_date)
                      const end = new Date(b.end_date)
                      const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
                      const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
                      const viewDay = new Date(day.getFullYear(), day.getMonth(), day.getDate())
                      const totalDays = Math.round((endDay - startDay) / (1000 * 60 * 60 * 24))
                      const dayNumber = Math.round((viewDay - startDay) / (1000 * 60 * 60 * 24)) + 1
                      return (
                        <button
                          key={b.id}
                          onClick={(e) => { e.stopPropagation(); onBookingClick?.(b) }}
                          className="w-full text-left inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[10px] font-medium hover:bg-indigo-200 transition-colors truncate"
                        >
                          {getRentalIcon(details)} {b.title}
                          <span className="text-indigo-600 font-normal ml-auto shrink-0">{dayNumber}/{totalDays}</span>
                        </button>
                      )
                    })}
                    {/* Overnight flight/train/bus chip */}
                    {dayBookings.filter((b) => {
                      if (b.type !== 'flight' && b.type !== 'train' && b.type !== 'bus') return false
                      if (!b.end_date) return false
                      const start = new Date(b.start_date)
                      const end = new Date(b.end_date)
                      const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
                      const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
                      const viewDay = new Date(day.getFullYear(), day.getMonth(), day.getDate())
                      return endDay > startDay && viewDay.getTime() === startDay.getTime()
                    }).map((b) => {
                      const typeIcon = TYPE_ICONS[b.type] || '📌'
                      const chipColors = b.type === 'flight'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-emerald-100 text-emerald-800'
                      return (
                        <span
                          key={`overnight-${b.id}`}
                          className={`w-full inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${chipColors} truncate`}
                        >
                          {typeIcon} Overnight
                        </span>
                      )
                    })}
                    {/* No accommodation warning — bounded by the whole journey
                        span (union of selected trips), so a night covered by
                        another selected trip's hotel doesn't false-warn. */}
                    {spanStart && spanEnd && (() => {
                      const viewDay = new Date(day.getFullYear(), day.getMonth(), day.getDate())
                      const spanStartDay = new Date(spanStart.getFullYear(), spanStart.getMonth(), spanStart.getDate())
                      const spanEndDay = new Date(spanEnd.getFullYear(), spanEnd.getMonth(), spanEnd.getDate())
                      if (viewDay < spanStartDay || viewDay >= spanEndDay) return null
                      if (!hasOvernightCoverage(bookings, day)) {
                        return (
                          <div className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-500 text-[10px]" title="No accommodation booked">
                            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="font-medium truncate">No stay</span>
                          </div>
                        )
                      }
                      return null
                    })()}
                    {/* Todos */}
                    {dayTodos.map((todo) => (
                      <div key={todo.id} className="flex items-center gap-1 px-1 py-0.5">
                        <span className={`w-3 h-3 rounded-sm border flex items-center justify-center text-[8px] shrink-0 ${
                          todo.status === 'done' ? 'bg-primary/10 border-primary/30 text-primary' : 'border-gray-300'
                        }`}>
                          {todo.status === 'done' && '✓'}
                        </span>
                        <span className={`text-[11px] truncate ${todo.status === 'done' ? 'line-through text-on-surface-variant' : 'text-on-surface'}`}>
                          {todo.title}
                        </span>
                      </div>
                    ))}
                    {/* Bookings (excluding hotel/rental mid-stay + informal) */}
                    {(() => {
                      const visible = dayBookings.filter((b) => {
                        if ((b.type !== 'hotel' && b.type !== 'rental') || !b.end_date) return true
                        const details = typeof b.details === 'string' ? (() => { try { return JSON.parse(b.details) } catch { return {} } })() : (b.details || {})
                        const start = new Date(b.start_date)
                        const end = new Date(b.end_date)
                        const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
                        const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
                        const viewDay = new Date(day.getFullYear(), day.getMonth(), day.getDate())
                        if (endDay <= startDay) return true
                        if (b.type === 'hotel' && details.informal) return false
                        return !(viewDay.getTime() !== endDay.getTime() && viewDay.getTime() !== startDay.getTime())
                      })
                      return (
                        <>
                          {visible.slice(0, MAX_CHIPS).map((booking) => (
                            <BookingChip
                              key={booking.id}
                              booking={booking}
                              compact
                              stayEdge={getStayEdge(booking, day)}
                              onClick={(b) => { onBookingClick?.(b) }}
                            />
                          ))}
                          {visible.length > MAX_CHIPS && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDayActivate(day) }}
                              className="text-[11px] text-primary font-medium px-1.5 hover:underline"
                            >
                              +{visible.length - MAX_CHIPS} more
                            </button>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Agenda side panel (wide desktop only) — resizable + collapsible */}
      {isWide && (panelCollapsed ? (
        <div className="w-10 shrink-0 border-l border-outline/40 bg-surface-dim/40 flex flex-col items-center justify-center">
          <button
            onClick={() => setPanelCollapsed(false)}
            title="Show day panel"
            aria-label="Show day panel"
            className="h-10 w-5 flex items-center justify-center rounded-full bg-white border border-outline/40 shadow-elevation-1 text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      ) : (
        <aside
          ref={asideRef}
          style={{ width: panelWidth }}
          className="relative shrink-0 border-l border-outline/40 bg-surface-dim/40 flex flex-col"
        >
          {/* Drag-to-resize handle along the left edge */}
          <div
            onPointerDown={startResize}
            title="Drag to resize"
            className="absolute left-0 top-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-primary/25 active:bg-primary/40 transition-colors z-20"
          />
          {/* Collapse tab, centered on the border so it clears the header text */}
          <button
            onClick={() => setPanelCollapsed(true)}
            title="Collapse day panel"
            aria-label="Collapse day panel"
            className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 h-10 w-5 flex items-center justify-center rounded-full bg-white border border-outline/40 shadow-elevation-1 text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <AgendaPanel
            key={toLocalDateStr(selectedDay)}
            day={selectedDay}
            bookings={bookings}
            todos={todos}
            dayNotes={dayNotes}
            dayReminders={dayReminders}
            selectedTrip={selectedTrip}
            onBookingClick={onBookingClick}
            onUpsertDayNote={onUpsertDayNote}
            onAddReminder={onAddReminder}
            onEditReminder={onEditReminder}
            onRemoveReminder={onRemoveReminder}
            onReorderReminder={onReorderReminder}
            onOpenDay={() => onSelectDate(selectedDay)}
          />
        </aside>
      ))}
    </div>
  )
}

/** Rich schedule for the selected day — the desktop equivalent of the mobile agenda. */
function AgendaPanel({ day, bookings, todos, dayNotes, dayReminders = [], selectedTrip, onBookingClick, onUpsertDayNote, onAddReminder, onEditReminder, onRemoveReminder, onReorderReminder, onOpenDay }) {
  const [editingNote, setEditingNote] = useState(false)
  const [noteText, setNoteText] = useState('')

  const dateStr = toLocalDateStr(day)
  const dayNote = dayNotes.find((n) => n.date === dateStr)
  const dayRems = dayReminders.filter((r) => r.date === dateStr)
  const dayBookings = sortBookingsForDay(getBookingsForDate(bookings, day), day)
  const dayTodos = todos.filter((t) => t.due_date && isSameDay(new Date(t.due_date + 'T00:00:00'), day))
  const isToday = isSameDay(day, new Date())

  const saveNote = async () => {
    await onUpsertDayNote?.({ date: dateStr, title: noteText })
    setEditingNote(false)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-outline/30 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] text-on-surface-variant uppercase tracking-wide">
              {day.toLocaleDateString(undefined, { weekday: 'long' })}
            </div>
            <div className="text-lg font-medium text-on-surface flex items-center gap-2">
              {day.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
              {isToday && (
                <span className="text-[10px] bg-primary-light text-primary px-2 py-0.5 rounded-full font-medium">Today</span>
              )}
            </div>
          </div>
          <button onClick={onOpenDay} className="mat-btn-outlined text-xs px-3 py-1.5 shrink-0" title="Open day view">
            Open day
          </button>
        </div>

        {/* Day title / note */}
        {editingNote ? (
          <form
            className="mt-2"
            onSubmit={(e) => { e.preventDefault(); saveNote() }}
          >
            <input
              type="text"
              autoFocus
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onBlur={saveNote}
              placeholder="Day title (optional)"
              className="w-full px-3 py-1.5 text-xs italic text-on-surface-variant bg-surface-container border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </form>
        ) : dayNote ? (
          <button
            onClick={() => { setEditingNote(true); setNoteText(dayNote.title) }}
            className="mt-1.5 text-xs italic text-on-surface-variant hover:text-primary transition-colors block truncate max-w-full text-left"
          >
            {dayNote.title}
          </button>
        ) : onUpsertDayNote ? (
          <button
            onClick={() => { setEditingNote(true); setNoteText('') }}
            className="mt-1.5 inline-flex items-center gap-1 text-xs text-on-surface-variant/70 hover:text-primary transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add day title
          </button>
        ) : null}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {onAddReminder && (
          <DayReminders
            reminders={dayRems}
            date={dateStr}
            tripId={selectedTrip ?? null}
            onAdd={onAddReminder}
            onEdit={onEditReminder}
            onRemove={onRemoveReminder}
            onReorder={onReorderReminder}
            variant="panel"
          />
        )}

        {dayTodos.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-2">To-dos</div>
            <ul className="space-y-1.5">
              {dayTodos.map((todo) => (
                <li key={todo.id} className="flex items-center gap-2.5">
                  <span className={`w-4 h-4 rounded-md border flex items-center justify-center text-[10px] shrink-0 ${
                    todo.status === 'done' ? 'bg-primary/10 border-primary/30 text-primary' : 'border-gray-300'
                  }`}>
                    {todo.status === 'done' && '✓'}
                  </span>
                  <span className={`text-sm ${todo.status === 'done' ? 'line-through text-on-surface-variant' : 'text-on-surface'}`}>
                    {todo.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {dayBookings.length === 0 ? (
          dayTodos.length === 0 && dayRems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-on-surface-variant">
              <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center mb-3">
                <svg className="w-6 h-6 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm font-medium">Nothing planned</p>
            </div>
          )
        ) : (
          <div className="space-y-2.5">
            {dayBookings.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                onClick={onBookingClick}
                hideTrip
                displayDate={day}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
