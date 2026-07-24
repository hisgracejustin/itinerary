import { useState, useRef, useMemo } from 'react'
import BookingForm from './BookingForm'
import BookingDetails from './BookingDetails'
import AttachmentsSection from './AttachmentsSection'
import UploadBooking from './UploadBooking'
import { useToast } from './Toast'
import { friendlyError } from '../lib/friendlyError'

/** Upload files staged in the browser to a saved booking. Best-effort per file. */
async function uploadStagedFiles(bookingId, files) {
  for (const file of files) {
    const body = new FormData()
    body.append('booking_id', bookingId)
    body.append('file', file)
    const res = await fetch('/api/attachments', { method: 'POST', body })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error(data?.error || `Failed to attach ${file.name}`)
    }
  }
}

function mergeAsLayover(legs) {
  // Merge multiple flight legs into one booking with layover info
  const first = legs[0]
  const last = legs[legs.length - 1]
  const layovers = []
  for (let i = 0; i < legs.length - 1; i++) {
    layovers.push({
      airport: legs[i].details?.arrival_airport || '',
      arrival: legs[i].end_date,
      departure: legs[i + 1].start_date,
      flight_number: legs[i].details?.flight_number || '',
    })
  }
  // One merged booking carries one price, so the legs' fares are totalled.
  // Parsed legs frequently carry no fare at all (itineraries rarely show it) —
  // then leave it blank rather than inventing a 0 to fill in by hand.
  const priced = legs.filter((l) => Number.isFinite(parseFloat(l.cost_amount)))
  const currencies = [...new Set(priced.map((l) => l.cost_currency).filter(Boolean))]
  // Separately-ticketed legs can be priced in different currencies; adding those
  // together would silently invent a wrong number, so leave it for the user.
  const sameCurrency = currencies.length <= 1
  const total = priced.reduce((sum, l) => sum + parseFloat(l.cost_amount), 0)
  return {
    ...first,
    title: `${first.details?.departure_airport || ''} → ${last.details?.arrival_airport || ''}`,
    end_date: last.end_date,
    // Rounded: summing floats yields 29.979999999999997, which would land in the
    // cost field verbatim.
    cost_amount: priced.length && sameCurrency ? Math.round(total * 100) / 100 : null,
    cost_currency: currencies[0] ?? null,
    details: {
      ...first.details,
      arrival_airport: last.details?.arrival_airport || '',
      layovers,
    },
  }
}

export default function BookingModal({ booking, onClose, onSave, onDelete, selectedTrip, tripName }) {
  const [saving, setSaving] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [mode, setMode] = useState('manual') // 'manual' | 'upload' | 'multi-review'
  const [parsedBookings, setParsedBookings] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [savedCount, setSavedCount] = useState(0)
  const [savedIndices, setSavedIndices] = useState(new Set())
  const [treatAsLayover, setTreatAsLayover] = useState(false)
  // The booking currently shown (updated in place after save so view mode reflects
  // fresh data). null until a brand-new booking is created.
  const [current, setCurrent] = useState(booking)
  const [editing, setEditing] = useState(!booking) // existing → view first; new → edit
  const [stagedFiles, setStagedFiles] = useState([]) // pending attachments for a not-yet-saved booking
  const { toast } = useToast()
  const formRef = useRef(null)
  const isEdit = !!booking
  const viewMode = !!current && !editing && mode !== 'multi-review'

  // Whether all parsed bookings are flights (layover-eligible)
  const allFlights = parsedBookings.length > 1 && parsedBookings.every(b => b.type === 'flight')

  const currentParsedBooking = parsedBookings[currentIndex] || null
  // The merged single booking the form is pre-filled with in layover mode.
  // Memoised deliberately: BookingForm re-seeds its fields from a useEffect keyed
  // on this prop, so a fresh object on every modal re-render would discard
  // whatever the user had typed.
  const layoverBooking = useMemo(
    () =>
      mode === 'multi-review' && treatAsLayover && parsedBookings.length > 0
        ? mergeAsLayover(parsedBookings)
        : null,
    [mode, treatAsLayover, parsedBookings],
  )

  const handleSave = async (formData) => {
    setSaving(true)
    try {
      // BookingForm is provenance-agnostic (it only emits its own fields), so
      // stamp AI-parsed saves here — layover, per-leg and single-parse alike.
      // Otherwise the DB records them as source: 'manual'.
      const payload = { ...formData }
      if (!current && parsedBookings.length > 0) {
        payload.source = 'parsed'
        const seed = layoverBooking || currentParsedBooking
        if (seed?.source_file) payload.source_file = seed.source_file
        if (seed?.raw_text) payload.raw_text = seed.raw_text
      }
      // Pass the existing id (if any) so the caller updates rather than inserts —
      // e.g. re-editing a booking just created in this same modal session.
      const saved = await onSave(payload, current?.id ?? null)
      // Layover mode collapses the parsed legs into ONE booking, so it takes the
      // single-save path (upload the source document, then show the result)
      // rather than the multi-review "advance to the next leg" flow.
      if (mode === 'multi-review' && !treatAsLayover) {
        // Attach the source document to each saved booking, then advance.
        if (saved?.id && stagedFiles.length > 0) {
          try { await uploadStagedFiles(saved.id, stagedFiles) } catch (e) { toast.error(friendlyError(e)) }
        }
        const newSaved = savedCount + 1
        setSavedCount(newSaved)
        setSavedIndices(prev => new Set([...prev, currentIndex]))
        if (newSaved === parsedBookings.length) {
          toast.success(`All ${newSaved} bookings saved!`)
          onClose()
        } else if (currentIndex < parsedBookings.length - 1) {
          setCurrentIndex(currentIndex + 1)
          toast.success(`Booking saved! (${parsedBookings.length - newSaved} remaining)`)
        } else {
          toast.success(`Booking saved! (${parsedBookings.length - newSaved} remaining)`)
        }
      } else {
        // Upload any staged attachments (new bookings) now that we have an id.
        if (saved?.id && stagedFiles.length > 0) {
          try { await uploadStagedFiles(saved.id, stagedFiles) } catch (e) { toast.error(friendlyError(e)) }
        }
        setStagedFiles([])
        toast.success(
          treatAsLayover
            ? 'Saved as 1 flight with layovers'
            : isEdit ? 'Booking updated' : 'Booking added',
        )
        // Return to the read-only view showing fresh data + attachments. Leaving
        // multi-review is what lets that view render after a layover save.
        if (saved?.id) {
          setMode('manual')
          setTreatAsLayover(false)
          // Discard the parse: the modal now stays open on the saved booking, so
          // leftover legs would otherwise seed the form when the user clicks Edit
          // — and saving that would overwrite the merged booking with leg 1.
          setParsedBookings([])
          setCurrentIndex(0)
          setSavedCount(0)
          setSavedIndices(new Set())
          setCurrent(saved)
          setEditing(false)
        } else {
          onClose()
        }
      }
    } catch (err) {
      toast.error(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await onDelete((current || booking).id)
      toast.success('Booking deleted')
      onClose()
    } catch (err) {
      toast.error(friendlyError(err))
    }
  }

  const handleParsed = (bookings, sourceFile) => {
    setParsedBookings(bookings)
    // Keep the uploaded document so it's attached to the resulting booking(s).
    if (sourceFile) setStagedFiles([sourceFile])
    if (bookings.length === 1) {
      setMode('manual')
      toast.success('Booking parsed! Review and save.')
    } else {
      setMode('multi-review')
      setCurrentIndex(0)
      setSavedCount(0)
      setSavedIndices(new Set())
      toast.success(`Parsed ${bookings.length} bookings!`)
    }
  }

  return (
    // Sizing note: the modal is capped by max-h-full against this wrapper —
    // never by vh units. On iOS Safari 100vh is the LARGEST viewport (browser
    // chrome ignored), so a vh-sized modal ran past the visible bottom and put
    // the Save footer out of reach. The fixed inset-0 wrapper tracks the real
    // visible viewport; its padding (incl. home-indicator safe area) is what
    // keeps the modal inside it.
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-4 sm:pt-[8vh] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] animate-fade-in">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-elevation-4 w-full max-w-lg max-h-full flex flex-col animate-scale-in overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-outline/30 px-6 py-5 flex items-center justify-between rounded-t-2xl z-10 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-medium text-on-surface truncate max-w-[16rem]">
                {viewMode
                  ? (current?.title || 'Booking')
                  : mode === 'multi-review'
                  ? `Booking ${currentIndex + 1} of ${parsedBookings.length}`
                  : current
                  ? 'Edit Booking'
                  : 'New Booking'}
              </h2>
              {viewMode && (
                <button
                  onClick={() => setEditing(true)}
                  className="mat-icon-btn shrink-0"
                  title="Edit booking"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              )}
              {mode === 'multi-review' && !treatAsLayover && parsedBookings.length > 1 && (
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
                    disabled={currentIndex === 0}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <button
                    onClick={() => setCurrentIndex(i => Math.min(parsedBookings.length - 1, i + 1))}
                    disabled={currentIndex === parsedBookings.length - 1}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </button>
                </div>
              )}
            </div>
            {!current && mode !== 'multi-review' && (
              <div className="flex items-center gap-1 mt-2">
                <button
                  onClick={() => setMode('manual')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    mode === 'manual'
                      ? 'bg-primary-light text-accent-ink'
                      : 'text-on-surface-variant hover:bg-gray-100'
                  }`}
                >
                  Add Manually
                </button>
                <button
                  onClick={() => setMode('upload')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    mode === 'upload'
                      ? 'bg-primary-light text-accent-ink'
                      : 'text-on-surface-variant hover:bg-gray-100'
                  }`}
                >
                  📄 Upload Document
                </button>
              </div>
            )}
            {mode === 'multi-review' && allFlights && (
              <div className="flex items-center gap-2 mt-2">
                {/* Once a leg is saved individually there's no correct merge —
                    it would duplicate the saved leg inside the merged booking —
                    so the strategy switch is off the table, not silently wrong. */}
                <button
                  onClick={() => setTreatAsLayover(!treatAsLayover)}
                  disabled={savedIndices.size > 0}
                  title={savedIndices.size > 0 ? 'Some legs are already saved as separate bookings' : undefined}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    treatAsLayover
                      ? 'bg-orange-100 text-orange-700'
                      : 'text-on-surface-variant hover:bg-gray-100 border border-outline/40'
                  }`}
                >
                  {treatAsLayover ? '✓ Layover mode' : 'Treat as layover'}
                </button>
                {treatAsLayover && (
                  <span className="text-[10px] text-on-surface-variant">Saves as 1 flight with stops</span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="mat-icon-btn"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 px-6 py-5 overflow-y-auto overflow-x-hidden">
          {showDelete ? (
            <div className="text-center py-8">
              <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-on-surface mb-2">Delete this booking?</h3>
              <p className="text-sm text-on-surface-variant mb-8">
                "{(current || booking)?.title}" will be permanently removed. This cannot be undone.
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => setShowDelete(false)}
                  className="mat-btn-outlined"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium bg-red-600 text-white shadow-md hover:bg-red-700 active:scale-[0.97] transition-all duration-200"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : viewMode ? (
            <div className="space-y-6">
              <BookingDetails booking={current} />
              <AttachmentsSection bookingId={current.id} mode="view" />
            </div>
          ) : mode === 'upload' && !current ? (
            <UploadBooking trip={tripName} onParsed={handleParsed} />
          ) : (
            <div className="space-y-6">
              {/* Layover mode summarises the merge, then hands over to the same
                  editable form as every other path — so price, trip and
                  confirmation stay reviewable before saving. */}
              {layoverBooking && <LayoverPreview legs={parsedBookings} />}
              <BookingForm
                key={
                  mode === 'multi-review'
                    ? (treatAsLayover ? 'layover' : `parsed-${currentIndex}`)
                    : 'form'
                }
                // `current` wins once a booking exists: editing a saved booking
                // must never re-seed from a parsed leg.
                booking={current || layoverBooking || currentParsedBooking}
                onSave={handleSave}
                onDelete={() => setShowDelete(true)}
                onCancel={onClose}
                saving={saving}
                formRef={formRef}
                selectedTrip={selectedTrip}
              />
              {/* Hidden while stepping through separate legs (the document is
                  attached to each automatically), but shown for a layover since
                  that saves once, like a normal booking. */}
              {(mode !== 'multi-review' || treatAsLayover) && (
                <AttachmentsSection
                  bookingId={current?.id ?? null}
                  mode="edit"
                  stagedFiles={stagedFiles}
                  setStagedFiles={setStagedFiles}
                />
              )}
            </div>
          )}
        </div>

        {/* View-mode footer */}
        {viewMode && (
          <div className="border-t border-outline/20 px-6 py-4 flex items-center justify-end shrink-0 rounded-b-2xl">
            <button type="button" onClick={onClose} className="mat-btn-outlined">
              Close
            </button>
          </div>
        )}

        {/* Fixed footer */}
        {!viewMode && !showDelete && !(mode === 'upload' && !current) && (
          <div className="border-t border-outline/20 px-6 py-4 flex items-center justify-between shrink-0 rounded-b-2xl">
            <div>
              {current && (
                <button
                  type="button"
                  onClick={() => setShowDelete(true)}
                  className="text-sm text-red-600 hover:text-red-700 font-medium hover:bg-red-50 px-3 py-1.5 rounded-full transition-all duration-150"
                >
                  Delete Booking
                </button>
              )}
              {mode === 'multi-review' && !treatAsLayover && savedCount > 0 && (
                <span className="text-xs text-on-surface-variant">
                  {savedCount} of {parsedBookings.length} saved
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="mat-btn-outlined"
              >
                Cancel
              </button>
              {/* One save path for every mode: submit the form, so validation,
                  the out-of-trip-dates warning and the attachment upload all
                  apply to layovers too. */}
              <button
                type="button"
                onClick={() => formRef.current?.requestSubmit()}
                disabled={
                  saving ||
                  (mode === 'multi-review' && !treatAsLayover && savedIndices.has(currentIndex))
                }
                className={`mat-btn-filled disabled:opacity-50 disabled:shadow-none ${mode === 'multi-review' && !treatAsLayover && savedIndices.has(currentIndex) ? 'bg-green-600 hover:bg-green-600' : ''}`}
              >
                {saving
                  ? 'Saving...'
                  : current
                  ? 'Update'
                  : treatAsLayover
                  ? 'Save as 1 Flight'
                  : mode === 'multi-review'
                  ? savedIndices.has(currentIndex) ? `✓ Saved` : `Save Booking ${currentIndex + 1}`
                  : 'Add Booking'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Preview of merged layover flight */
function LayoverPreview({ legs }) {
  if (!legs.length) return null
  const first = legs[0]
  const last = legs[legs.length - 1]

  return (
    <div className="space-y-4">
      <p className="text-xs text-on-surface-variant">
        These {legs.length} flight legs will be saved as a single booking with layover info.
      </p>

      {/* Visual route */}
      <div className="bg-gray-50 rounded-xl p-4">
        {legs.map((leg, i) => {
          const dep = leg.details?.departure_airport || '???'
          const arr = leg.details?.arrival_airport || '???'
          const flightNum = leg.details?.flight_number || ''
          const depTime = leg.start_date ? new Date(leg.start_date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
          const arrTime = leg.end_date ? new Date(leg.end_date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

          return (
            <div key={i}>
              {/* Flight leg */}
              <div className="flex items-center gap-3">
                <div className="text-center min-w-[48px]">
                  <div className="text-sm font-semibold text-on-surface">{dep}</div>
                  <div className="text-[10px] text-on-surface-variant">{depTime}</div>
                </div>
                <div className="flex-1 flex items-center">
                  <div className="h-px flex-1 bg-primary/40" />
                  <div className="px-2 text-[10px] text-primary font-medium">✈ {flightNum}</div>
                  <div className="h-px flex-1 bg-primary/40" />
                </div>
                <div className="text-center min-w-[48px]">
                  <div className="text-sm font-semibold text-on-surface">{arr}</div>
                  <div className="text-[10px] text-on-surface-variant">{arrTime}</div>
                </div>
              </div>

              {/* Layover indicator between legs */}
              {i < legs.length - 1 && (
                <div className="flex items-center gap-2 py-2 pl-12">
                  <div className="w-2 h-2 rounded-full bg-orange-400" />
                  <div className="text-xs text-orange-600 font-medium">
                    Layover at {arr}
                    {leg.end_date && legs[i + 1].start_date && (
                      <span className="text-on-surface-variant font-normal ml-1">
                        ({formatLayoverDuration(leg.end_date, legs[i + 1].start_date)})
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Summary */}
      <div className="text-sm text-on-surface">
        <span className="font-medium">{first.details?.departure_airport}</span>
        <span className="text-on-surface-variant mx-1">→</span>
        {legs.length > 2 && legs.slice(1, -1).map((l, i) => (
          <span key={i}>
            <span className="text-orange-600">{l.details?.departure_airport}</span>
            <span className="text-on-surface-variant mx-1">→</span>
          </span>
        ))}
        {legs.length === 2 && (
          <>
            <span className="text-orange-600">{first.details?.arrival_airport}</span>
            <span className="text-on-surface-variant mx-1">→</span>
          </>
        )}
        <span className="font-medium">{last.details?.arrival_airport}</span>
      </div>

      <div className="text-xs text-on-surface-variant">
        Provider: {first.provider || 'Unknown'} · Confirmation: {first.confirmation_number || 'N/A'}
      </div>
    </div>
  )
}

function formatLayoverDuration(arrivalISO, departureISO) {
  const arr = new Date(arrivalISO)
  const dep = new Date(departureISO)
  const diffMs = dep - arr
  if (diffMs <= 0) return ''
  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  const mins = Math.round((diffMs % (1000 * 60 * 60)) / (1000 * 60))
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`
  if (hours > 0) return `${hours}h`
  return `${mins}m`
}
