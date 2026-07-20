/**
 * Calendar date utilities.
 */

/**
 * Get the days to display in a month grid (includes leading/trailing days from adjacent months).
 * Returns an array of Date objects for a 6-row × 7-col grid.
 */
export function getMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1)
  const startDow = firstDay.getDay() // 0=Sun
  const start = new Date(year, month, 1 - startDow)

  const days = []
  for (let i = 0; i < 42; i++) {
    days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  }
  return days
}

/**
 * Get a week-aligned grid (Sun–Sat rows) spanning an inclusive date range — from
 * the Sunday of the start's week through the Saturday of the end's week. Used by
 * the "Trip" view to show a whole trip on one page regardless of month bounds.
 * Returns an array of Date objects, always a multiple of 7.
 */
export function getRangeGrid(start, end) {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate() - start.getDay())
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate() + (6 - end.getDay()))
  const days = []
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d.getFullYear(), d.getMonth(), d.getDate()))
  }
  return days
}

/**
 * Get the 7 days of the week containing the given date (Sun–Sat).
 */
export function getWeekDays(date) {
  const d = new Date(date)
  const day = d.getDay()
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day)
  const days = []
  for (let i = 0; i < 7; i++) {
    days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  }
  return days
}

/**
 * Check if two dates represent the same calendar day.
 */
export function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Check if a booking spans/includes a given date.
 */
export function bookingSpansDate(booking, date) {
  const start = new Date(booking.start_date)
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (booking.end_date) {
    const end = new Date(booking.end_date)
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
    return dayStart >= startDay && dayStart <= endDay
  }
  return isSameDay(startDay, dayStart)
}

/**
 * Get bookings for a specific date.
 */
export function getBookingsForDate(bookings, date) {
  return bookings.filter((b) => bookingSpansDate(b, date))
}

/**
 * For a multi-night stay (hotel/cruise), which edge of the stay a given date is:
 * 'in' on the check-in day, 'out' on the check-out day, null otherwise.
 *
 * The check-out day is not a night stayed (see hasOvernightCoverage), so callers
 * render it differently to avoid implying another night at that property.
 */
export function getStayEdge(booking, date) {
  if (booking.type !== 'hotel' && booking.type !== 'cruise') return null
  if (!booking.end_date) return null
  const start = new Date(booking.start_date)
  const end = new Date(booking.end_date)
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  if (endDay <= startDay) return null
  const viewDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  if (viewDay.getTime() === endDay.getTime()) return 'out'
  if (viewDay.getTime() === startDay.getTime()) return 'in'
  return null
}

/**
 * Format a time string from an ISO date string (e.g. "10:30 AM").
 */
export function formatTime(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * Get the hour (0-23) from an ISO date string.
 */
export function getHour(isoString) {
  if (!isoString) return 0
  return new Date(isoString).getHours()
}

/**
 * Color map for booking types.
 */
export const TYPE_COLORS = {
  flight: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-400', dot: 'bg-flight' },
  train: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-400', dot: 'bg-train' },
  bus: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-400', dot: 'bg-bus' },
  cruise: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-400', dot: 'bg-cruise' },
  hotel: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-400', dot: 'bg-hotel' },
  activity: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-400', dot: 'bg-activity' },
}

/**
 * Emoji icons for booking types.
 */
export const TYPE_ICONS = {
  flight: '✈️',
  train: '🚂',
  bus: '🚌',
  cruise: '🚢',
  hotel: '🏡',
  activity: '🎯',
}

/**
 * Check if a date has overnight accommodation covered by any booking.
 * Returns true if there's a hotel/cruise spanning that night, or an overnight flight/train/bus departing that day.
 */
export function hasOvernightCoverage(bookings, date) {
  const viewDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  return bookings.some((b) => {
    if (!b.end_date) return false
    const start = new Date(b.start_date)
    const end = new Date(b.end_date)
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
    if (endDay <= startDay) return false
    if (b.type === 'hotel' || b.type === 'cruise') {
      // Covers nights from check-in day up to (but not including) check-out day
      return viewDay >= startDay && viewDay < endDay
    }
    if (b.type === 'flight' || b.type === 'train' || b.type === 'bus') {
      // Overnight transit: departure day = viewDay
      return viewDay.getTime() === startDay.getTime()
    }
    return false
  })
}
