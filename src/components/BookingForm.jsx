import { useState, useEffect } from 'react'
import { CURRENCIES, formatCurrency } from '../lib/currencies'
import { sanitizeCancellationPolicy } from '../lib/cancellation'
import { useTripContext } from '../lib/trip-context'
import SplitEditor from './SplitEditor'
import ChargedRateEditor from './ChargedRateEditor'

const BOOKING_TYPES = ['flight', 'train', 'bus', 'rental', 'cruise', 'hotel', 'activity']

const TYPE_LABELS = {
  flight: '✈️ Flight',
  train: '🚂 Train',
  bus: '🚌 Bus',
  rental: '🚗 Rental',
  cruise: '🚢 Cruise',
  hotel: '🏡 Accomm',
  activity: '🎯 Activity',
}

/** Type-specific detail field definitions */
const TYPE_FIELDS = {
  flight: [
    { key: 'departure_airport', label: 'Departure Airport', placeholder: 'SFO' },
    { key: 'arrival_airport', label: 'Arrival Airport', placeholder: 'NRT' },
    { key: 'flight_number', label: 'Flight Number', placeholder: 'UA837' },
    { key: 'seat', label: 'Seat', placeholder: '24A' },
    { key: 'terminal', label: 'Terminal', placeholder: '3' },
    { key: 'gate', label: 'Gate', placeholder: 'G12' },
    { key: 'notes', label: 'Notes', placeholder: '23kg checked · window seat requested', multiline: true },
  ],
  train: [
    { key: 'departure_station', label: 'Departure Station', placeholder: 'Tokyo Station' },
    { key: 'arrival_station', label: 'Arrival Station', placeholder: 'Osaka Station' },
    { key: 'train_number', label: 'Train Number', placeholder: 'Nozomi 1' },
    { key: 'car', label: 'Car', placeholder: '5' },
    { key: 'seat', label: 'Seat', placeholder: '3A' },
    { key: 'notes', label: 'Notes', placeholder: 'Reserved luggage rack', multiline: true },
  ],
  bus: [
    { key: 'departure_station', label: 'Departure Stop', placeholder: 'Central Bus Station' },
    { key: 'arrival_station', label: 'Arrival Stop', placeholder: 'Airport Terminal 1' },
    { key: 'bus_number', label: 'Bus/Route Number', placeholder: 'A1' },
    { key: 'seat', label: 'Seat', placeholder: '12' },
    { key: 'notes', label: 'Notes', placeholder: 'Pick-up at the north exit', multiline: true },
  ],
  rental: [
    { key: 'vehicle_type', label: 'Vehicle Type', options: ['Car', 'Motorcycle', 'RV / Camper', 'Scooter', 'Bicycle', 'Other'] },
    { key: 'pickup_location', label: 'Pick-up Location', placeholder: '51840 Dale Ln, Oakhurst, CA' },
    { key: 'dropoff_location', label: 'Drop-off Location', placeholder: 'Same as pick-up' },
    { key: 'insurance', label: 'Insurance', placeholder: 'Minimum coverage' },
    { key: 'maps_url', label: 'Google Maps URL', placeholder: 'https://maps.google.com/...' },
    { key: 'notes', label: 'Notes', placeholder: 'Host: Brian · +1 559 580 5820', multiline: true },
  ],
  cruise: [
    { key: 'ship_name', label: 'Ship Name', placeholder: 'Diamond Princess' },
    { key: 'cabin', label: 'Cabin', placeholder: 'A205' },
    { key: 'deck', label: 'Deck', placeholder: '8' },
    { key: 'departure_port', label: 'Departure Port', placeholder: 'Yokohama' },
    { key: 'arrival_port', label: 'Arrival Port', placeholder: 'Kobe' },
    { key: 'ports_of_call', label: 'Ports of Call (comma-separated)', placeholder: 'Nagasaki, Busan, Kagoshima' },
    { key: 'notes', label: 'Notes', placeholder: 'Dinner seating 19:30', multiline: true },
  ],
  hotel: [
    { key: 'address', label: 'Address', placeholder: '1-2-3 Shibuya, Tokyo' },
    { key: 'check_in_time', label: 'Check-in Time', placeholder: '15:00' },
    { key: 'check_out_time', label: 'Check-out Time', placeholder: '11:00' },
    { key: 'room_type', label: 'Room Type', placeholder: 'Deluxe King' },
    { key: 'maps_url', label: 'Google Maps URL', placeholder: 'https://maps.google.com/...' },
    { key: 'notes', label: 'Notes', placeholder: 'Host: +81 90 1234 5678 · late check-in', multiline: true },
  ],
  activity: [
    { key: 'location', label: 'Location', placeholder: 'Fushimi Inari Shrine' },
    { key: 'address', label: 'Address', placeholder: '68 Fukakusa, Fushimi-ku, Kyoto' },
    { key: 'duration', label: 'Duration', placeholder: '2 hours' },
    { key: 'maps_url', label: 'Google Maps URL', placeholder: 'https://maps.google.com/...' },
    { key: 'notes', label: 'Notes', placeholder: 'Bring comfortable shoes', multiline: true },
  ],
}

function toLocalDatetime(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  const offset = d.getTimezoneOffset()
  const local = new Date(d.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

export default function BookingForm({ booking, onSave, onDelete, onCancel, saving, formRef, selectedTrip }) {
  const isEdit = !!booking
  const { trips } = useTripContext()

  const [form, setForm] = useState({
    trip_id: selectedTrip || '',
    type: 'flight',
    title: '',
    start_date: '',
    end_date: '',
    confirmation_number: '',
    provider: '',
    cost_amount: '',
    cost_currency: 'USD',
    cost_share: '1',
    paid_by: '',
    splits: [],
    charged_currency: '',
    charged_rate: '',
    details: {},
  })

  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (booking) {
      setForm({
        trip_id: booking.trip_id || selectedTrip || '',
        type: booking.type || 'flight',
        title: booking.title || '',
        start_date: toLocalDatetime(booking.start_date),
        end_date: toLocalDatetime(booking.end_date),
        confirmation_number: booking.confirmation_number || '',
        provider: booking.provider || '',
        cost_amount: booking.cost_amount != null ? String(booking.cost_amount) : '',
        cost_currency: booking.cost_currency || 'USD',
        cost_share: booking.cost_share != null ? String(booking.cost_share) : '1',
        paid_by: booking.paid_by || '',
        splits: Array.isArray(booking.splits)
          ? booking.splits.map((s) => ({
              user_id: s.user_id,
              weight: Number(s.weight) || 1,
              extra_amount: Number(s.extra_amount) || 0,
            }))
          : [],
        charged_currency: booking.charged_currency || '',
        charged_rate: booking.charged_rate != null ? String(booking.charged_rate) : '',
        // ports_of_call is stored as an array (the cards join it), but the
        // generic detail input binds a string — an array would coerce to "a,b"
        // and save straight back as a string, breaking the .join() render.
        details: booking.details
          ? {
              ...booking.details,
              ...(Array.isArray(booking.details.ports_of_call)
                ? { ports_of_call: booking.details.ports_of_call.join(', ') }
                : {}),
            }
          : {},
      })
    }
  }, [booking])

  // The split roster follows the booking's own trip, not the sidebar selection.
  const splitTrip = (trips || []).find((t) => t.id === form.trip_id) || null
  const splitMembers = splitTrip?.members || []
  const splitParties = splitTrip?.parties || []

  // Moving a booking to another trip must not carry over people who don't belong
  // there — prune split rows (and a now-foreign payer) to the new trip's roster.
  useEffect(() => {
    // No roster resolved yet (mount, before the seed effect's trip lands) — do
    // NOT prune: this first run would apply an empty member set to the freshly
    // seeded state and silently wipe the booking's payer and splits.
    if (!splitTrip) return
    const memberIds = new Set(splitMembers.map((m) => m.id))
    setForm((prev) => {
      const prunedSplits = (prev.splits || []).filter((s) => memberIds.has(s.user_id))
      const prunedPayer = prev.paid_by && !memberIds.has(prev.paid_by) ? '' : prev.paid_by
      if (prunedSplits.length === (prev.splits || []).length && prunedPayer === prev.paid_by) {
        return prev
      }
      return { ...prev, splits: prunedSplits, paid_by: prunedPayer }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.trip_id, splitMembers.length])

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const setDetail = (key, value) => {
    setForm((prev) => ({ ...prev, details: { ...prev.details, [key]: value } }))
  }

  // Cancellation policy: a tier array, the 'non_refundable' marker, or absent
  // (unknown). Array.isArray, not `|| []` — the marker is a string, and mapping
  // over it would render one tier row per character.
  const nonRefundable = form.details.cancellation_policy === 'non_refundable'
  // Tier `value` is held as a string like cost_amount and parsed on save
  // (sanitizeCancellationPolicy drops the rows that never got filled in).
  const tiers = Array.isArray(form.details.cancellation_policy) ? form.details.cancellation_policy : []
  const setTiers = (next) => setDetail('cancellation_policy', next)
  const setTier = (index, patch) =>
    setTiers(tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)))

  const validate = () => {
    const errs = {}
    if (!form.trip_id) errs.trip_id = 'Trip is required'
    if (!form.title.trim()) errs.title = 'Title is required'
    if (!form.start_date) errs.start_date = 'Start date is required'
    // Skip end < start check for flights/trains — arrival time may be
    // "earlier" due to timezone differences (e.g. crossing date line)
    const skipTimeCheck = form.type === 'flight' || form.type === 'train'
    if (form.end_date && !skipTimeCheck && form.end_date < form.start_date) {
      errs.end_date = 'End date must be after start date'
    }
    // The Zod schema rejects a non-empty split set without a payer — surface it
    // here so the user fixes it before submit rather than seeing a save error.
    if (form.cost_amount && (form.splits || []).length > 0 && !form.paid_by) {
      errs.paid_by = 'Pick who paid before splitting this cost'
    }
    // Itemized extras can't sum past the splittable amount (extras come off the
    // top; a negative remainder is nonsensical and split.js would skip the item).
    if (form.cost_amount && (form.splits || []).length > 0 && !errs.paid_by) {
      const splittable = (parseFloat(form.cost_amount) || 0) * (parseFloat(form.cost_share) || 1)
      const sumExtras = form.splits.reduce((s, r) => s + (Number(r.extra_amount) || 0), 0)
      if (sumExtras > splittable + 0.01) errs.paid_by = 'Extras exceed the total cost'
    }
    // Charged rate (mirrors the Zod refine): a chosen charged currency needs a
    // rate > 0, and it must differ from the cost's own currency.
    if (form.cost_amount && form.charged_currency) {
      if (!(parseFloat(form.charged_rate) > 0)) errs.charged_rate = 'Enter the rate it was charged at'
      else if (form.charged_currency === form.cost_currency) errs.charged_rate = 'Charged currency must differ from the cost currency'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // Nothing stops a booking from sitting outside its trip's dates, and that's
  // sometimes legitimate (a pre-trip flight, a late checkout). But it's usually
  // a mis-filed trip — and the Trip view only renders days inside the range, so
  // the booking would appear to vanish. Warn, don't block.
  const outOfRange = (() => {
    const trip = (trips || []).find((t) => t.id === form.trip_id)
    if (!trip?.start_date || !trip?.end_date || !form.start_date) return null
    // Both "YYYY-MM-DD" and "YYYY-MM-DDTHH:mm" slice to a comparable date.
    const day = (s) => String(s).slice(0, 10)
    const from = day(form.start_date)
    const to = form.end_date ? day(form.end_date) : from
    if (from >= trip.start_date && to <= trip.end_date) return null
    return { trip, from, to }
  })()

  const [rangeWarning, setRangeWarning] = useState(false)

  const submitSave = () => {
    const isInformal = form.type === 'hotel' && form.details.informal
    // Store the wall-clock time exactly as typed — a naive `YYYY-MM-DDTHH:mm[:ss]`
    // string with NO timezone — so a booking renders on the same calendar day
    // everywhere, regardless of the viewer's timezone (this app is used across
    // timezones). `toISOString()` would bake in the entering device's offset and
    // shift the day when viewed elsewhere. Informal stays are date-only, pinned to
    // local midnight (a bare `YYYY-MM-DD` would parse as UTC and drift a day).
    const wall = (s) => {
      if (!s) return null
      const str = String(s)
      if (isInformal) return `${str.slice(0, 10)}T00:00:00`
      return str.length <= 10 ? `${str}T00:00:00` : str
    }
    // Two details keys aren't stored the way they're typed: ports_of_call is an
    // array (the cards join it) and tier values are strings from their inputs.
    // The `details` line below only nulls the whole object when it's empty, so
    // half-filled tiers would otherwise persist verbatim.
    const details = { ...form.details }
    const ports =
      typeof details.ports_of_call === 'string'
        ? details.ports_of_call.split(/[,·]/).map((p) => p.trim()).filter(Boolean)
        : details.ports_of_call
    if (Array.isArray(ports) && ports.length > 0) details.ports_of_call = ports
    else delete details.ports_of_call
    const policy = sanitizeCancellationPolicy(details.cancellation_policy)
    if (policy) details.cancellation_policy = policy
    else delete details.cancellation_policy
    onSave({
      ...form,
      start_date: wall(form.start_date),
      end_date: form.end_date ? wall(form.end_date) : null,
      cost_amount: form.cost_amount ? parseFloat(form.cost_amount) : null,
      cost_currency: form.cost_amount ? form.cost_currency : null,
      cost_share: form.cost_amount ? parseFloat(form.cost_share) || 1 : null,
      // Splits/payer only make sense with a cost. `splits: []` un-splits the
      // booking (replace-all delete); no cost clears both.
      paid_by: form.cost_amount ? form.paid_by || null : null,
      splits: form.cost_amount ? form.splits || [] : [],
      // Charged currency + rate only make sense with a cost, and are sent as a
      // pair (both null when absent — clears the columns).
      charged_currency:
        form.cost_amount && form.charged_currency && parseFloat(form.charged_rate) > 0
          ? form.charged_currency
          : null,
      charged_rate:
        form.cost_amount && form.charged_currency && parseFloat(form.charged_rate) > 0
          ? parseFloat(form.charged_rate)
          : null,
      details: Object.keys(details).length > 0 ? details : null,
    })
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validate()) return
    if (outOfRange) {
      setRangeWarning(true)
      return
    }
    submitSave()
  }

  const fields = TYPE_FIELDS[form.type] || []

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5 min-w-0">
      {/* Type selector */}
      <div>
        <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">Booking Type</label>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
          {BOOKING_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setField('type', t)}
              className={`px-2 py-2.5 text-xs rounded-xl border text-center transition-all duration-150 ${
                form.type === t
                  ? 'border-primary bg-primary-light text-primary font-medium shadow-sm'
                  : 'border-outline/40 text-on-surface-variant hover:border-outline hover:bg-surface-container'
              }`}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* Informal stay toggle (hotel only) */}
      {form.type === 'hotel' && (
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={!!form.details.informal}
            onChange={(e) => setDetail('informal', e.target.checked || undefined)}
            className="w-4 h-4 rounded border-outline/50 text-primary focus:ring-primary/30"
          />
          <span className="text-sm text-on-surface-variant">Informal stay (no check-in/out)</span>
        </label>
      )}

      {/* Common fields */}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Title</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setField('title', e.target.value)}
            placeholder="e.g. Tokyo → Osaka"
            className={`mat-input ${errors.title ? 'border-red-400 focus:ring-red-200' : ''}`}
          />
          {errors.title && <p className="text-xs text-red-500 mt-1">{errors.title}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Trip</label>
          <select
            value={form.trip_id}
            onChange={(e) => setField('trip_id', e.target.value)}
            className={`mat-input ${errors.trip_id ? 'border-red-400 focus:ring-red-200' : ''}`}
          >
            <option value="">Select a trip...</option>
            {(trips || []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          {errors.trip_id && <p className="text-xs text-red-500 mt-1">{errors.trip_id}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Provider</label>
          <input
            type="text"
            value={form.provider}
            onChange={(e) => setField('provider', e.target.value)}
            placeholder="e.g. United Airlines"
            className="mat-input"
          />
        </div>

        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Start</label>
          <input
            type={form.type === 'hotel' && form.details.informal ? 'date' : 'datetime-local'}
            value={form.type === 'hotel' && form.details.informal ? (form.start_date || '').slice(0, 10) : form.start_date}
            onChange={(e) => setField('start_date', e.target.value)}
            className={`mat-input text-xs w-full min-w-0 ${errors.start_date ? 'border-red-400 focus:ring-red-200' : ''}`}
          />
          {errors.start_date && <p className="text-xs text-red-500 mt-1">{errors.start_date}</p>}
        </div>

        <div className="col-span-2 sm:col-span-1">
          <label className="block text-xs font-medium text-on-surface-variant mb-1.5">End</label>
          <input
            type={form.type === 'hotel' && form.details.informal ? 'date' : 'datetime-local'}
            value={form.type === 'hotel' && form.details.informal ? (form.end_date || '').slice(0, 10) : form.end_date}
            onChange={(e) => setField('end_date', e.target.value)}
            className={`mat-input text-xs w-full min-w-0 ${errors.end_date ? 'border-red-400 focus:ring-red-200' : ''}`}
          />
          {errors.end_date && <p className="text-xs text-red-500 mt-1">{errors.end_date}</p>}
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Confirmation Number</label>
          <input
            type="text"
            value={form.confirmation_number}
            onChange={(e) => setField('confirmation_number', e.target.value)}
            placeholder="e.g. ABC123"
            className="mat-input"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Cost</label>
          <input
            type="text"
            inputMode="decimal"
            value={form.cost_amount}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9.]/g, '')
              setField('cost_amount', raw)
            }}
            placeholder="0.00"
            className="mat-input"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Currency</label>
          <select
            value={form.cost_currency}
            onChange={(e) => setField('cost_currency', e.target.value)}
            className="mat-select w-full"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </select>
        </div>

        {form.cost_amount && (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Trip&apos;s portion</label>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                inputMode="decimal"
                value={form.cost_share}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9.]/g, '')
                  setField('cost_share', raw)
                }}
                className="mat-input w-24"
              />
              <span className="text-sm text-on-surface-variant truncate">
                × {formatCurrency(parseFloat(form.cost_amount) || 0, form.cost_currency)} = {formatCurrency((parseFloat(form.cost_amount) || 0) * (parseFloat(form.cost_share) || 1), form.cost_currency)}
              </span>
            </div>
            <p className="text-xs text-on-surface-variant/60 mt-1">Portion of this cost that belongs to this trip</p>
          </div>
        )}

        {form.cost_amount && (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Split</label>
            <SplitEditor
              members={splitMembers}
              parties={splitParties}
              amount={(parseFloat(form.cost_amount) || 0) * (parseFloat(form.cost_share) || 1)}
              currency={form.cost_currency}
              paidBy={form.paid_by || null}
              splits={form.splits}
              onChange={({ paid_by, splits }) => {
                setForm((prev) => ({ ...prev, paid_by: paid_by || '', splits }))
                if (paid_by) setErrors((prev) => ({ ...prev, paid_by: undefined }))
              }}
            />
            {errors.paid_by && <p className="text-xs text-red-500 mt-1">{errors.paid_by}</p>}
            <ChargedRateEditor
              nativeCurrency={form.cost_currency}
              effective={(parseFloat(form.cost_amount) || 0) * (parseFloat(form.cost_share) || 1)}
              chargedCurrency={form.charged_currency}
              chargedRate={form.charged_rate}
              onChange={({ charged_currency, charged_rate }) => {
                setForm((prev) => ({
                  ...prev,
                  charged_currency: charged_currency ?? '',
                  charged_rate: charged_rate ?? '',
                }))
                setErrors((prev) => ({ ...prev, charged_rate: undefined }))
              }}
            />
            {errors.charged_rate && <p className="text-xs text-red-500 mt-1">{errors.charged_rate}</p>}
          </div>
        )}
      </div>

      {/* Type-specific details */}
      {fields.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-3">
            {TYPE_LABELS[form.type]} Details
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {fields.map(({ key, label, placeholder, multiline, options }) => (
              <div key={key} className={multiline ? 'col-span-2' : ''}>
                <label className="block text-xs text-on-surface-variant mb-1">{label}</label>
                {options ? (
                  <select
                    value={form.details[key] || ''}
                    onChange={(e) => setDetail(key, e.target.value)}
                    className="mat-select w-full"
                  >
                    <option value="">Select...</option>
                    {options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : multiline ? (
                  <textarea
                    value={form.details[key] || ''}
                    onChange={(e) => setDetail(key, e.target.value)}
                    placeholder={placeholder}
                    rows={2}
                    className="mat-input resize-none"
                  />
                ) : (
                  <input
                    type="text"
                    value={form.details[key] || ''}
                    onChange={(e) => setDetail(key, e.target.value)}
                    placeholder={placeholder}
                    className="mat-input"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cancellation policy (all types) */}
      <div>
        <h3 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1">
          Cancellation Policy
        </h3>
        <p className="text-xs text-on-surface-variant/60 mb-3">
          {nonRefundable
            ? 'Nothing comes back from this booking, whenever it is cancelled.'
            : 'Refund if cancelled on or before each date. After the last date the booking is non-refundable.'}
        </p>
        <label className="flex items-center gap-2.5 cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={nonRefundable}
            onChange={(e) => setDetail('cancellation_policy', e.target.checked ? 'non_refundable' : undefined)}
            className="w-4 h-4 rounded border-outline/50 text-primary focus:ring-primary/30"
          />
          <span className="text-sm text-on-surface-variant">Non-refundable — cannot be cancelled</span>
        </label>
        {!nonRefundable && tiers.length > 0 && (
          <div className="space-y-3 mb-3">
            {tiers.map((tier, i) => {
              // Both inputs are backed by the single `cutoff` string, which is
              // either 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'.
              const cutoffDate = (tier.cutoff || '').slice(0, 10)
              const cutoffTime = (tier.cutoff || '').length > 10 ? tier.cutoff.slice(11, 16) : ''
              const kind = tier.kind || 'percent'
              const cur = form.cost_currency || 'USD'
              // Live plain-English readout of what this tier means — the
              // controls alone ("100", "%") read as gibberish without it.
              // Mirrors src/lib/cancellation.js semantics: percent/fee apply to
              // the effective cost (amount × share), amounts clamp to it.
              const effective = form.cost_amount
                ? (parseFloat(form.cost_amount) || 0) * (parseFloat(form.cost_share) || 1)
                : null
              const v = parseFloat(tier.value)
              let preview = null
              if (cutoffDate && Number.isFinite(v)) {
                const cash =
                  kind === 'percent'
                    ? effective != null
                      ? `${formatCurrency(Math.min((effective * Math.min(v, 100)) / 100, effective), cur)} (${Math.min(v, 100)}%)`
                      : `${Math.min(v, 100)}% of the cost`
                    : kind === 'fee'
                      ? effective != null
                        ? `${formatCurrency(Math.max(effective - v, 0), cur)} (cost minus ${formatCurrency(v, cur)} fee)`
                        : `the cost minus a ${formatCurrency(v, cur)} fee`
                      : formatCurrency(effective != null ? Math.min(v, effective) : v, cur)
                const c = tier.credit
                const cv = c ? parseFloat(c.value) : NaN
                let creditClause = ''
                if (c && Number.isFinite(cv)) {
                  const creditAmt =
                    (c.kind || 'percent') === 'percent'
                      ? effective != null
                        ? formatCurrency(Math.min((effective * Math.min(cv, 100)) / 100, effective), cur)
                        : `${Math.min(cv, 100)}%`
                      : formatCurrency(cv, cur)
                  creditClause = `${(c.mode || 'or') === 'and' ? ' plus ' : ' — or instead, '}${creditAmt} in credit`
                  if (c.expiry) {
                    creditClause += ` (use by ${new Date(c.expiry + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })})`
                  }
                }
                const when = `${new Date(cutoffDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${cutoffTime ? ` ${cutoffTime}` : ''}`
                preview = `Cancel by ${when} → ${cash} back${creditClause}`
              }
              return (
              // Each tier is a labeled card: a label column keeps the rows
              // scannable, every toggle gets a full-width row (side-by-side
              // they truncated to "% ..", "U…" at modal width), and a live
              // sentence says what the controls add up to.
              <div key={i} className="rounded-xl border border-outline/20 p-3 grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-2 items-center">
                <span className="text-xs text-on-surface-variant">Cancel by</span>
                <div className="flex items-center gap-2 min-w-0">
                  <input
                    type="date"
                    value={cutoffDate}
                    onChange={(e) => setTier(i, { cutoff: cutoffTime ? `${e.target.value}T${cutoffTime}` : e.target.value })}
                    className="mat-input flex-1 min-w-0 text-xs"
                  />
                  {/* Optional deadline time — blank means the whole day counts. */}
                  <input
                    type="time"
                    value={cutoffTime}
                    onChange={(e) => setTier(i, { cutoff: e.target.value ? `${cutoffDate}T${e.target.value}` : cutoffDate })}
                    className="mat-input w-20 min-w-0 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setTiers(tiers.filter((_, j) => j !== i))}
                    className="shrink-0 w-7 h-7 rounded-full text-on-surface-variant hover:text-red-500 hover:bg-surface-container transition-colors duration-150"
                    aria-label="Remove tier"
                  >
                    ×
                  </button>
                </div>

                <span className="text-xs text-on-surface-variant">to get back</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={tier.value ?? ''}
                  onChange={(e) => setTier(i, { value: e.target.value.replace(/[^0-9.]/g, '') })}
                  placeholder={kind === 'percent' ? '100' : kind === 'fee' ? '25' : '500'}
                  className="mat-input w-24"
                />

                <span aria-hidden />
                <div className="flex rounded-xl border border-outline/40 overflow-hidden">
                  {[
                    ['percent', '%'],
                    ['amount', cur],
                    ['fee', '− fee'],
                  ].map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setTier(i, { kind: k })}
                      className={`flex-1 min-w-0 px-2 py-2 text-xs transition-all duration-150 ${
                        kind === k
                          ? 'bg-primary-light text-primary font-medium'
                          : 'text-on-surface-variant hover:bg-surface-container'
                      }`}
                    >
                      <span className="block truncate">{label}</span>
                    </button>
                  ))}
                </div>

                {/* Cash and credit are separate payouts, so the credit rider is
                    opt-in per tier rather than a fourth `kind`. */}
                {tier.credit ? (
                  <>
                    <span className="text-xs text-on-surface-variant">credit</span>
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={tier.credit.value ?? ''}
                        onChange={(e) =>
                          setTier(i, { credit: { ...tier.credit, value: e.target.value.replace(/[^0-9.]/g, '') } })
                        }
                        placeholder={(tier.credit.kind || 'percent') === 'percent' ? '100' : '500'}
                        className="mat-input w-24 shrink-0"
                      />
                      <div className="flex flex-1 min-w-0 rounded-xl border border-outline/40 overflow-hidden">
                        {['percent', 'amount'].map((k) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setTier(i, { credit: { ...tier.credit, kind: k } })}
                            className={`flex-1 min-w-0 px-2 py-2 text-xs transition-all duration-150 ${
                              (tier.credit.kind || 'percent') === k
                                ? 'bg-primary-light text-primary font-medium'
                                : 'text-on-surface-variant hover:bg-surface-container'
                            }`}
                          >
                            <span className="block">{k === 'percent' ? '%' : cur}</span>
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const { credit, ...rest } = tier
                          setTiers(tiers.map((t, j) => (j === i ? rest : t)))
                        }}
                        className="shrink-0 w-7 h-7 rounded-full text-on-surface-variant hover:text-red-500 hover:bg-surface-container transition-colors duration-150"
                        aria-label="Remove credit"
                      >
                        ×
                      </button>
                    </div>

                    <span aria-hidden />
                    {/* Instead of the cash refund, or on top of it? 'instead'
                        is the usual deal and the /costs net-loss hinges on it. */}
                    <div className="flex rounded-xl border border-outline/40 overflow-hidden">
                      {[['or', 'instead'], ['and', 'on top']].map(([m, label]) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setTier(i, { credit: { ...tier.credit, mode: m } })}
                          className={`flex-1 min-w-0 px-2 py-2 text-xs transition-all duration-150 ${
                            (tier.credit.mode || 'or') === m
                              ? 'bg-primary-light text-primary font-medium'
                              : 'text-on-surface-variant hover:bg-surface-container'
                          }`}
                        >
                          <span className="block truncate">{label}</span>
                        </button>
                      ))}
                    </div>

                    {/* Optional: the day the voucher must be used by. Blank
                        means no stated expiry — never guessed. */}
                    <span className="text-xs text-on-surface-variant">use it by</span>
                    <input
                      type="date"
                      value={tier.credit.expiry || ''}
                      onChange={(e) => setTier(i, { credit: { ...tier.credit, expiry: e.target.value } })}
                      className="mat-input min-w-0 text-xs"
                    />
                  </>
                ) : (
                  <>
                    <span aria-hidden />
                    <button
                      type="button"
                      onClick={() => setTier(i, { credit: { kind: 'percent', value: '', mode: 'or' } })}
                      className="justify-self-start text-xs text-primary font-medium hover:underline"
                    >
                      + they give credit too
                    </button>
                  </>
                )}

                {preview ? (
                  <p className="col-span-2 text-[11px] text-emerald-700 bg-emerald-50 rounded-lg px-2.5 py-1.5">{preview}</p>
                ) : (
                  <p className="col-span-2 text-[11px] text-on-surface-variant/60">
                    Set the date and value to see what this tier means.
                  </p>
                )}
              </div>
              )
            })}
          </div>
        )}
        {!nonRefundable && (
          <button
            type="button"
            onClick={() => setTiers([...tiers, { cutoff: '', kind: 'percent', value: '' }])}
            className="text-xs text-primary font-medium hover:underline"
          >
            + Add tier
          </button>
        )}
      </div>

      {/* Hidden submit button so form submit works from footer */}
      <button type="submit" className="hidden" />

      {rangeWarning && outOfRange && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="range-warning-title"
        >
          <div className="bg-white rounded-2xl shadow-elevation-3 w-full max-w-sm p-5">
            <div className="flex items-start gap-3 mb-3">
              <span className="shrink-0 w-9 h-9 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
                </svg>
              </span>
              <div className="min-w-0">
                <h4 id="range-warning-title" className="text-sm font-medium text-on-surface">
                  Outside the trip&apos;s dates
                </h4>
                <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                  This booking is{' '}
                  <strong className="text-on-surface">
                    {outOfRange.from}
                    {outOfRange.to !== outOfRange.from && ` → ${outOfRange.to}`}
                  </strong>
                  , but <strong className="text-on-surface">{outOfRange.trip.name}</strong> runs{' '}
                  {outOfRange.trip.start_date} → {outOfRange.trip.end_date}.
                </p>
                <p className="text-xs text-on-surface-variant mt-2 leading-relaxed">
                  It will save fine, but won&apos;t appear in the Trip view — only in
                  Month view for its own dates.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRangeWarning(false)}
                className="mat-btn-outlined"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={() => { setRangeWarning(false); submitSave() }}
                className="mat-btn-filled"
              >
                Save anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  )
}
