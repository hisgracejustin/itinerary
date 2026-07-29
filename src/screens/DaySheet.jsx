'use client'

import { useEffect, useMemo, useState } from 'react'
import JourneyView from '../components/JourneyView'
import BookingDetails from '../components/BookingDetails'
import { TripContext } from '../lib/trip-context'
import { tripColorMap } from '../lib/calendar'
import { formatBytes, iconForMime } from '../lib/attachments'

const STORAGE_KEY = 'sheet-trips'

/** "3 hours ago" / "2 days ago" — client-only, so a cached copy ages honestly. */
function relativeTime(iso) {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * The offline day sheet: the journey timeline plus read-only booking detail,
 * rendered entirely from props (see src/app/sheet/page.tsx). NOTHING here may
 * fetch, mutate, or navigate client-side — the page has to work with the radio
 * off, served from the service worker's cache.
 */
// NB: no default prop values — TS infers this component's prop types from them,
// and `= []` would type every list as never[] at the (TypeScript) call site.
export default function DaySheet({
  trips,
  bookings,
  todos,
  dayNotes,
  dayReminders,
  attachments,
  generatedAt,
  today,
}) {
  // Default: every trip that hasn't ended yet (naive date strings, lexicographic
  // compare). `today` comes from the server so the first paint matches the HTML.
  const defaultIds = useMemo(
    () => trips.filter((t) => t.end_date >= today).map((t) => t.id),
    [trips, today],
  )
  const [selected, setSelected] = useState(defaultIds)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeBooking, setActiveBooking] = useState(null)
  const [offline, setOffline] = useState(false)
  // Null until mounted: the server-rendered strip must not claim an age, or a
  // days-old cached copy would hydrate with a mismatched "synced" label.
  const [synced, setSynced] = useState(null)

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
      if (Array.isArray(saved)) {
        const valid = trips.filter((t) => saved.includes(t.id)).map((t) => t.id)
        if (valid.length) setSelected(valid)
      }
    } catch {
      /* bad/absent saved state — keep the still-running default */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only init
  }, [])

  useEffect(() => {
    const sync = () => {
      setOffline(!navigator.onLine)
      setSynced(relativeTime(generatedAt))
    }
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [generatedAt])

  const toggleTrip = (tripId) => {
    setSelected((prev) => {
      const next = prev.includes(tripId)
        ? prev.filter((id) => id !== tripId)
        : trips.filter((t) => prev.includes(t.id) || t.id === tripId).map((t) => t.id)
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* storage unavailable — selection just won't survive a reload */
      }
      return next
    })
  }

  const allTripIds = trips.map((t) => t.id)
  const colorMap = tripColorMap(allTripIds)
  const selectedSet = new Set(selected)
  const tripMetas = trips.filter((t) => selectedSet.has(t.id))
  const sheetBookings = bookings.filter((b) => selectedSet.has(b.trip_id))
  const startStr = tripMetas.reduce((min, t) => (!min || t.start_date < min ? t.start_date : min), null)
  const endStr = tripMetas.reduce((max, t) => (!max || t.end_date > max ? t.end_date : max), null)
  const spanStart = startStr ? new Date(startStr + 'T00:00:00') : null
  const spanEnd = endStr ? new Date(endStr + 'T00:00:00') : null

  // BookingDetails reads `trips` off the context for its split roster; the rest
  // of the value is filled in so any other context reader degrades sanely.
  const ctx = useMemo(
    () => ({
      selectedTrips: selected,
      tripMetas,
      spanStart: startStr,
      spanEnd: endStr,
      trips,
      fx: { rates: {}, rateDate: null, fetchedAt: null },
      toggleTrip,
      setSelectedTrips: () => {},
      selectedTrip: selected.length === 1 ? selected[0] : null,
      tripMeta: tripMetas.length === 1 ? tripMetas[0] : null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- derived from `selected`
    [selected, trips],
  )

  const activeFiles = activeBooking
    ? attachments.filter((a) => a.booking_id === activeBooking.id)
    : []

  return (
    <TripContext.Provider value={ctx}>
      <div className="fixed inset-0 flex flex-col bg-surface-dim pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <header className="shrink-0 bg-white border-b border-outline/40">
          <div className="flex items-center gap-2 h-14 px-3">
            <h1 className="text-base font-semibold text-on-surface truncate">Offline</h1>
            <div className="flex-1" />
            <div className="relative shrink-0">
              <button
                onClick={() => setPickerOpen((v) => !v)}
                aria-expanded={pickerOpen}
                className="flex items-center gap-1.5 max-w-[10rem] px-3 py-1.5 rounded-full text-sm text-on-surface bg-surface-container hover:bg-surface-container/70 transition-colors"
              >
                <span className="truncate">
                  {selected.length === 0
                    ? 'No trips'
                    : selected.length === 1
                      ? tripMetas[0]?.name
                      : `${selected.length} trips`}
                </span>
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {pickerOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                  <ul className="absolute right-0 top-full mt-1 z-50 w-64 max-h-[60vh] overflow-y-auto rounded-xl bg-white border border-outline/40 shadow-lg py-1">
                    {trips.length === 0 && (
                      <li className="px-3 py-2 text-sm text-on-surface-variant">No trips yet</li>
                    )}
                    {trips.map((trip) => {
                      const active = selectedSet.has(trip.id)
                      return (
                        <li key={trip.id}>
                          <button
                            onClick={() => toggleTrip(trip.id)}
                            aria-pressed={active}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-on-surface hover:bg-surface-container transition-colors"
                          >
                            <span
                              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                active ? 'bg-primary border-primary text-white' : 'border-outline/60 text-transparent'
                              }`}
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            </span>
                            <span className="flex-1 min-w-0 truncate">{trip.name}</span>
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${colorMap[trip.id]?.rail || 'bg-outline/40'}`}
                              aria-hidden
                            />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Sync strip. `synced` is null on the server render and on the very
            first client frame, so a cached copy never claims a stale age. */}
        <div
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[11px] ${
            offline ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${offline ? 'bg-amber-500' : 'bg-emerald-500'}`} aria-hidden />
          <span className="truncate">
            {offline ? 'Offline' : 'Saved for offline'}
            {synced && ` · ${offline ? 'saved' : 'synced'} ${synced}`}
          </span>
        </div>

        <div className="flex-1 min-h-0">
          {spanStart && spanEnd ? (
            <JourneyView
              bookings={sheetBookings}
              todos={todos}
              dayNotes={dayNotes}
              dayReminders={dayReminders}
              tripMetas={tripMetas}
              spanStart={spanStart}
              spanEnd={spanEnd}
              onBookingClick={setActiveBooking}
              allTripIds={allTripIds}
              compact
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-1 p-6 text-center">
              <p className="text-sm font-medium text-on-surface">No trips selected</p>
              <p className="text-xs text-on-surface-variant">Pick a trip from the menu above.</p>
            </div>
          )}
        </div>

        {activeBooking && (
          <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true">
            <div className="absolute inset-0 bg-black/40" onClick={() => setActiveBooking(null)} />
            <div className="relative w-full max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)]">
              <div className="sticky top-0 bg-white pt-2 px-4 pb-2 border-b border-outline/10">
                <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-outline/30" aria-hidden />
                <div className="flex items-center gap-2">
                  <h2 className="flex-1 min-w-0 truncate text-base font-semibold text-on-surface">
                    {activeBooking.title}
                  </h2>
                  <button
                    onClick={() => setActiveBooking(null)}
                    aria-label="Close"
                    className="shrink-0 text-on-surface-variant hover:text-on-surface p-1"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-surface-container text-[10px] text-on-surface-variant">
                  <span aria-hidden>🔒</span>
                  <span className="truncate">offline · read-only</span>
                </span>
              </div>

              <div className="p-4 space-y-4">
                <BookingDetails booking={activeBooking} />

                {activeFiles.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                      Attachments
                    </h3>
                    <ul className="space-y-1.5">
                      {activeFiles.map((a) => (
                        <li key={a.id} className="flex items-center gap-2 rounded-lg border border-outline/20 px-3 py-2">
                          <span className="text-lg shrink-0">{iconForMime(a.mime_type)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-on-surface truncate">{a.filename}</p>
                            <p className="text-[10px] text-on-surface-variant">{formatBytes(a.size_bytes)}</p>
                          </div>
                          {/* Cached by the service worker alongside the sheet —
                              only files on upcoming bookings are pre-warmed, so
                              an old one may still need a connection. */}
                          <a
                            href={`/api/attachments/${a.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-primary hover:underline px-1.5 py-1 shrink-0"
                          >
                            Open
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </TripContext.Provider>
  )
}
