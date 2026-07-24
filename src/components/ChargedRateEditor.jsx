import { useState } from 'react'
import { CURRENCIES, formatCurrency } from '../lib/currencies'

/**
 * Optional "charged in another currency" disclosure for a booking cost or an
 * expense. Collapsed by default; auto-opens when the item already has a charged
 * rate. Inside: a currency picker (excluding the item's native currency), a
 * decimal rate input, and a live preview of the re-denominated amount.
 *
 * Clearing the currency or collapsing clears BOTH fields — the payload then
 * sends null/null. `onChange` emits `{ charged_currency, charged_rate }` where
 * charged_rate is the raw string (parsed by the caller at submit).
 *
 * Props:
 *  - nativeCurrency   the item's own currency (excluded from the picker)
 *  - effective        the native amount the preview re-denominates
 *  - chargedCurrency  current value (code | '' | null)
 *  - chargedRate      current raw rate string
 */
export default function ChargedRateEditor({
  nativeCurrency,
  effective,
  chargedCurrency,
  chargedRate,
  onChange,
}) {
  const [open, setOpen] = useState(!!chargedCurrency)
  const options = CURRENCIES.filter((c) => c.code !== nativeCurrency)
  const rateNum = parseFloat(chargedRate)
  const hasPreview = !!chargedCurrency && rateNum > 0

  const toggle = () => {
    if (open) {
      // Collapsing clears both fields.
      onChange({ charged_currency: null, charged_rate: null })
      setOpen(false)
    } else {
      setOpen(true)
    }
  }

  const pickCurrency = (code) => {
    // Clearing the currency clears the rate too.
    onChange({ charged_currency: code || null, charged_rate: code ? (chargedRate ?? '') : null })
  }
  const setRate = (raw) => {
    onChange({ charged_currency: chargedCurrency || null, charged_rate: raw.replace(/[^0-9.]/g, '') })
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={toggle} className="text-[11px] text-primary">
        {open ? 'Remove charged rate' : 'Charged in another currency?'}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-xl border border-outline/30 bg-surface-container/40 p-3">
          <div className="flex gap-2">
            <select
              value={chargedCurrency || ''}
              onChange={(e) => pickCurrency(e.target.value)}
              aria-label="Charged currency"
              className="mat-select flex-1 min-w-0"
            >
              <option value="">Currency…</option>
              {options.map((c) => (
                <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
              ))}
            </select>
            <input
              type="text"
              inputMode="decimal"
              value={chargedRate ?? ''}
              onChange={(e) => setRate(e.target.value)}
              placeholder="rate"
              className="mat-input w-24 shrink-0"
            />
          </div>
          {hasPreview && (
            <p className="text-[11px] text-on-surface-variant truncate">
              1 {nativeCurrency} = {rateNum} {chargedCurrency}; {formatCurrency(effective, nativeCurrency)} → {formatCurrency(effective * rateNum, chargedCurrency)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
