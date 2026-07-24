import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { getMonthGrid, getBookingsForDate, isSameDay, TYPE_COLORS, TYPE_ICONS, formatTime, hasOvernightCoverage, getRentalIcon } from '../lib/calendar'
import BookingCard from './BookingCard'
import DayReminders from './DayReminders'

const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// Timezone-safe local date string (YYYY-MM-DD)
function toLocalDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export default function MobileMonthView({ currentDate, bookings, todos = [], dayNotes = [], dayReminders = [], tripMeta, selectedTrip, spanStart, spanEnd, onSelectDate, onDayHighlight, onBookingClick, onUpsertDayNote, onAddReminder, onEditReminder, onRemoveReminder, onReorderReminder, collapsed = false, onCollapsedChange }) {
  // Default: if trip selected → first day of trip, else today
  const getDefaultDay = useCallback(() => {
    if (selectedTrip && tripMeta?.start_date) {
      return new Date(tripMeta.start_date + 'T00:00:00')
    }
    return new Date()
  }, [selectedTrip, tripMeta])

  const [selectedDay, setSelectedDay] = useState(getDefaultDay)
  const [editingNoteDate, setEditingNoteDate] = useState(null)
  const [noteText, setNoteText] = useState('')
  const [isCollapsed, setIsCollapsed] = useState(false)
  const calendarRef = useRef(null)
  const expandedHeight = useRef(0)
  const agendaRef = useRef(null)
  const touchStartY = useRef(null)
  const isDragging = useRef(false)
  const isSnapping = useRef(false)
  const isCollapsedRef = useRef(isCollapsed)

  // Keep ref in sync so gesture handler always reads latest value
  useEffect(() => { isCollapsedRef.current = isCollapsed }, [isCollapsed])

  // Measure expanded height
  useLayoutEffect(() => {
    if (calendarRef.current && !isCollapsed) {
      expandedHeight.current = calendarRef.current.scrollHeight
    }
  })

  // Track previous collapsed prop to detect actual changes from parent
  const prevCollapsedRef = useRef(collapsed)

  // Sync internal collapse state with external prop (Month toggle button)
  useEffect(() => {
    if (collapsed === prevCollapsedRef.current) return // no actual change
    prevCollapsedRef.current = collapsed
    if (collapsed && !isCollapsedRef.current) {
      animateCollapse()
    } else if (!collapsed && isCollapsedRef.current) {
      animateExpand()
    }
  }, [collapsed])

  // Anchor the selected day to the trip start when a SINGLE trip is picked.
  // Growing the selection to several trips (selectedTrip → null) or clearing
  // it must NOT yank the day to today — whatever day is showing just stays.
  useEffect(() => {
    if (!selectedTrip || !tripMeta?.start_date) return
    setSelectedDay(getDefaultDay())
    // Only expand if calendar is currently collapsed
    if (isCollapsedRef.current) {
      setIsCollapsed(false)
      isCollapsedRef.current = false
      prevCollapsedRef.current = false
    }
    if (calendarRef.current) {
      calendarRef.current.style.height = ''
      calendarRef.current.style.transition = ''
      calendarRef.current.style.opacity = ''
    }
  }, [selectedTrip, tripMeta?.start_date, getDefaultDay])

  const animateCollapse = () => {
    const el = calendarRef.current
    if (!el) return
    isSnapping.current = true
    const h = el.scrollHeight
    el.style.height = `${h}px`
    el.style.opacity = '1'
    // Force reflow
    el.offsetHeight
    el.style.transition = 'height 0.35s cubic-bezier(0.2, 0, 0, 1), opacity 0.25s ease-out'
    el.style.height = '0px'
    el.style.opacity = '0'
    let done = false
    const finish = () => {
      if (done) return
      done = true
      el.removeEventListener('transitionend', handler)
      el.style.transition = ''
      setIsCollapsed(true)
      onCollapsedChange?.(true)
    }
    const handler = (e) => { if (e.propertyName === 'height') finish() }
    el.addEventListener('transitionend', handler)
    setTimeout(finish, 400)
  }

  const animateExpand = () => {
    const el = calendarRef.current
    if (!el) return
    isSnapping.current = true
    setIsCollapsed(false)
    const targetH = expandedHeight.current || 250
    el.style.height = '0px'
    el.style.opacity = '0'
    // Force reflow
    el.offsetHeight
    el.style.transition = 'height 0.35s cubic-bezier(0.2, 0, 0, 1), opacity 0.2s 0.1s ease-in'
    el.style.height = `${targetH}px`
    el.style.opacity = '1'
    let done = false
    const finish = () => {
      if (done) return
      done = true
      el.removeEventListener('transitionend', handler)
      el.style.transition = ''
      el.style.height = ''
      el.style.opacity = ''
      expandedHeight.current = el.scrollHeight
      onCollapsedChange?.(false)
    }
    const handler = (e) => { if (e.propertyName === 'height') finish() }
    el.addEventListener('transitionend', handler)
    setTimeout(finish, 400)
  }

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const allDays = getMonthGrid(year, month)
  const today = new Date()

  // Trim trailing rows that are entirely outside the current month (and trip)
  const trimmedDays = (() => {
    for (let row = 5; row >= 0; row--) {
      const rowDays = allDays.slice(row * 7, row * 7 + 7)
      const hasRelevant = rowDays.some(d => {
        if (d.getMonth() === month) return true
        if (tripMeta?.start_date && tripMeta?.end_date) {
          const tripStart = new Date(tripMeta.start_date + 'T00:00:00')
          const tripEnd = new Date(tripMeta.end_date + 'T23:59:59')
          return d >= tripStart && d <= tripEnd
        }
        return false
      })
      if (hasRelevant) return allDays.slice(0, (row + 1) * 7)
    }
    return allDays
  })()
  const days = trimmedDays

  // Trip date range (if a trip with dates is selected)
  const tripStart = tripMeta?.start_date ? new Date(tripMeta.start_date + 'T00:00:00') : null
  const tripEnd = tripMeta?.end_date ? new Date(tripMeta.end_date + 'T23:59:59') : null

  const isOutsideTrip = (day) => {
    if (!tripStart || !tripEnd) return false
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate())
    return d < tripStart || d > tripEnd
  }

  // Get todos for a given date
  const getTodosForDate = (date) => {
    return todos.filter((t) => {
      if (!t.due_date) return false
      return isSameDay(new Date(t.due_date + 'T00:00:00'), date)
    })
  }

  // Get bookings from start of trip (or 30 days back) through end of trip (or 30 days forward)
  const agendaEndDate = (() => {
    if (tripMeta?.end_date) {
      return new Date(tripMeta.end_date + 'T23:59:59')
    }
    return new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate() + 30)
  })()

  // When expanded: start from selected day. When collapsed: start from trip start (or today) so user can scroll back.
  // Always render full agenda from trip start (or today). Scroll position controls what's visible.
  const agendaStartDate = (() => {
    if (tripMeta?.start_date) {
      return new Date(tripMeta.start_date + 'T00:00:00')
    }
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  })()

  const agendaDays = []
  let d = new Date(agendaStartDate.getFullYear(), agendaStartDate.getMonth(), agendaStartDate.getDate())
  while (d <= agendaEndDate) {
    const dayBookings = getBookingsForDate(bookings, d)
    const dayTodos = getTodosForDate(d)
    const dateStr = toLocalDateStr(d)
    const hasDayNote = dayNotes.some((n) => n.date === dateStr)
    const hasReminder = dayReminders.some((r) => r.date === dateStr)
    const showDay = tripMeta?.start_date
      ? true
      : (dayBookings.length > 0 || dayTodos.length > 0 || hasDayNote || hasReminder || d.getTime() === new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate()).getTime())
    if (showDay) {
      agendaDays.push({ date: new Date(d), bookings: dayBookings, todos: dayTodos })
    }
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  }

  const handleDayClick = (day) => {
    setSelectedDay(day)
    onDayHighlight?.(day)
  }

  // Scroll agenda to show the selected day at top
  const scrollAgendaToSelectedDay = useCallback(() => {
    const container = agendaRef.current
    if (!container) return
    const dateStr = toLocalDateStr(selectedDay)
    const el = container.querySelector(`[data-date="${dateStr}"]`)
    if (el) {
      container.scrollTop = el.offsetTop - container.offsetTop
    }
  }, [selectedDay])

  // Reset agenda scroll when selected day changes or collapse state changes
  useLayoutEffect(() => {
    if (!agendaRef.current) return
    scrollAgendaToSelectedDay()
    // Clear snapping flag after scroll is positioned
    isSnapping.current = false
  }, [selectedDay, agendaDays.length, isCollapsed, scrollAgendaToSelectedDay])

  // Gesture-driven collapse/expand via direct DOM manipulation (no re-renders during drag)
  useEffect(() => {
    const el = agendaRef.current
    if (!el) return

    let startY = 0
    let startScrollTop = 0
    let currentProgress = 0
    let gestureMode = null // null | 'collapse' | 'scroll'
    const DEAD_ZONE = 6 // px before committing to a gesture direction
    const SCROLL_TOLERANCE = 3 // px - treat as "at top" if within this

    const onTouchStart = (e) => {
      if (isSnapping.current) return
      startY = e.touches[0].clientY
      startScrollTop = el.scrollTop
      isDragging.current = false
      currentProgress = 0
      gestureMode = null
    }

    const onTouchMove = (e) => {
      if (isSnapping.current) return
      const touchY = e.touches[0].clientY
      const deltaY = touchY - startY

      // If we haven't committed to a gesture yet, detect direction
      if (gestureMode === null) {
        if (Math.abs(deltaY) < DEAD_ZONE) return // still in dead zone

        if (!isCollapsedRef.current && deltaY < 0) {
          gestureMode = 'collapse'
        } else {
          gestureMode = 'scroll'
          return
        }
      }

      if (gestureMode === 'scroll') return

      // Prevent default to stop agenda from scrolling
      e.preventDefault()

      if (gestureMode === 'collapse') {
        isDragging.current = true
        const maxH = expandedHeight.current || 250
        currentProgress = Math.min(Math.abs(deltaY) / (maxH * 0.8), 1)
        const cal = calendarRef.current
        if (cal) {
          const h = maxH * (1 - currentProgress)
          const opacity = 1 - currentProgress * 0.8
          cal.style.transition = 'none'
          cal.style.height = `${h}px`
          cal.style.opacity = `${opacity}`
        }
        return
      }
    }

    const onTouchEnd = () => {
      if (!isDragging.current) return
      isDragging.current = false
      gestureMode = null
      const cal = calendarRef.current
      if (!cal) return

      const maxH = expandedHeight.current || 250
      const threshold = 0.5

      // Helper: run cleanup after transition (with timeout fallback)
      const afterTransition = (el, callback) => {
        let done = false
        const finish = () => {
          if (done) return
          done = true
          el.removeEventListener('transitionend', handler)
          callback()
        }
        const handler = (e) => {
          if (e.propertyName === 'height') finish()
        }
        el.addEventListener('transitionend', handler)
        // Fallback in case transitionend doesn't fire
        setTimeout(finish, 350)
      }

      if (!isCollapsedRef.current) {
        if (currentProgress > threshold) {
          // Complete collapse
          isSnapping.current = true
          cal.style.transition = 'height 0.3s cubic-bezier(0.2, 0, 0, 1), opacity 0.2s ease-out'
          cal.style.height = '0px'
          cal.style.opacity = '0'
          afterTransition(cal, () => {
            cal.style.transition = ''
            setIsCollapsed(true)
            onCollapsedChange?.(true)
          })
        } else {
          // Snap back expanded
          isSnapping.current = true
          cal.style.transition = 'height 0.3s cubic-bezier(0.2, 0, 0, 1), opacity 0.2s ease-in'
          cal.style.height = `${maxH}px`
          cal.style.opacity = '1'
          afterTransition(cal, () => {
            cal.style.transition = ''
            cal.style.height = ''
            cal.style.opacity = ''
            isSnapping.current = false
          })
        }
      }
      currentProgress = 0
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [selectedDay, onCollapsedChange])

  // Check if a day has any bookings (for dot indicator)
  const dayHasBookings = (day) => getBookingsForDate(bookings, day).length > 0

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Compact month calendar - top section */}
      <div
        ref={calendarRef}
        style={isCollapsed ? { height: 0, overflow: 'hidden', opacity: 0 } : {}}
        className="shrink-0 border-b border-outline/30 shadow-sm pb-2 will-change-[height,opacity] overflow-hidden"
      >
        {/* Day headers */}
        <div className="grid grid-cols-7 px-2 pt-1.5 pb-1.5">
          {DAY_NAMES.map((name, i) => (
            <div key={i} className="py-2 text-center text-[10px] font-medium text-on-surface-variant uppercase tracking-wide">
              {name}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 px-2 gap-y-0.5">
          {days.map((day, i) => {
            const isCurrentMonth = day.getMonth() === month
            const isToday = isSameDay(day, today)
            const outsideTrip = isOutsideTrip(day)

            if (!isCurrentMonth && (!tripMeta || outsideTrip)) {
              return <div key={i} className="py-1 w-7 h-7" />
            }

            const isSelected = isSameDay(day, selectedDay)
            const hasBookings = dayHasBookings(day)

            return (
              <button
                key={i}
                onClick={() => handleDayClick(day)}
                className={`flex flex-col items-center py-1 rounded-xl transition-all duration-150 ${outsideTrip ? 'opacity-30' : ''}`}
              >
                <span
                  className={`w-7 h-7 flex items-center justify-center rounded-full text-xs transition-all duration-150 ${
                    isSelected
                      ? 'bg-primary text-white font-medium shadow-sm'
                      : isToday
                      ? 'bg-primary-light text-primary font-medium'
                      : 'text-on-surface'
                  }`}
                >
                  {day.getDate()}
                </span>
                {/* Dot indicator for days with bookings */}
                <div className="h-1 mt-0.5">
                  {hasBookings && !isSelected && (
                    <div className="w-1 h-1 rounded-full bg-primary" />
                  )}
                  {hasBookings && isSelected && (
                    <div className="w-1 h-1 rounded-full bg-white" />
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Agenda / schedule - bottom section */}
      <div
        className="flex-1 overflow-y-auto overscroll-none"
        ref={agendaRef}
      >
        {agendaDays.length === 0 || (agendaDays.length === 1 && agendaDays[0].bookings.length === 0 && agendaDays[0].todos.length === 0) ? (
          <div className="flex flex-col items-center justify-center h-full text-on-surface-variant px-4">
            <div className="w-14 h-14 rounded-full bg-surface-container flex items-center justify-center mb-3">
              <svg className="w-7 h-7 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-sm font-medium">No bookings this week</p>
          </div>
        ) : (
          <div className="divide-y divide-outline/20">
            {agendaDays.map(({ date, bookings: dayBookings, todos: dayTodos }) => {
              const dateStr = toLocalDateStr(date)
              const dayNote = dayNotes.find((n) => n.date === dateStr)
              const isEditingThis = editingNoteDate === dateStr

              return (
              <div key={dateStr} data-date={dateStr} className="px-4 py-3">
                {/* Day header */}
                <div className="flex items-center gap-2 mb-1.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); onSelectDate?.(date) }}
                    className={`text-sm font-medium hover:underline shrink-0 whitespace-nowrap ${isSameDay(date, today) ? 'text-primary' : 'text-on-surface'}`}
                  >
                    {date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </button>
                  {isSameDay(date, today) && (
                    <span className="text-[10px] bg-primary-light text-primary px-2 py-0.5 rounded-full font-medium">Today</span>
                  )}
                  {!isEditingThis && !dayNote && (
                    <button
                      onClick={() => { setEditingNoteDate(dateStr); setNoteText('') }}
                      className="text-outline hover:text-on-surface-variant transition-colors duration-150"
                      title="Add day title"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  )}
                  {/* Spacer */}
                  <div className="flex-1" />
                  {/* Hotel mid-stay chips (right-aligned) */}
                  {dayBookings.filter((b) => {
                    if (b.type !== 'hotel' || !b.end_date) return false
                    const details = typeof b.details === 'string' ? (() => { try { return JSON.parse(b.details) } catch { return {} } })() : (b.details || {})
                    const start = new Date(b.start_date)
                    const end = new Date(b.end_date)
                    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
                    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
                    const viewDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
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
                    const viewDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
                    const totalNights = Math.round((endDay - startDay) / (1000 * 60 * 60 * 24))
                    const nightNumber = Math.round((viewDay - startDay) / (1000 * 60 * 60 * 24)) + 1
                    return (
                      <button
                        key={b.id}
                        onClick={() => onBookingClick?.(b)}
                        className="inline-flex items-center gap-1 min-w-0 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-medium hover:bg-amber-200 transition-colors"
                      >
                        <span className="shrink-0">🏡</span>
                        <span className="truncate">{b.title}</span>
                        <span className="text-amber-600 font-normal shrink-0">{nightNumber}/{totalNights}</span>
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
                    const viewDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
                    return endDay > startDay && viewDay.getTime() !== endDay.getTime() && viewDay.getTime() !== startDay.getTime()
                  }).map((b) => {
                    const start = new Date(b.start_date)
                    const end = new Date(b.end_date)
                    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
                    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
                    const viewDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
                    const totalNights = Math.round((endDay - startDay) / (1000 * 60 * 60 * 24))
                    const nightNumber = Math.round((viewDay - startDay) / (1000 * 60 * 60 * 24)) + 1
                    return (
                      <button
                        key={b.id}
                        onClick={() => onBookingClick?.(b)}
                        className="inline-flex items-center gap-1 min-w-0 px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-[11px] font-medium hover:bg-purple-200 transition-colors"
                      >
                        <span className="shrink-0">🚢</span>
                        <span className="truncate">On board</span>
                        <span className="text-purple-600 font-normal shrink-0">{nightNumber}/{totalNights}</span>
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
                    const viewDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
                    return endDay > startDay && viewDay.getTime() !== endDay.getTime() && viewDay.getTime() !== startDay.getTime()
                  }).map((b) => {
                    const details = typeof b.details === 'string' ? (() => { try { return JSON.parse(b.details) } catch { return {} } })() : (b.details || {})
                    const start = new Date(b.start_date)
                    const end = new Date(b.end_date)
                    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
                    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
                    const viewDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
                    const totalDays = Math.round((endDay - startDay) / (1000 * 60 * 60 * 24))
                    const dayNumber = Math.round((viewDay - startDay) / (1000 * 60 * 60 * 24)) + 1
                    return (
                      <button
                        key={b.id}
                        onClick={() => onBookingClick?.(b)}
                        className="inline-flex items-center gap-1 min-w-0 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[11px] font-medium hover:bg-indigo-200 transition-colors"
                      >
                        <span className="shrink-0">{getRentalIcon(details)}</span>
                        <span className="truncate">{b.title}</span>
                        <span className="text-indigo-600 font-normal shrink-0">{dayNumber}/{totalDays}</span>
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
                    const viewDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
                    return endDay > startDay && viewDay.getTime() === startDay.getTime()
                  }).map((b) => {
                    const typeIcon = TYPE_ICONS[b.type] || '📌'
                    const chipColors = b.type === 'flight'
                      ? 'bg-primary-light text-accent-ink hover:bg-primary/20'
                      : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                    return (
                      <span
                        key={`overnight-${b.id}`}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${chipColors} transition-colors`}
                      >
                        {typeIcon} Overnight
                      </span>
                    )
                  })}
                  {/* No accommodation warning (right-aligned) — bounded by the
                      whole journey span (union of selected trips), so a night
                      covered by another selected trip's hotel doesn't false-warn. */}
                  {spanStart && spanEnd && (() => {
                    const viewDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
                    const spanStartDay = new Date(spanStart.getFullYear(), spanStart.getMonth(), spanStart.getDate())
                    const spanEndDay = new Date(spanEnd.getFullYear(), spanEnd.getMonth(), spanEnd.getDate())
                    if (viewDay < spanStartDay || viewDay >= spanEndDay) return null
                    if (!hasOvernightCoverage(bookings, date)) {
                      return (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-500 text-[11px]" title="No accommodation booked">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="font-medium whitespace-nowrap">No stay</span>
                        </span>
                      )
                    }
                    return null
                  })()}
                </div>

                {/* Day note (title) */}
                {isEditingThis ? (
                  <form
                    className="mb-2"
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
                      placeholder="Day title (optional)"
                      className="w-full px-3 py-1.5 text-xs italic text-on-surface-variant bg-surface-container border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </form>
                ) : dayNote ? (
                  <button
                    onClick={() => { setEditingNoteDate(dateStr); setNoteText(dayNote.title) }}
                    className="text-xs italic text-on-surface-variant mb-2 block hover:text-primary transition-colors duration-150"
                  >
                    {dayNote.title}
                  </button>
                ) : null}

                {/* Bookings for this day */}
                {dayBookings.length === 0 && dayTodos.length === 0 ? (
                  <p className="text-xs text-on-surface-variant/60 pl-1"></p>
                ) : (
                  <div className="space-y-2">
                    {/* Todos on top */}
                    {dayTodos.length > 0 && (
                      <div className="space-y-1.5">
                        {dayTodos.map((todo) => (
                          <div key={todo.id} className="flex items-center gap-2 pl-1">
                            <span className={`w-3.5 h-3.5 rounded-md border flex items-center justify-center text-[9px] ${
                              todo.status === 'done' ? 'bg-primary/10 border-primary/30 text-primary' : 'border-gray-300'
                            }`}>
                              {todo.status === 'done' && '✓'}
                            </span>
                            <span className={`text-sm ${todo.status === 'done' ? 'line-through text-on-surface-variant' : 'text-on-surface'}`}>
                              {todo.title}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {[...dayBookings].filter((b) => {
                      // Exclude hotel/rental mid-stay/informal from full cards (shown as chips above)
                      if ((b.type === 'hotel' || b.type === 'rental') && b.end_date) {
                        const details = typeof b.details === 'string' ? (() => { try { return JSON.parse(b.details) } catch { return {} } })() : (b.details || {})
                        const start = new Date(b.start_date)
                        const end = new Date(b.end_date)
                        const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
                        const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
                        const viewDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
                        if (endDay <= startDay) return true
                        // Informal: never show as full card (chip on all days except check-out)
                        if (b.type === 'hotel' && details.informal) return false
                        // Regular: hide on middle days only
                        if (viewDay.getTime() !== endDay.getTime() && viewDay.getTime() !== startDay.getTime()) return false
                      }
                      return true
                    }).sort((a, b) => {
                      // Sort: check-outs first, then other bookings by time, then check-ins last
                      const viewDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
                      const getCategory = (bk) => {
                        if (!bk.end_date) return 1 // normal booking
                        const start = new Date(bk.start_date)
                        const end = new Date(bk.end_date)
                        const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
                        const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
                        if (endDay > startDay && viewDay.getTime() === endDay.getTime()) return 0 // check-out/arrive
                        if (endDay > startDay && viewDay.getTime() === startDay.getTime()) return 2 // check-in/depart
                        return 1 // normal or mid-stay
                      }
                      const catA = getCategory(a)
                      const catB = getCategory(b)
                      if (catA !== catB) return catA - catB
                      // Within same category, sort by effective time
                      const timeA = catA === 0 ? new Date(a.end_date).getTime() : new Date(a.start_date).getTime()
                      const timeB = catB === 0 ? new Date(b.end_date).getTime() : new Date(b.start_date).getTime()
                      return timeA - timeB
                    }).map((booking) => (
                      <AgendaItem key={booking.id} booking={booking} displayDate={date} onClick={onBookingClick} />
                    ))}
                  </div>
                )}

                {onAddReminder && (
                  <div className="mt-2">
                    <DayReminders
                      reminders={dayReminders.filter((r) => r.date === dateStr)}
                      date={dateStr}
                      tripId={selectedTrip ?? null}
                      onAdd={onAddReminder}
                      onEdit={onEditReminder}
                      onRemove={onRemoveReminder}
                      onReorder={onReorderReminder}
                      variant="agenda"
                    />
                  </div>
                )}
              </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function AgendaItem({ booking, displayDate, onClick }) {
  const colors = TYPE_COLORS[booking.type] || TYPE_COLORS.activity
  const icon = TYPE_ICONS[booking.type] || '📌'

  // Parse details for maps_url
  const details = (() => {
    if (!booking.details) return {}
    if (typeof booking.details === 'string') {
      try { return JSON.parse(booking.details) } catch { return {} }
    }
    return booking.details
  })()
  const mapsUrl = details.maps_url

  // Check-in / check-out context for multi-day bookings
  const stayNote = (() => {
    if (!booking.end_date || !displayDate) return null
    const start = new Date(booking.start_date)
    const end = new Date(booking.end_date)
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
    if (endDay <= startDay) return null
    const viewDay = new Date(displayDate.getFullYear(), displayDate.getMonth(), displayDate.getDate())
    if (booking.type === 'flight') {
      if (viewDay.getTime() === startDay.getTime()) return 'Take-off'
      if (viewDay.getTime() === endDay.getTime()) return 'Land'
    } else if (booking.type === 'train' || booking.type === 'bus') {
      if (viewDay.getTime() === startDay.getTime()) return 'Depart'
      if (viewDay.getTime() === endDay.getTime()) return 'Arrive'
    } else if (booking.type === 'rental') {
      if (viewDay.getTime() === startDay.getTime()) return '🔑 Pick-up'
      if (viewDay.getTime() === endDay.getTime()) return '🏁 Drop-off'
    } else {
      if (viewDay.getTime() === startDay.getTime()) return '🔑 Check-in'
      if (viewDay.getTime() === endDay.getTime()) return '🚪 Check-out'
    }
    return null
  })()

  // Is this a hotel/rental check-in or check-out day?
  const isStayEdgeCard = (booking.type === 'hotel' || booking.type === 'rental') && stayNote !== null

  // Only show +1 indicator when viewing from the departure day
  const nextDayIndicator = (() => {
    if (!booking.end_date || !booking.start_date) return null
    const start = new Date(booking.start_date)
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    const viewDay = new Date(displayDate.getFullYear(), displayDate.getMonth(), displayDate.getDate())
    // Only show on the departure day
    if (viewDay.getTime() !== startDay.getTime()) return null
    const end = new Date(booking.end_date)
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
    const diffDays = Math.round((endDay - startDay) / (1000 * 60 * 60 * 24))
    if (diffDays > 0) return `+${diffDays}`
    return null
  })()

  // Layover info
  const layovers = details.layovers || []

  // Thin card for hotel/rental check-in/check-out
  if (isStayEdgeCard) {
    const isStart = stayNote.includes('Check-in') || stayNote.includes('Pick-up')
    const relevantTime = isStart ? formatTime(booking.start_date) : formatTime(booking.end_date)
    const edgeBg = booking.type === 'rental' ? 'bg-indigo-50/50 hover:bg-indigo-50' : 'bg-amber-50/50 hover:bg-amber-50'
    return (
      <button
        onClick={() => onClick?.(booking)}
        className={`w-full text-left px-3 py-2 rounded-lg border-l-4 ${colors.border} ${edgeBg} transition-all duration-150`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-medium text-on-surface truncate">{stayNote}</span>
            <span className="text-xs text-on-surface-variant truncate">{booking.title}</span>
          </div>
          <span className="text-xs text-on-surface-variant shrink-0 ml-2">{relevantTime}</span>
        </div>
      </button>
    )
  }

  return (
    <button
      onClick={() => onClick?.(booking)}
      className={`w-full text-left p-3.5 rounded-xl border-l-4 ${colors.border} bg-white shadow-elevation-1 hover:shadow-elevation-2 transition-all duration-150 mat-press`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-base shrink-0">{icon}</span>
          <div className="min-w-0">
            <div className="font-medium text-sm text-on-surface truncate">{booking.title}</div>
            <div className="text-xs text-on-surface-variant flex items-center gap-1.5">
              {stayNote && <span className="text-on-surface font-medium">{stayNote}</span>}
              {stayNote && booking.provider && <span className="opacity-40">·</span>}
              {booking.provider && <span>{booking.provider}</span>}
              {booking.confirmation_number && (
                <>
                  <span className="opacity-40">·</span>
                  <span className="font-mono">{booking.confirmation_number}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="text-xs text-on-surface-variant shrink-0 ml-2 text-right flex items-center gap-2">
          <div>
            <span>{formatTime(booking.start_date)}</span>
            {booking.end_date && (
              <div className="flex items-center justify-end gap-0.5">
                <span className="text-on-surface-variant/60">→ {formatTime(booking.end_date)}</span>
                {nextDayIndicator && (
                  <span className="text-[10px] text-orange-500 font-semibold">{nextDayIndicator}</span>
                )}
              </div>
            )}
          </div>
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-on-surface-variant/50 hover:text-primary transition-colors duration-150"
              title="Open in Google Maps"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </a>
          )}
        </div>
      </div>
      {/* Layover route visual */}
      {layovers.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-1 text-[10px] text-on-surface-variant">
            <span className="font-medium text-on-surface">{details.departure_airport}</span>
            {layovers.map((lo, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="text-primary">→</span>
                <span className="text-orange-600 font-medium" title={lo.airport}>
                  {lo.airport}
                  {lo.arrival && lo.departure && (
                    <span className="text-on-surface-variant font-normal ml-0.5">
                      ({formatLayoverTime(lo.arrival, lo.departure)})
                    </span>
                  )}
                </span>
              </span>
            ))}
            <span className="text-primary">→</span>
            <span className="font-medium text-on-surface">{details.arrival_airport}</span>
          </div>
        </div>
      )}
    </button>
  )
}

function formatLayoverTime(arrivalISO, departureISO) {
  const arr = new Date(arrivalISO)
  const dep = new Date(departureISO)
  const diffMs = dep - arr
  if (diffMs <= 0) return ''
  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  const mins = Math.round((diffMs % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 0 && mins > 0) return `${hours}h${mins}m`
  if (hours > 0) return `${hours}h`
  return `${mins}m`
}
