import { getWeekDays, getBookingsForDate, isSameDay, getHour, getStayEdge, formatTime } from '../lib/calendar'
import BookingChip from './BookingChip'

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function WeekView({ currentDate, bookings, onSelectDate, onBookingClick }) {
  const days = getWeekDays(currentDate)
  const today = new Date()

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-outline/40 shrink-0">
        <div className="py-2" />
        {days.map((day, i) => {
          const isToday = isSameDay(day, today)
          return (
            <div
              key={i}
              className="py-2.5 text-center border-l border-outline/20 cursor-pointer hover:bg-primary-light/30 transition-colors duration-150"
              onClick={() => onSelectDate(day)}
            >
              <div className="text-[11px] text-on-surface-variant uppercase font-medium tracking-wide">{DAY_NAMES[day.getDay()]}</div>
              <div
                className={`text-sm mt-0.5 w-7 h-7 mx-auto flex items-center justify-center rounded-full transition-colors ${
                  isToday ? 'bg-primary text-white font-medium' : 'text-on-surface'
                }`}
              >
                {day.getDate()}
              </div>
            </div>
          )
        })}
      </div>

      {/* Time grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-[60px_repeat(7,1fr)] relative">
          {HOURS.map((hour) => (
            <div key={hour} className="contents">
              {/* Time label */}
              <div className="h-14 flex items-start justify-end pr-2 text-[11px] text-on-surface-variant font-medium pt-0.5">
                {hour === 0 ? '' : `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`}
              </div>
              {/* Day columns */}
              {days.map((day, dayIdx) => {
                const dayBookings = getBookingsForDate(bookings, day).filter(
                  (b) => getHour(b.start_date) === hour
                )
                return (
                  <div
                    key={dayIdx}
                    className="h-14 border-l border-b border-outline/15 relative px-0.5 hover:bg-primary-light/20 transition-colors duration-100"
                    onClick={() => onSelectDate(day)}
                  >
                    {dayBookings.map((booking) => (
                      <BookingChip
                        key={booking.id}
                        booking={booking}
                        compact
                        stayEdge={getStayEdge(booking, day)}
                        onClick={(b) => { onBookingClick?.(b) }}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
