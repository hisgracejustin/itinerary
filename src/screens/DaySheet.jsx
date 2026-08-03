'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import JourneyView from '../components/JourneyView'
import BookingDetails from '../components/BookingDetails'
import { TripContext } from '../lib/trip-context'
import { tripColorMap } from '../lib/calendar'
import { formatBytes, iconForMime } from '../lib/attachments'
import { readAttachment } from '../lib/offline-sheet'

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
  activeFrom,
}) {
  // Default: every trip that hasn't ended yet (naive date strings, lexicographic
  // compare). `activeFrom` is the oldest end_date that still counts as running,
  // and comes from the server so the first paint matches the HTML — it is NOT
  // plain "today"; see src/app/sheet/page.tsx for the slack it carries.
  const defaultIds = useMemo(
    () => trips.filter((t) => t.end_date >= activeFrom).map((t) => t.id),
    [trips, activeFrom],
  )
  const [selected, setSelected] = useState(defaultIds)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [activeBooking, setActiveBooking] = useState(null)
  const [offline, setOffline] = useState(false)
  // Null until mounted: the server-rendered strip must not claim an age, or a
  // days-old cached copy would hydrate with a mismatched "synced" label.
  const [synced, setSynced] = useState(null)
  // Set when the user tries to leave while still offline — leaving would only
  // serve this same cached page back, which reads as a pointless refresh, so
  // stay put and say why instead.
  const [stillOffline, setStillOffline] = useState(false)

  const onBack = (e) => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      e.preventDefault()
      setStillOffline(true)
      window.setTimeout(() => setStillOffline(false), 3500)
    }
  }

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

  // In-sheet attachment viewer: { filename, mime, blob, url } with a blob: url,
  // or { filename, missing: true } when the file isn't cached and there's no
  // connection to fetch it with. The Blob itself is kept for Share.
  const [viewer, setViewer] = useState(null)
  const openAttachment = async (a) => {
    const blob = await readAttachment(`/api/attachments/${a.id}`)
    if (!blob) {
      setViewer({ filename: a.filename, missing: true })
      return
    }
    setViewer({ filename: a.filename, mime: a.mime_type, blob, url: URL.createObjectURL(blob) })
  }
  const closeViewer = () => {
    if (viewer?.url) URL.revokeObjectURL(viewer.url)
    setViewer(null)
  }

  // Hand the cached bytes to the OS share sheet (AirDrop / Save to Files /
  // Mail…) — works offline since the file is already on the device. Falls back
  // to a plain download when file-sharing isn't available (desktop browsers).
  const shareViewerFile = async () => {
    if (!viewer?.blob) return
    const file = new File([viewer.blob], viewer.filename, { type: viewer.mime || 'application/octet-stream' })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] })
        return
      } catch {
        /* user cancelled, or share failed — fall through to download */
      }
    }
    const a = document.createElement('a')
    a.href = viewer.url
    a.download = viewer.filename
    a.click()
  }

  return (
    <TripContext.Provider value={ctx}>
      <div className="fixed inset-0 flex flex-col bg-surface-dim pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <header className="shrink-0 bg-white border-b border-outline/40">
          <div className="flex items-center gap-2 h-14 px-3">
            {/* Hard <a> (not <Link>): the sheet lives outside the app shell,
                and in the installed PWA there's no browser chrome to escape
                with. A document request is also what the service worker can
                answer offline — where it just falls back to this page. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              onClick={onBack}
              aria-label="Back to app"
              className="shrink-0 flex items-center gap-1 -ml-1 px-2 py-1.5 rounded-full text-sm text-on-surface-variant hover:bg-surface-container transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </a>
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
          <span className={`truncate ${stillOffline ? 'font-semibold' : ''}`}>
            {stillOffline
              ? 'Still no internet connection — showing your saved itinerary'
              : offline
                ? 'No internet connection — showing your saved itinerary'
                : 'Saved for offline'}
            {!stillOffline && synced && ` · ${offline ? 'saved' : 'synced'} ${synced}`}
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
                          {/* Cached alongside the sheet (upcoming bookings
                              only). Never a plain navigation: reads the bytes
                              cache-first — no worker interception required —
                              and shows them in the in-sheet viewer, which also
                              sidesteps iOS standalone new-tab weirdness. */}
                          <button
                            onClick={() => openAttachment(a)}
                            className="text-xs font-medium text-primary hover:underline px-1.5 py-1 shrink-0"
                          >
                            Open
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Attachment viewer — blob-backed, so it works with no connection and
            no service worker. Sits above the detail sheet. */}
        {viewer && (
          <AttachmentViewer
            key={viewer.url || viewer.filename}
            viewer={viewer}
            onClose={closeViewer}
            onShare={shareViewerFile}
          />
        )}
      </div>
    </TripContext.Provider>
  )
}

/**
 * Full-screen attachment viewer over the sheet. Zoom works on every file type:
 * images get pinch / drag-pan / double-tap via pointer events on a transform,
 * while PDFs (and anything else in the iframe) zoom by growing the iframe's
 * layout width — a transform would break the native PDF viewer's internal
 * scrolling, but a wider iframe just makes its fit-to-width rendering bigger,
 * with the outer container scrolling both axes. The − / % / + pill works for
 * both; % resets.
 */
function AttachmentViewer({ viewer, onClose, onShare }) {
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const pointers = useRef(new Map())
  const pinch = useRef(null)
  const lastTap = useRef(0)
  const isImage = !viewer.missing && viewer.mime?.startsWith('image/')

  const setZoom = (next) => {
    // 50%–500%: zooming OUT below fit matters for tall tickets and wide PDFs.
    // Round to 2dp so repeated ±0.1 steps don't drift into 0.30000000000000004.
    const clamped = Math.round(Math.min(5, Math.max(0.5, next)) * 100) / 100
    setScale(clamped)
    if (clamped <= 1) setPan({ x: 0, y: 0 })
  }
  const pinchDist = () => {
    const [a, b] = [...pointers.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) pinch.current = { startDist: pinchDist(), startScale: scale }
  }
  const onPointerMove = (e) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && pinch.current) {
      setZoom(pinch.current.startScale * (pinchDist() / pinch.current.startDist))
    } else if (pointers.current.size === 1 && scale > 1) {
      setPan((p) => ({ x: p.x + e.clientX - prev.x, y: p.y + e.clientY - prev.y }))
    }
  }
  const onPointerEnd = (e) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (e.type === 'pointerup' && pointers.current.size === 0) {
      const now = Date.now()
      if (now - lastTap.current < 300) setZoom(scale > 1 ? 1 : 2.5)
      lastTap.current = now
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/80" role="dialog" aria-modal="true">
      <div className="shrink-0 flex items-center gap-1 px-3 h-12 pt-[env(safe-area-inset-top)] box-content">
        <p className="flex-1 min-w-0 truncate text-sm text-white">{viewer.filename}</p>
        {!viewer.missing && (
          <button
            onClick={onShare}
            aria-label="Share or save"
            className="shrink-0 w-9 h-9 rounded-full text-white/80 hover:bg-white/10 flex items-center justify-center"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0-12L8 8m4-4l4 4" />
            </svg>
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="Close attachment"
          className="shrink-0 w-9 h-9 rounded-full text-white/80 hover:bg-white/10 text-xl"
        >
          ×
        </button>
      </div>

      {viewer.missing ? (
        <div className="flex-1 min-h-0 flex items-center justify-center p-2 pb-[env(safe-area-inset-bottom)]">
          <p className="text-sm text-white/80 text-center px-8">
            This file isn&apos;t saved on this device and there&apos;s no connection to fetch it.
          </p>
        </div>
      ) : isImage ? (
        <div
          className="flex-1 min-h-0 overflow-hidden touch-none flex items-center justify-center p-2"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- blob: url, next/image can't optimize it */}
          <img
            src={viewer.url}
            alt={viewer.filename}
            draggable={false}
            className="max-w-full max-h-full object-contain select-none"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto p-2">
          <iframe
            src={viewer.url}
            title={viewer.filename}
            className="rounded-lg bg-white"
            // Two regimes: growing layout width zooms IN (native fit-to-width
            // re-renders bigger, scrolling intact). Below 100% that doesn't
            // work — iOS's PDF renderer clips instead of reflowing smaller —
            // so zoom OUT renders at inflated layout size and visually scales
            // the whole frame down, which shrinks the page for real.
            style={
              scale >= 1
                ? { width: `${scale * 100}%`, height: '100%', margin: '0 auto' }
                : {
                    width: `${100 / scale}%`,
                    height: `${100 / scale}%`,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                  }
            }
          />
        </div>
      )}

      {!viewer.missing && (
        <div className="shrink-0 flex justify-center pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1.5">
          <div className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1">
            <button
              onClick={() => setZoom(scale - 0.1)}
              aria-label="Zoom out"
              className="w-8 h-8 rounded-full text-white/90 hover:bg-white/10 text-lg leading-none"
            >
              −
            </button>
            <button
              onClick={() => setZoom(1)}
              aria-label="Reset zoom"
              className="min-w-[3.5rem] h-8 rounded-full text-white/90 hover:bg-white/10 text-xs tabular-nums"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              onClick={() => setZoom(scale + 0.1)}
              aria-label="Zoom in"
              className="w-8 h-8 rounded-full text-white/90 hover:bg-white/10 text-lg leading-none"
            >
              +
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
