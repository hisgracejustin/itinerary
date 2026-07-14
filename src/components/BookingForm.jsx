import { useState, useEffect } from 'react'
import { CURRENCIES, formatCurrency } from '../lib/currencies'
import { useTripContext } from '../lib/trip-context'

const BOOKING_TYPES = ['flight', 'train', 'bus', 'cruise', 'hotel', 'activity']

const TYPE_LABELS = {
  flight: '✈️ Flight',
  train: '🚂 Train',
  bus: '🚌 Bus',
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
  ],
  train: [
    { key: 'departure_station', label: 'Departure Station', placeholder: 'Tokyo Station' },
    { key: 'arrival_station', label: 'Arrival Station', placeholder: 'Osaka Station' },
    { key: 'train_number', label: 'Train Number', placeholder: 'Nozomi 1' },
    { key: 'car', label: 'Car', placeholder: '5' },
    { key: 'seat', label: 'Seat', placeholder: '3A' },
  ],
  bus: [
    { key: 'departure_station', label: 'Departure Stop', placeholder: 'Central Bus Station' },
    { key: 'arrival_station', label: 'Arrival Stop', placeholder: 'Airport Terminal 1' },
    { key: 'bus_number', label: 'Bus/Route Number', placeholder: 'A1' },
    { key: 'seat', label: 'Seat', placeholder: '12' },
  ],
  cruise: [
    { key: 'ship_name', label: 'Ship Name', placeholder: 'Diamond Princess' },
    { key: 'cabin', label: 'Cabin', placeholder: 'A205' },
    { key: 'deck', label: 'Deck', placeholder: '8' },
    { key: 'departure_port', label: 'Departure Port', placeholder: 'Yokohama' },
    { key: 'arrival_port', label: 'Arrival Port', placeholder: 'Kobe' },
  ],
  hotel: [
    { key: 'address', label: 'Address', placeholder: '1-2-3 Shibuya, Tokyo' },
    { key: 'check_in_time', label: 'Check-in Time', placeholder: '15:00' },
    { key: 'check_out_time', label: 'Check-out Time', placeholder: '11:00' },
    { key: 'room_type', label: 'Room Type', placeholder: 'Deluxe King' },
    { key: 'maps_url', label: 'Google Maps URL', placeholder: 'https://maps.google.com/...' },
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
        details: booking.details || {},
      })
    }
  }, [booking])

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const setDetail = (key, value) => {
    setForm((prev) => ({ ...prev, details: { ...prev.details, [key]: value } }))
  }

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
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validate()) return
    const isInformal = form.type === 'hotel' && form.details.informal
    onSave({
      ...form,
      start_date: isInformal ? new Date(form.start_date + 'T00:00:00').toISOString() : new Date(form.start_date).toISOString(),
      end_date: form.end_date ? (isInformal ? new Date(form.end_date + 'T00:00:00').toISOString() : new Date(form.end_date).toISOString()) : null,
      cost_amount: form.cost_amount ? parseFloat(form.cost_amount) : null,
      cost_currency: form.cost_amount ? form.cost_currency : null,
      cost_share: form.cost_amount ? parseFloat(form.cost_share) || 1 : null,
      details: Object.keys(form.details).length > 0 ? form.details : null,
    })
  }

  const fields = TYPE_FIELDS[form.type] || []

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-5 min-w-0">
      {/* Type selector */}
      <div>
        <label className="block text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-2">Booking Type</label>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
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
            <label className="block text-xs font-medium text-on-surface-variant mb-1.5">Your Share</label>
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
            <p className="text-xs text-on-surface-variant/60 mt-1">Multiplier: 1 = full cost, 0.25 = quarter, 4 = paying for 4 people</p>
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
            {fields.map(({ key, label, placeholder, multiline }) => (
              <div key={key} className={multiline ? 'col-span-2' : ''}>
                <label className="block text-xs text-on-surface-variant mb-1">{label}</label>
                {multiline ? (
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

      {/* Hidden submit button so form submit works from footer */}
      <button type="submit" className="hidden" />
    </form>
  )
}
