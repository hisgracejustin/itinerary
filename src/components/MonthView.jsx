import { useState } from 'react'
import { getMonthGrid, getBookingsForDate, isSameDay, hasOvernightCoverage, TYPE_ICONS } from '../lib/calendar'
import BookingChip from './BookingChip'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

export default function MonthView({ currentDate, bookings, todos = [], dayNotes = [], tripMeta, onSelectDate, onBookingClick, onUpsertDayNote }) {
  const [editingNoteDate, setEditingNoteDate] = useState(null)
  const [noteText, setNoteText] = useState('')

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const days = getMonthGrid(year, month)
  const today = new Date()

  // Trip date range (if a trip with dates is selected)
  const tripStart = tripMeta?.start_date ? new Date(tripMeta.start_date + 'T00:00:00') : null
  const tripEnd = tripMeta?.end_date ? new Date(tripMeta.end_date + 'T23:59:59') : null

  const isOutsideTrip = (day) => {
    if (!tripStart || !tripEnd) return false
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate())
    return d < tripStart || d > tripEnd
  }

  const getTodosForDate = (date) => {
    return todos.filter((t) => {
      if (!t.due_date) return false
      return isSameDay(new Date(t.due_date + 'T00:00:00'), date)
    })
  }

  return (
    <div className="h-full flex flex-col">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-outline/40">
        {DAY_NAMES.map((name) => (
          <div key={name} className="py-2 text-center text-[11px] font-medium text-on-surface-variant uppercase tracking-wide">
            {name}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 flex-1 auto-rows-fr">
        {days.map((day, i) => {
          const isCurrentMonth = day.getMonth() === month
          const isToday = isSameDay(day, today)
          const outsideTrip = isOutsideTrip(day)

          if (!isCurrentMonth && (!tripMeta || outsideTrip)) {
            return <div key={i} className="border-b border-r border-outline/20 min-h-[80px]" />
          }

          const dayBookings = sortBookingsForDay(getBookingsForDate(bookings, day), day)
          const dayTodos = getTodosForDate(day)
          const dateStr = day.toISOString().split('T')[0]
          const dayNote = dayNotes.find((n) => n.date === dateStr)
          const isEditingThis = editingNoteDate === dateStr

          return (
            <div
              key={i}
              onClick={() => onSelectDate(day)}
              className={`group border-b border-r border-outline/20 p-1.5 min-h-[80px] cursor-pointer hover:bg-primary-light/30 transition-colors duration-150 ${outsideTrip ? 'bg-surface-container/50 opacity-40' : ''}`}
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
                    className="text-outline hover:text-on-surface-variant transition-colors duration-150 opacity-0 group-hover:opacity-100"
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

              <div className="space-y-0.5 overflow-hidden">
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
                {/* No accommodation warning */}
                {tripMeta?.start_date && tripMeta?.end_date && (() => {
                  const viewDay = new Date(day.getFullYear(), day.getMonth(), day.getDate())
                  const tripEndDay = new Date(tripMeta.end_date + 'T00:00:00')
                  const tripStartDay = new Date(tripMeta.start_date + 'T00:00:00')
                  if (viewDay < tripStartDay || viewDay >= tripEndDay) return null
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
                      todo.completed ? 'bg-primary/10 border-primary/30 text-primary' : 'border-gray-300'
                    }`}>
                      {todo.completed && '✓'}
                    </span>
                    <span className={`text-[11px] truncate ${todo.completed ? 'line-through text-on-surface-variant' : 'text-on-surface'}`}>
                      {todo.title}
                    </span>
                  </div>
                ))}
                {/* Bookings (excluding hotel mid-stay/informal) */}
                {dayBookings.filter((b) => {
                  if (b.type !== 'hotel' || !b.end_date) return true
                  const details = typeof b.details === 'string' ? (() => { try { return JSON.parse(b.details) } catch { return {} } })() : (b.details || {})
                  const start = new Date(b.start_date)
                  const end = new Date(b.end_date)
                  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
                  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
                  const viewDay = new Date(day.getFullYear(), day.getMonth(), day.getDate())
                  if (endDay <= startDay) return true
                  // Informal: never show as full card
                  if (details.informal) return false
                  // Regular: hide on middle days only
                  return !(viewDay.getTime() !== endDay.getTime() && viewDay.getTime() !== startDay.getTime())
                }).slice(0, 3).map((booking) => (
                  <BookingChip
                    key={booking.id}
                    booking={booking}
                    compact
                    onClick={(b) => { onBookingClick?.(b) }}
                  />
                ))}
                {dayBookings.length > 3 && (
                  <div className="text-[11px] text-primary font-medium px-1.5 cursor-pointer hover:underline">
                    +{dayBookings.length - 3} more
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
