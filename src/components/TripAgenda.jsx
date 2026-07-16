import { getBookingsForDate, isSameDay } from '../lib/calendar'
import BookingCard from './BookingCard'
import DayReminders from './DayReminders'

// Timezone-safe local date string (YYYY-MM-DD) — matches the calendar views.
function toLocalDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Whole-trip agenda — the mobile form of "the whole trip on one page". Scrolls
 * through every day of the trip that has anything on it (a booking spanning it,
 * a due to-do, or a day note), reusing BookingCard so it matches the calendar's
 * day detail. Empty days are skipped to keep the list tight.
 */
export default function TripAgenda({ tripStart, tripEnd, bookings, todos = [], dayNotes = [], dayReminders = [], selectedTrip, onBookingClick, onAddReminder, onEditReminder, onRemoveReminder }) {
  const today = new Date()
  const days = []
  for (let d = new Date(tripStart); d <= tripEnd; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d.getFullYear(), d.getMonth(), d.getDate()))
  }

  const sections = days
    .map((day) => {
      const dateStr = toLocalDateStr(day)
      const dayBookings = getBookingsForDate(bookings, day).sort(
        (a, b) => new Date(a.start_date) - new Date(b.start_date),
      )
      const dayTodos = todos.filter(
        (t) => t.due_date && isSameDay(new Date(t.due_date + 'T00:00:00'), day),
      )
      const dayNote = dayNotes.find((n) => n.date === dateStr)
      const dayRems = dayReminders.filter((r) => r.date === dateStr)
      return { day, dateStr, dayBookings, dayTodos, dayNote, dayRems }
    })
    .filter((s) => s.dayBookings.length || s.dayTodos.length || s.dayNote || s.dayRems.length)

  return (
    <div className="h-full overflow-y-auto px-3 py-4 space-y-5">
      {sections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
          <p className="text-sm font-medium">Nothing planned yet</p>
        </div>
      ) : (
        sections.map(({ day, dateStr, dayBookings, dayTodos, dayNote, dayRems }) => {
          const isToday = isSameDay(day, today)
          return (
            <section key={dateStr}>
              <div className="flex items-baseline gap-2 mb-2 sticky top-0 bg-surface/95 backdrop-blur-sm py-1 z-10">
                <span className={`text-sm font-semibold ${isToday ? 'text-primary' : 'text-on-surface'}`}>
                  {day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
                {isToday && (
                  <span className="text-[10px] bg-primary-light text-primary px-2 py-0.5 rounded-full font-medium">Today</span>
                )}
                {dayNote && (
                  <span className="text-xs italic text-on-surface-variant truncate">{dayNote.title}</span>
                )}
              </div>

              {dayTodos.length > 0 && (
                <ul className="space-y-1.5 mb-2">
                  {dayTodos.map((todo) => (
                    <li key={todo.id} className="flex items-center gap-2.5">
                      <span className={`w-4 h-4 rounded-md border flex items-center justify-center text-[10px] shrink-0 ${
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
              )}

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

              {onAddReminder && (
                <div className="mt-2">
                  <DayReminders
                    reminders={dayRems}
                    date={dateStr}
                    tripId={selectedTrip ?? null}
                    onAdd={onAddReminder}
                    onEdit={onEditReminder}
                    onRemove={onRemoveReminder}
                    variant="agenda"
                  />
                </div>
              )}
            </section>
          )
        })
      )}
    </div>
  )
}
