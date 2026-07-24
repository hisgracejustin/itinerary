import { useState, useEffect, useRef } from 'react'
import { getMonthGrid, getBookingsForDate, isSameDay, hasOvernightCoverage, TYPE_ICONS, getRentalIcon } from '../lib/calendar'
import BookingChip from './BookingChip'
import JourneyView from './JourneyView'
import { formatReminderTime } from './DayReminders'
import useMediaQuery from '../hooks/useMediaQuery'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Vertical budget per week row (px): the day-number strip, one stay-bar lane
// (bar + gap), and one content line (chip/todo/reminder incl. its gap). The
// grid never scrolls — each cell shows what fits and folds the rest into a
// "+N more" line, so these constants ARE the fit-to-viewport math.
const HEADER_PX = 24
const BAR_STRIDE = 18
const LINE_H = 22

// Timezone-safe local date string (YYYY-MM-DD) — matches MobileMonthView so day
// notes written on either view resolve to the same key (avoids a UTC off-by-one).
function toLocalDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

const parseDetails = (b) =>
  typeof b.details === 'string' ? (() => { try { return JSON.parse(b.details) } catch { return {} } })() : (b.details || {})

// Sort bookings: check-outs first, then normal by time, then check-ins last
function sortBookingsForDay(dayBookings, day) {
  const viewDay = midnight(day)
  const getCategory = (bk) => {
    if (!bk.end_date) return 1
    const startDay = midnight(new Date(bk.start_date))
    const endDay = midnight(new Date(bk.end_date))
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

// A "stay" renders as one thin continuous bar (check-in → check-out) instead of
// per-day chips — mirrors MobileMonthView's thin-bar rules for hotels (incl.
// informal), cruises, and rentals.
const STAY_TYPES = new Set(['hotel', 'cruise', 'rental'])
const isStay = (b) => {
  if (!STAY_TYPES.has(b.type) || !b.end_date) return false
  return midnight(new Date(b.end_date)) > midnight(new Date(b.start_date))
}

const STAY_BAR_COLORS = {
  hotel: 'bg-amber-100 text-amber-800 hover:bg-amber-200',
  cruise: 'bg-purple-100 text-purple-800 hover:bg-purple-200',
  rental: 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200',
}

const stayIcon = (b) => {
  if (b.type === 'cruise') return '🚢'
  if (b.type === 'rental') return getRentalIcon(parseDetails(b))
  return '🏡'
}

/**
 * Split every stay into per-week bar segments and pack them into lanes.
 * A segment spans [startCol, endCol] within the week; rounded ends only at the
 * stay's TRUE start/end so a row-crossing stay reads as one unbroken bar.
 */
function staySegmentsForWeek(stays, week) {
  const weekStart = week[0]
  const weekEnd = week[week.length - 1]
  const segs = []
  for (const b of stays) {
    const s = midnight(new Date(b.start_date))
    const e = midnight(new Date(b.end_date))
    if (e < weekStart || s > weekEnd) continue
    const startCol = s <= weekStart ? 0 : week.findIndex((d) => isSameDay(d, s))
    const endCol = e >= weekEnd ? week.length - 1 : week.findIndex((d) => isSameDay(d, e))
    if (startCol === -1 || endCol === -1 || endCol < startCol) continue
    segs.push({ booking: b, startCol, endCol, isStart: s >= weekStart, isEnd: e <= weekEnd })
  }
  // Longest-first within a start column so lanes stay visually stable.
  segs.sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol))
  const laneEnds = []
  for (const seg of segs) {
    let lane = laneEnds.findIndex((end) => end < seg.startCol)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(seg.endCol) } else { laneEnds[lane] = seg.endCol }
    seg.lane = lane
  }
  return { segs, laneCount: laneEnds.length }
}

export default function MonthView({ currentDate, days: propDays, bookings, todos = [], dayNotes = [], dayReminders = [], tripMeta, tripMetas = [], selectedTrip, spanStart, spanEnd, railTripMetas = [], railSpanStart, railSpanEnd, onSelectDate, onBookingClick, onUpsertDayNote, onAddReminder, onEditReminder, onRemoveReminder, onReorderReminder, onExtendTrip }) {
  // Wide desktop → permanent journey rail; day clicks scroll it. Below that the
  // rail is hidden and clicking a day navigates to the Day view.
  const isWide = useMediaQuery('(min-width: 1024px)')
  const [selectedDay, setSelectedDay] = useState(currentDate)
  const [editingNoteDate, setEditingNoteDate] = useState(null)
  const [noteText, setNoteText] = useState('')

  // Rail scroll requests — a token forces re-scroll even for the same day.
  const [scrollRequest, setScrollRequest] = useState(null)
  const requestScroll = (dateStr) =>
    setScrollRequest((p) => ({ dateStr, token: (p?.token ?? 0) + 1 }))

  // Journey rail panel: user-resizable width + collapse, persisted so it sticks
  // across day/trip switches and reloads. Clamped to a sensible range.
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
  const rangeMode = !!propDays
  const today = new Date()

  // Faint teal wash for days inside a SELECTED trip's range.
  const inAnyTrip = (day) =>
    tripMetas.some((t) => {
      if (!t.start_date || !t.end_date) return false
      const s = new Date(t.start_date + 'T00:00:00')
      const e = new Date(t.end_date + 'T23:59:59')
      return day >= s && day <= e
    })

  // Month grid, with trailing all-out-of-month weeks trimmed (5-week months get
  // 5 rows) so every remaining row can flex to its full share of the height.
  const allDays = propDays ?? getMonthGrid(year, month)
  const days = rangeMode
    ? allDays
    : (() => {
        for (let row = allDays.length / 7 - 1; row >= 0; row--) {
          const rowDays = allDays.slice(row * 7, row * 7 + 7)
          if (rowDays.some((d) => d.getMonth() === month || inAnyTrip(d))) return allDays.slice(0, (row + 1) * 7)
        }
        return allDays
      })()
  const weeks = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  const weekCount = weeks.length

  // Measure the week area so each cell knows how many lines fit (the grid
  // itself NEVER scrolls — overflow folds into "+N more").
  const weeksRef = useRef(null)
  const [rowH, setRowH] = useState(0)
  useEffect(() => {
    const el = weeksRef.current
    if (!el) return
    const measure = () => setRowH(el.clientHeight / weekCount)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [weekCount])

  // When a single trip is picked: anchor the rail to the trip's start day.
  // Deliberately nothing else — growing the selection to several trips or
  // clearing it must NOT yank the rail anywhere.
  useEffect(() => {
    if (selectedTrip && tripMeta?.start_date) {
      setSelectedDay(new Date(tripMeta.start_date + 'T00:00:00'))
      setScrollRequest((p) => ({ dateStr: tripMeta.start_date, token: (p?.token ?? 0) + 1 }))
    }
  }, [selectedTrip, tripMeta?.start_date])

  // Completed to-dos are hidden from the month grid to save space — they still
  // show in the journey rail and the to-do list.
  const getTodosForDate = (date) =>
    todos.filter((t) => {
      if (t.status === 'done') return false
      if (!t.due_date) return false
      return isSameDay(new Date(t.due_date + 'T00:00:00'), date)
    })

  const stays = bookings.filter(isStay)
  const stayIds = new Set(stays.map((b) => b.id))

  // A day tap scrolls the rail to that day (wide) or opens Day view (narrow).
  const handleDayActivate = (day) => {
    if (!isWide) {
      onSelectDate(day)
      return
    }
    setSelectedDay(day)
    if (panelCollapsed) setPanelCollapsed(false)
    requestScroll(toLocalDateStr(day))
  }

  const renderBar = (seg) => {
    const b = seg.booking
    const colors = STAY_BAR_COLORS[b.type] || STAY_BAR_COLORS.hotel
    const leftPct = (seg.startCol / 7) * 100
    const widthPct = ((seg.endCol - seg.startCol + 1) / 7) * 100
    const insetL = seg.isStart ? 3 : 0
    const insetR = seg.isEnd ? 3 : 0
    return (
      <button
        key={`${b.id}-${seg.startCol}`}
        onClick={(e) => { e.stopPropagation(); onBookingClick?.(b) }}
        style={{
          left: `calc(${leftPct}% + ${insetL}px)`,
          width: `calc(${widthPct}% - ${insetL + insetR}px)`,
          top: HEADER_PX + seg.lane * BAR_STRIDE,
        }}
        title={b.title}
        aria-label={`${b.title}${seg.isStart ? ' (check-in)' : ''}${seg.isEnd ? ' (check-out)' : ''}`}
        className={`absolute z-10 h-4 flex items-center gap-1 px-1.5 text-[10px] font-medium leading-none transition-colors ${colors} ${
          seg.isStart ? 'rounded-l-full' : ''
        } ${seg.isEnd ? 'rounded-r-full' : ''}`}
      >
        <span className="shrink-0 text-[9px]" aria-hidden>
          {seg.isStart ? (b.type === 'cruise' ? '🚢' : '🔑') : stayIcon(b)}
        </span>
        <span className="truncate min-w-0">{b.title}</span>
      </button>
    )
  }

  const renderCell = (day, di, laneCount, maxLines) => {
    const isToday = isSameDay(day, today)
    const inMonth = rangeMode ? true : day.getMonth() === month
    const inTrip = inAnyTrip(day)
    // Out-of-month days show a dimmed number only, unless they fall inside a
    // selected trip (a trip crossing a month boundary stays fully readable).
    const showContent = inMonth || inTrip
    const dateStr = toLocalDateStr(day)
    const isSelected = isWide && isSameDay(day, selectedDay)
    const dayNote = dayNotes.find((n) => n.date === dateStr)
    const isEditingThis = editingNoteDate === dateStr

    // Build the cell's line items in display order, then keep what fits.
    const items = []
    if (showContent) {
      if (!isEditingThis && dayNote) {
        items.push(
          <button
            key="note"
            onClick={(e) => { e.stopPropagation(); setEditingNoteDate(dateStr); setNoteText(dayNote.title) }}
            className="block w-full text-left text-[10px] italic text-on-surface-variant truncate px-1 py-0.5 hover:text-primary transition-colors duration-150"
          >
            {dayNote.title}
          </button>
        )
      }
      // Reminders: read-only lines here; full editing lives in the journey rail.
      dayReminders
        .filter((r) => r.date === dateStr)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .forEach((r) => {
          const time = formatReminderTime(r.time)
          items.push(
            <div key={`rem-${r.id}`} className="flex items-center gap-1 px-1 py-0.5 text-[10px] text-on-surface-variant">
              <span className="shrink-0" aria-hidden>📌</span>
              <span className="truncate">
                {time && <span className="font-medium text-primary mr-1">{time}</span>}
                {r.text}
              </span>
            </div>
          )
        })
      const dayBookings = sortBookingsForDay(getBookingsForDate(bookings, day), day)
      const nonStay = dayBookings.filter((b) => !stayIds.has(b.id))
      // Overnight flight/train/bus chip (start day of an over-midnight leg)
      nonStay
        .filter((b) => {
          if (b.type !== 'flight' && b.type !== 'train' && b.type !== 'bus') return false
          if (!b.end_date) return false
          const startDay = midnight(new Date(b.start_date))
          const endDay = midnight(new Date(b.end_date))
          return endDay > startDay && midnight(day).getTime() === startDay.getTime()
        })
        .forEach((b) => {
          const chipColors = b.type === 'flight' ? 'bg-primary-light text-accent-ink' : 'bg-emerald-100 text-emerald-800'
          items.push(
            <span
              key={`overnight-${b.id}`}
              className={`w-full inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${chipColors} truncate`}
            >
              {TYPE_ICONS[b.type] || '📌'} Overnight
            </span>
          )
        })
      // No accommodation warning — bounded by the whole journey span (union of
      // selected trips), so a night covered by another selected trip's hotel
      // doesn't false-warn.
      if (spanStart && spanEnd) {
        const viewDay = midnight(day)
        const spanStartDay = midnight(spanStart)
        const spanEndDay = midnight(spanEnd)
        if (viewDay >= spanStartDay && viewDay < spanEndDay && !hasOvernightCoverage(bookings, day)) {
          items.push(
            <div key="no-stay" className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-500 text-[10px]" title="No accommodation booked">
              <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium truncate">No stay</span>
            </div>
          )
        }
      }
      getTodosForDate(day).forEach((todo) => {
        items.push(
          <div key={`todo-${todo.id}`} className="flex items-center gap-1 px-1 py-0.5">
            <span className="w-3 h-3 rounded-sm border border-gray-300 shrink-0" aria-hidden />
            <span className="text-[11px] truncate text-on-surface">{todo.title}</span>
          </div>
        )
      })
      nonStay.forEach((booking) => {
        items.push(
          <BookingChip key={booking.id} booking={booking} compact onClick={(b) => { onBookingClick?.(b) }} />
        )
      })
    }

    let shown = items
    let hiddenCount = 0
    if (items.length > maxLines) {
      shown = items.slice(0, Math.max(0, maxLines - 1))
      hiddenCount = items.length - shown.length
    }

    return (
      <div
        key={di}
        onClick={() => handleDayActivate(day)}
        className={`group relative min-w-0 overflow-hidden px-1 pt-0.5 pb-1 cursor-pointer transition-colors duration-150 ${
          di < 6 ? 'border-r border-outline/20' : ''
        } ${inTrip ? 'bg-primary/5' : ''} ${
          isSelected ? 'ring-1 ring-inset ring-primary/40 bg-primary-light/40' : 'hover:bg-primary-light/30'
        }`}
      >
        <div className="flex items-center justify-between h-5 mb-0.5">
          <span
            className={`text-[11px] w-5 h-5 flex items-center justify-center rounded-full transition-colors ${
              isToday
                ? 'bg-primary text-white font-medium'
                : inMonth
                  ? 'text-on-surface-variant'
                  : 'text-on-surface-variant/40'
            }`}
          >
            {day.getDate()}
          </span>
          {showContent && !isEditingThis && !dayNote && onUpsertDayNote && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditingNoteDate(dateStr); setNoteText('') }}
              className="text-outline hover:text-on-surface-variant transition-colors duration-150 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
              title="Add day title"
              aria-label="Add day title"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}
        </div>

        {/* Reserved band the week's stay bars float over */}
        {laneCount > 0 && <div style={{ height: laneCount * BAR_STRIDE }} className="shrink-0" aria-hidden />}

        {/* Inline day-title editor stays visible even in a full cell */}
        {isEditingThis && (
          <form
            className="mb-0.5"
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
        )}

        {shown.length + hiddenCount > 0 && (
          <div className="space-y-0.5">
            {shown}
            {hiddenCount > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); handleDayActivate(day) }}
                className="block w-full text-left text-[10px] text-primary font-medium px-1 hover:underline"
                aria-label={`Show ${hiddenCount} more items for ${day.toLocaleDateString()}`}
              >
                +{hiddenCount} more
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-full flex">
      {/* Calendar grid column — always fits the viewport, never scrolls */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-outline/30 shrink-0">
          {DAY_NAMES.map((name) => (
            <div key={name} className="py-1 text-center text-[10px] font-medium text-on-surface-variant uppercase tracking-wide">
              {name}
            </div>
          ))}
        </div>

        {/* Week rows: each takes an equal 1fr share of the remaining height */}
        <div ref={weeksRef} className="flex-1 min-h-0 flex flex-col">
          {weeks.map((week, wi) => {
            const { segs, laneCount } = staySegmentsForWeek(stays, week)
            const maxLines = rowH
              ? Math.max(1, Math.floor((rowH - HEADER_PX - laneCount * BAR_STRIDE - 6) / LINE_H))
              : 2
            return (
              <div
                key={wi}
                className={`relative flex-1 min-h-0 basis-0 overflow-hidden grid grid-cols-7 ${
                  wi < weekCount - 1 ? 'border-b border-outline/20' : ''
                }`}
              >
                {week.map((day, di) => renderCell(day, di, laneCount, maxLines))}
                {segs.map(renderBar)}
              </div>
            )
          })}
        </div>
      </div>

      {/* Journey rail (wide desktop only) — resizable + collapsible */}
      {isWide && (panelCollapsed ? (
        <div className="w-10 shrink-0 border-l border-outline/40 bg-surface-dim/40 flex flex-col items-center justify-center">
          <button
            onClick={() => setPanelCollapsed(false)}
            title="Show journey panel"
            aria-label="Show journey panel"
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
            title="Collapse journey panel"
            aria-label="Collapse journey panel"
            className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 h-10 w-5 flex items-center justify-center rounded-full bg-white border border-outline/40 shadow-elevation-1 text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <div className="flex-1 min-h-0">
            {railSpanStart && railSpanEnd ? (
              <JourneyView
                bookings={bookings}
                todos={todos}
                dayNotes={dayNotes}
                dayReminders={dayReminders}
                tripMetas={railTripMetas}
                spanStart={railSpanStart}
                spanEnd={railSpanEnd}
                onSelectDate={onSelectDate}
                onBookingClick={onBookingClick}
                onUpsertDayNote={onUpsertDayNote}
                onAddReminder={onAddReminder}
                onEditReminder={onEditReminder}
                onRemoveReminder={onRemoveReminder}
                onReorderReminder={onReorderReminder}
                onExtendTrip={onExtendTrip}
                scrollRequest={scrollRequest}
                compact
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-on-surface-variant p-4">
                <p className="text-sm font-medium">No trips yet</p>
              </div>
            )}
          </div>
        </aside>
      ))}
    </div>
  )
}
