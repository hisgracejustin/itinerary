import { getBookingsForDate, getHour, TYPE_COLORS, TYPE_ICONS, isSameDay } from '../lib/calendar'
import BookingCard from './BookingCard'
import DayReminders from './DayReminders'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

export default function DayView({ currentDate, bookings, todos = [], dayReminders = [], selectedTrip, onBookingClick, onAddReminder, onEditReminder, onRemoveReminder, onReorderReminder }) {
  const dayBookings = getBookingsForDate(bookings, currentDate)

  // Get todos for this day (due_date matches or no due_date)
  const dayTodos = todos.filter((t) => {
    if (!t.due_date) return false
    return isSameDay(new Date(t.due_date + 'T00:00:00'), currentDate)
  })

  const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`
  const dayRems = dayReminders.filter((r) => r.date === dateStr)

  // All-day events (multi-day bookings on intermediate days, plus hotels on check-in day)
  const allDay = dayBookings.filter((b) => {
    if (!b.end_date) return false
    const start = new Date(b.start_date)
    const end = new Date(b.end_date)
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
    if (endDay <= startDay) return false
    const viewDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate())
    // Hotels: show as all-day on check-in day and middle days (not check-out)
    if (b.type === 'hotel') {
      return viewDay.getTime() !== endDay.getTime()
    }
    // Other types: all-day only on middle days
    if (viewDay.getTime() === startDay.getTime()) return false
    if (viewDay.getTime() === endDay.getTime()) return false
    return true
  })

  // For hotels on check-in day, also show as a timed event (unless informal)
  const allDayOnlyIds = new Set(
    allDay.filter((b) => {
      if (b.type === 'hotel') {
        const details = typeof b.details === 'string' ? (() => { try { return JSON.parse(b.details) } catch { return {} } })() : (b.details || {})
        // Informal stays are always chip-only
        if (details.informal) return true
        const start = new Date(b.start_date)
        const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
        const viewDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate())
        // On check-in day, hotel appears in both — so it's NOT "all-day only"
        if (viewDay.getTime() === startDay.getTime()) return false
      }
      return true
    }).map((b) => b.id)
  )

  // Group bookings by hour (excluding all-day-only ones)
  const bookingsByHour = {}
  dayBookings.forEach((b) => {
    if (allDayOnlyIds.has(b.id)) return
    // On check-out day, use end_date hour instead of start_date hour
    const start = new Date(b.start_date)
    const end = b.end_date ? new Date(b.end_date) : null
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    const endDay = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate()) : null
    const viewDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate())
    const isCheckoutDay = endDay && endDay.getTime() !== startDay.getTime() && viewDay.getTime() === endDay.getTime()
    const hour = isCheckoutDay ? end.getHours() : getHour(b.start_date)
    if (!bookingsByHour[hour]) bookingsByHour[hour] = []
    bookingsByHour[hour].push(b)
  })

  // Empty state
  if (dayBookings.length === 0 && dayTodos.length === 0 && dayRems.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-on-surface-variant">
        <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4">
          <svg className="w-8 h-8 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-sm font-medium">No bookings for this day</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Reminders / notes for this day */}
      {onAddReminder && (
        <div className="border-b border-outline/30 p-3 sm:p-4 shrink-0">
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
        </div>
      )}

      {/* Todos for this day */}
      {dayTodos.length > 0 && (
        <div className="border-b border-outline/30 p-3 sm:p-4 shrink-0">
          <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-2">To-dos</div>
          <ul className="space-y-2">
            {dayTodos.map((todo) => (
              <li key={todo.id} className="flex items-center gap-2.5">
                <span className={`w-4 h-4 rounded-md border flex items-center justify-center text-[10px] ${
                  todo.completed ? 'bg-primary/10 border-primary/30 text-primary' : 'border-gray-300'
                }`}>
                  {todo.completed && '✓'}
                </span>
                <span className={`text-sm ${todo.completed ? 'line-through text-on-surface-variant' : 'text-on-surface'}`}>
                  {todo.title}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* All-day events */}
      {allDay.length > 0 && (
        <div className="border-b border-outline/30 p-3 sm:p-4 shrink-0">
          <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-2">All Day / Multi-day</div>
          <div className="flex flex-wrap gap-2">
            {allDay.map((booking) => {
              const colors = TYPE_COLORS[booking.type] || TYPE_COLORS.activity
              const icon = TYPE_ICONS[booking.type] || '📌'
              // Hotel mid-stay: compact chip with night count
              if (booking.type === 'hotel') {
                const start = new Date(booking.start_date)
                const end = new Date(booking.end_date)
                const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
                const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
                const viewDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate())
                const totalNights = Math.round((endDay - startDay) / (1000 * 60 * 60 * 24))
                const nightNumber = Math.round((viewDay - startDay) / (1000 * 60 * 60 * 24)) + 1
                return (
                  <button
                    key={booking.id}
                    onClick={() => onBookingClick?.(booking)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 text-sm font-medium hover:bg-amber-200 transition-colors cursor-pointer"
                  >
                    🏡 {booking.title}
                    <span className="text-amber-600 font-normal text-xs">{nightNumber}/{totalNights}</span>
                  </button>
                )
              }
              return (
                <div
                  key={booking.id}
                  onClick={() => onBookingClick?.(booking)}
                  className={`px-3.5 py-2 rounded-full text-sm border cursor-pointer hover:shadow-elevation-1 transition-all duration-150 ${colors.bg} ${colors.border} ${colors.text}`}
                >
                  <span className="mr-1.5">{icon}</span>
                  <span className="font-medium">{booking.title}</span>
                  {booking.provider && <span className="opacity-60 ml-2 hidden sm:inline">· {booking.provider}</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Hourly timeline */}
      <div className="flex-1 overflow-y-auto">
        <div className="relative">
          {HOURS.map((hour) => {
            const hourBookings = bookingsByHour[hour] || []
            return (
              <div key={hour} className="flex border-b border-outline/15 min-h-[56px]">
                {/* Time label */}
                <div className="w-14 sm:w-16 shrink-0 text-right pr-3 pt-1 text-[11px] text-on-surface-variant font-medium">
                  {hour === 0 ? '12 AM' : `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`}
                </div>
                {/* Content */}
                <div className="flex-1 py-1 px-1 sm:px-2 space-y-2 border-l border-outline/20">
                  {hourBookings.map((booking) => (
                    <BookingCard
                      key={booking.id}
                      booking={booking}
                      onClick={onBookingClick}
                      hideTrip
                      displayDate={currentDate}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
