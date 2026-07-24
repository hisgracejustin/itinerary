import { useEffect, useRef, useState } from 'react'
import { getRangeGrid, getBookingsForDate, isSameDay, hasOvernightCoverage, tripColorMap, TYPE_ICONS } from '../lib/calendar'
import BookingCard from './BookingCard'
import DayReminders from './DayReminders'

// Timezone-safe local date string (YYYY-MM-DD) — matches the calendar views.
function toLocalDateStr(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

// Check-outs first, then by time, then check-ins last — same ordering as the
// month grid so a day reads as a real itinerary (check out, do things, depart).
function sortBookingsForDay(dayBookings, day) {
  const viewDay = midnight(day)
  const getCategory = (bk) => {
    if (!bk.end_date) return 1
    const startDay = midnight(new Date(bk.start_date))
    const endDay = midnight(new Date(bk.end_date))
    if (endDay > startDay && viewDay.getTime() === endDay.getTime()) return 0
    if (endDay > startDay && viewDay.getTime() === startDay.getTime()) return 2
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

/**
 * The Journey view — a continuous day-by-day timeline across every selected trip.
 * The day is the unit; the trip is a per-row attribute (a colored rail on the
 * row's leading edge, plus the trip name when more than one trip is in view). An
 * overlap day therefore shows both trips' rows interleaved by time. Maximal runs
 * of empty days collapse to a single labelled divider that expands on click.
 */
export default function JourneyView({
  bookings,
  todos = [],
  dayNotes = [],
  dayReminders = [],
  tripMetas = [],
  spanStart,
  spanEnd,
  onBookingClick,
  onUpsertDayNote,
  onAddReminder,
  onEditReminder,
  onRemoveReminder,
  onReorderReminder,
  onSelectDate,
  onExtendTrip,
  scrollRequest,
  compact = false,
}) {
  const today = new Date()
  const colorMap = tripColorMap(tripMetas.map((t) => t.id))
  const tripNameById = Object.fromEntries(tripMetas.map((t) => [t.id, t.name]))
  const showTripName = tripMetas.length > 1

  const [expandedRuns, setExpandedRuns] = useState(() => new Set())
  const [editingNoteDate, setEditingNoteDate] = useState(null)
  const [noteText, setNoteText] = useState('')

  // Scroll-to-day requests from the month grid (day cell / "+N more" clicks,
  // single-trip selection). Finds the exact day section, or the nearest one
  // when the target sits inside a collapsed run, then flashes a highlight.
  const scrollerRef = useRef(null)
  const [highlightDate, setHighlightDate] = useState(null)
  useEffect(() => {
    if (!scrollRequest?.dateStr) return
    const container = scrollerRef.current
    if (!container) return
    const sections = Array.from(container.querySelectorAll('[data-journey-date]'))
    if (sections.length === 0) return
    const targetMs = new Date(scrollRequest.dateStr + 'T00:00:00').getTime()
    let el = sections.find((s) => s.getAttribute('data-journey-date') === scrollRequest.dateStr)
    if (!el) {
      let bestDiff = Infinity
      for (const s of sections) {
        const diff = Math.abs(new Date(s.getAttribute('data-journey-date') + 'T00:00:00').getTime() - targetMs)
        if (diff < bestDiff) { bestDiff = diff; el = s }
      }
    }
    if (!el) return
    const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 8
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    setHighlightDate(el.getAttribute('data-journey-date'))
    const t = setTimeout(() => setHighlightDate(null), 1600)
    return () => clearTimeout(t)
  }, [scrollRequest])

  if (!spanStart || !spanEnd) return null

  const spanStartDay = midnight(spanStart)
  const spanEndDay = midnight(spanEnd)

  // Continuous inclusive span. getRangeGrid week-aligns with padding; trim it
  // back to exactly [spanStart, spanEnd] for a true day-by-day list.
  const days = getRangeGrid(spanStart, spanEnd).filter((d) => {
    const m = midnight(d)
    return m >= spanStartDay && m <= spanEndDay
  })

  // Which selected trips contain a given day (0 = a gap day, 2+ = an overlap).
  const owningTrips = (day) => {
    const d = midnight(day)
    return tripMetas.filter((t) => {
      const s = midnight(new Date(t.start_date + 'T00:00:00'))
      const e = midnight(new Date(t.end_date + 'T00:00:00'))
      return d >= s && d <= e
    })
  }

  // A booking is "continuing" on a day strictly inside its [start, end) span —
  // e.g. night 3 of a 6-night hotel. Those days aren't events: rendering a full
  // card for every night of a stay made the timeline one long wall of identical
  // hotel cards. Continuing stays render as a slim one-line row instead, and a
  // day whose only content is continuing stays counts as empty, so a run of
  // stay-only nights collapses to a single "5 days · Fairmont…" divider.
  const isContinuingOn = (bk, day) => {
    if (!bk.end_date) return false
    const d = midnight(day)
    const s = midnight(new Date(bk.start_date))
    const e = midnight(new Date(bk.end_date))
    return d > s && d < e
  }

  const dayData = days.map((day) => {
    const dateStr = toLocalDateStr(day)
    const allDayBookings = sortBookingsForDay(getBookingsForDate(bookings, day), day)
    const continuing = allDayBookings.filter((bk) => isContinuingOn(bk, day))
    const dayBookings = allDayBookings.filter((bk) => !isContinuingOn(bk, day))
    const dayTodos = todos.filter((t) => t.due_date && isSameDay(new Date(t.due_date + 'T00:00:00'), day))
    const dayNote = dayNotes.find((n) => n.date === dateStr)
    const dayRems = dayReminders.filter((r) => r.date === dateStr)
    const owners = owningTrips(day)
    const hasContent = dayBookings.length > 0 || dayTodos.length > 0 || !!dayNote || dayRems.length > 0
    const covered = hasOvernightCoverage(bookings, day)
    return { day, dateStr, dayBookings, continuing, dayTodos, dayNote, dayRems, owners, hasContent, covered }
  })

  // Group into segments. Days inside a selected trip ALWAYS render as days —
  // they're part of the trip even when nothing is booked (an ongoing stay shows
  // as a slim line; a truly empty trip day still earns its "No stay" badge).
  // Only maximal runs of days outside every selected trip collapse.
  const segments = []
  let run = null
  for (const d of dayData) {
    if (d.hasContent || d.owners.length > 0) {
      if (run) { segments.push({ type: 'run', days: run }); run = null }
      segments.push({ type: 'day', data: d })
    } else {
      if (!run) run = []
      run.push(d)
    }
  }
  if (run) segments.push({ type: 'run', days: run })

  const saveNote = async (dateStr, tripId) => {
    await onUpsertDayNote?.({ date: dateStr, title: noteText, trip_id: tripId })
    setEditingNoteDate(null)
  }

  return (
    <div ref={scrollerRef} className={`h-full overflow-y-auto ${compact ? 'px-3 py-3' : 'px-3 sm:px-5 py-4'}`}>
      <div className="max-w-3xl mx-auto space-y-1">
        {segments.map((seg) =>
          seg.type === 'run' ? (
            <RunDivider
              key={`run-${seg.days[0].dateStr}`}
              days={seg.days}
              tripMetas={tripMetas}
              colorMap={colorMap}
              expanded={expandedRuns.has(seg.days[0].dateStr)}
              onToggle={() =>
                setExpandedRuns((prev) => {
                  const next = new Set(prev)
                  const key = seg.days[0].dateStr
                  if (next.has(key)) next.delete(key)
                  else next.add(key)
                  return next
                })
              }
              onExtendTrip={onExtendTrip}
            />
          ) : (
            <DaySection
              key={seg.data.dateStr}
              data={seg.data}
              highlighted={highlightDate === seg.data.dateStr}
              colorMap={colorMap}
              tripNameById={tripNameById}
              showTripName={showTripName}
              isLastSpanDay={isSameDay(seg.data.day, spanEndDay)}
              today={today}
              editingNoteDate={editingNoteDate}
              setEditingNoteDate={setEditingNoteDate}
              noteText={noteText}
              setNoteText={setNoteText}
              saveNote={saveNote}
              onBookingClick={onBookingClick}
              onUpsertDayNote={onUpsertDayNote}
              onSelectDate={onSelectDate}
              reminderProps={{ onAddReminder, onEditReminder, onRemoveReminder, onReorderReminder }}
            />
          ),
        )}
      </div>
    </div>
  )
}

/** One content day: neutral date header, then a rail-marked row per booking. */
function DaySection({
  data, highlighted = false, colorMap, tripNameById, showTripName, isLastSpanDay, today,
  editingNoteDate, setEditingNoteDate, noteText, setNoteText, saveNote,
  onBookingClick, onUpsertDayNote, onSelectDate, reminderProps,
}) {
  const { day, dateStr, dayBookings, continuing, dayTodos, dayNote, dayRems, owners, covered } = data
  const isToday = isSameDay(day, today)
  const isEditingThis = editingNoteDate === dateStr
  // Notes/reminders attach to the day's trip. On an overlap day, default to the
  // first owning trip (the Add Booking picker handles the ambiguous case).
  const noteTripId = owners[0]?.id ?? null
  const noStay = !isLastSpanDay && !covered

  return (
    <section
      data-journey-date={dateStr}
      className={`pt-3 first:pt-0 -mx-2 px-2 pb-1 rounded-lg transition-colors duration-500 ${
        highlighted ? 'bg-primary-light/70' : ''
      }`}
    >
      {/* Neutral day header (trip identity lives on the rows, not the header). */}
      <div className="flex items-center gap-2 mb-1.5">
        <button
          onClick={() => onSelectDate?.(day)}
          title="Open day view"
          className={`text-sm font-semibold hover:underline shrink-0 whitespace-nowrap ${isToday ? 'text-primary' : 'text-on-surface'}`}
        >
          {day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
        </button>
        {isToday && (
          <span className="text-[10px] bg-primary-light text-primary px-2 py-0.5 rounded-full font-medium shrink-0">Today</span>
        )}
        {noStay && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-500 text-[11px] shrink-0" title="No accommodation booked">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-medium whitespace-nowrap">No stay</span>
          </span>
        )}
        {dayNote && !isEditingThis && (
          <button
            onClick={() => { setEditingNoteDate(dateStr); setNoteText(dayNote.title) }}
            className="text-xs italic text-on-surface-variant truncate min-w-0 hover:text-primary transition-colors"
          >
            {dayNote.title}
          </button>
        )}
        <div className="flex-1" />
        {!isEditingThis && !dayNote && onUpsertDayNote && noteTripId && (
          <button
            onClick={() => { setEditingNoteDate(dateStr); setNoteText('') }}
            className="text-outline hover:text-on-surface-variant transition-colors shrink-0"
            title="Add day title"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </div>

      {isEditingThis && (
        <form
          className="mb-2"
          onSubmit={(e) => { e.preventDefault(); saveNote(dateStr, noteTripId) }}
        >
          <input
            type="text"
            autoFocus
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onBlur={() => saveNote(dateStr, noteTripId)}
            placeholder="Day title (optional)"
            className="w-full px-3 py-1.5 text-xs italic text-on-surface-variant bg-surface-container border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </form>
      )}

      {dayTodos.length > 0 && (
        <ul className="space-y-1.5 mb-2">
          {dayTodos.map((todo) => (
            <li key={todo.id} className="flex items-center gap-2.5 pl-3">
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
      )}

      <div className="space-y-2">
        {dayBookings.map((booking) => {
          const color = colorMap[booking.trip_id]
          return (
            <div key={booking.id} className="flex items-stretch gap-2">
              {/* Trip rail — the second visual channel (booking type stays on the
                  card's own colored border). */}
              <span className={`w-1 rounded-full shrink-0 ${color?.rail || 'bg-outline/40'}`} aria-hidden />
              <div className="flex-1 min-w-0">
                {showTripName && (
                  <div className={`text-[10px] font-medium mb-0.5 truncate ${color?.text || 'text-on-surface-variant'}`}>
                    {tripNameById[booking.trip_id] || ''}
                  </div>
                )}
                {/* Phones get the one-line compact card — the full detail card
                    (check-in grid, address, notes) ate most of a small screen
                    per booking. Details stay one tap away in the modal. */}
                <div className="sm:hidden">
                  <BookingCard booking={booking} onClick={onBookingClick} hideTrip displayDate={day} compact />
                </div>
                <div className="hidden sm:block">
                  <BookingCard booking={booking} onClick={onBookingClick} hideTrip displayDate={day} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Ongoing stays are background, not events — the same mid-stay chips the
          mobile month view uses (amber "night x/y" pill; purple for cruises). */}
      {continuing.length > 0 && (
        <div className={`flex flex-wrap gap-1 pl-3 ${dayBookings.length > 0 ? 'mt-1.5' : ''}`}>
          {continuing.map((bk) => {
            const isCruise = bk.type === 'cruise'
            const start = new Date(bk.start_date)
            const end = bk.end_date ? new Date(bk.end_date) : null
            const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
            const endDay = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate()) : null
            const viewDay = new Date(day.getFullYear(), day.getMonth(), day.getDate())
            const totalNights = endDay ? Math.round((endDay - startDay) / 86400000) : null
            const nightNumber = Math.round((viewDay - startDay) / 86400000) + 1
            return (
              <button
                key={bk.id}
                onClick={() => onBookingClick?.(bk)}
                className={`inline-flex items-center gap-1 min-w-0 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
                  isCruise
                    ? 'bg-purple-100 text-purple-800 hover:bg-purple-200'
                    : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                }`}
              >
                <span className="shrink-0" aria-hidden>{isCruise ? '🚢' : TYPE_ICONS[bk.type] || '🏡'}</span>
                <span className="truncate">{isCruise ? 'On board' : bk.title}</span>
                {totalNights != null && totalNights > 0 && (
                  <span className={`font-normal shrink-0 ${isCruise ? 'text-purple-600' : 'text-amber-600'}`}>
                    {nightNumber}/{totalNights}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {reminderProps.onAddReminder && (
        <div className="mt-2 pl-3">
          <DayReminders
            reminders={dayRems}
            date={dateStr}
            tripId={noteTripId}
            onAdd={reminderProps.onAddReminder}
            onEdit={reminderProps.onEditReminder}
            onRemove={reminderProps.onRemoveReminder}
            onReorder={reminderProps.onReorderReminder}
            variant="agenda"
          />
        </div>
      )}
    </section>
  )
}

/**
 * A collapsed run of empty days. The label states its length; a lone night with
 * no bed reads "1 day — no accommodation booked". Expands to per-day rows.
 *
 * When the run contains gap days (belonging to no selected trip), it offers
 * "add to <trip>" actions that extend the abutting trip to cover the gap — the
 * collapsed action covers the whole run; per-day actions let a gap be split
 * between the trailing and leading trip.
 */
function RunDivider({ days, tripMetas, colorMap, expanded, onToggle, onExtendTrip }) {
  const [busy, setBusy] = useState(false)
  const length = days.length
  const single = length === 1
  // When every day of the run sits inside the same single ongoing stay, name it:
  // "5 days · Fairmont Pacific Rim" reads as the stay it is, not as a hole.
  const stayIds = new Set(days.flatMap((d) => d.continuing.map((b) => b.id)))
  const uniformStay =
    stayIds.size === 1 && days.every((d) => d.continuing.length === 1) ? days[0].continuing[0] : null
  const label = single
    ? (days[0].covered ? '1 day' : '1 day — no accommodation booked')
    : `${length} days`

  const firstStr = days[0].dateStr
  const lastStr = days[length - 1].dateStr
  const hasGap = days.some((d) => d.owners.length === 0)

  // The nearest trip ending before the run (extend its end forward) and the
  // nearest trip starting after it (extend its start backward). Gaps only occur
  // between two trips, so both normally exist.
  const before = tripMetas
    .filter((t) => t.end_date < firstStr)
    .sort((a, b) => (a.end_date < b.end_date ? 1 : -1))[0] || null
  const after = tripMetas
    .filter((t) => t.start_date > lastStr)
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1))[0] || null

  const extend = async (trip, patch) => {
    if (busy) return
    setBusy(true)
    try { await onExtendTrip?.(trip.id, patch) } finally { setBusy(false) }
  }

  // A plain render helper (not a nested component) — extends `trip` by `patch`.
  const renderAdd = (trip, patch) => (
    <button
      key={`${trip.id}-${patch.start_date || patch.end_date}`}
      onClick={() => extend(trip, patch)}
      disabled={busy}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors disabled:opacity-50 ${colorMap[trip.id]?.text || 'text-on-surface-variant'} ${colorMap[trip.id]?.border || 'border-outline/40'} hover:bg-surface-container`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${colorMap[trip.id]?.rail || 'bg-outline/40'}`} aria-hidden />
      <span className="truncate max-w-[9rem]">add to {trip.name}</span>
    </button>
  )

  return (
    <div className="py-1">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 text-[11px] text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <span className="flex-1 border-t border-dashed border-outline/40" />
        <span className="inline-flex items-center gap-1 px-2 whitespace-nowrap min-w-0">
          <svg className={`w-3 h-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="shrink-0">{label}</span>
          {uniformStay && (
            <span className="truncate max-w-[14rem]">
              · {TYPE_ICONS[uniformStay.type] || ''} {uniformStay.title}
            </span>
          )}
        </span>
        <span className="flex-1 border-t border-dashed border-outline/40" />
      </button>

      {/* Collapsed: one action per abutting trip, covering the whole run. */}
      {hasGap && !expanded && (
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
          {before && renderAdd(before, { end_date: lastStr })}
          {after && renderAdd(after, { start_date: firstStr })}
        </div>
      )}

      {expanded && (
        <div className="mt-1.5 space-y-1 pl-3">
          {days.map((d) => {
            const isGap = d.owners.length === 0
            return (
              <div key={d.dateStr} className="flex items-center gap-2 flex-wrap text-xs text-on-surface-variant">
                <span className="w-28 shrink-0">
                  {d.day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
                {isGap ? (
                  <>
                    {before && renderAdd(before, { end_date: d.dateStr })}
                    {after && renderAdd(after, { start_date: d.dateStr })}
                    {!before && !after && <span className="text-on-surface-variant/60">no trip</span>}
                  </>
                ) : (
                  <span className="text-on-surface-variant/60 truncate min-w-0">
                    {d.covered
                      ? d.continuing.map((b) => b.title).join(', ')
                      : 'no accommodation'}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
