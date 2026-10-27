import { CURRENCIES } from '../lib/currencies'
import { dailyRate, minorScale, rateInput, startPaid } from '../lib/settle-fx'

const clean = (raw) => String(raw).replace(/[^0-9.]/g, '')
// Noon local time, so the ECB date doesn't slide a day in a timezone behind UTC.
const shortDate = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/**
 * Optional "paid in another currency" section for a payment, styled like
 * ChargedRateEditor: collapsed by default; opening it starts in the home
 * currency at the latest daily rate (startPaid).
 *
 * The rate and the amount received are linked: whichever was typed last stays
 * as typed and the other follows it (`resolved`, from resolvePaid, carries the
 * figures). The payment still settles in `settleCurrency` — this only records
 * what was actually sent.
 *
 * Props:
 *  - settleCurrency  the currency the debt is in (excluded from the picker)
 *  - value           state from startPaid, or null when collapsed
 *  - resolved        resolvePaid(value, legs) for the amount being settled
 *  - receivedLabel   e.g. "Sophie gets"
 *  - fx              TripContext.fx, for the daily rate
 *  - onChange        (state | null) => void
 */
export default function PaidCurrencyEditor({ settleCurrency, value, resolved, receivedLabel, fx, onChange }) {
  const toggle = () => onChange(value ? null : startPaid(settleCurrency, fx))
  const pickCurrency = (code) =>
    onChange(code ? startPaid(settleCurrency, fx, code) : { ...value, currency: '', rate: '', source: 'rate' })

  const ok = resolved && !('error' in resolved) ? resolved : null
  const decimals = value?.currency && minorScale(value.currency) === 1 ? 0 : 2
  const rateShown = value?.source === 'rate' ? value.rate : ok?.rate != null ? String(ok.rate) : ''
  const receivedShown = value?.source === 'received' ? value.received : ok ? ok.total.toFixed(decimals) : ''

  const daily = value?.currency ? dailyRate(settleCurrency, value.currency, fx) : null
  const off = daily && ok?.rate ? ok.rate / daily.rate - 1 : 0

  return (
    <div>
      <button type="button" onClick={toggle} className="text-[11px] text-primary">
        {value ? 'Remove other currency' : 'Paid in another currency?'}
      </button>
      {value && (
        <div
          className="mt-2 space-y-2 rounded-xl border border-outline/30 bg-surface-container/40 p-3"
          data-testid="paid-currency"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-on-surface-variant">Paid in</span>
            <select
              value={value.currency}
              onChange={(e) => pickCurrency(e.target.value)}
              aria-label="Paid in"
              className="mat-select w-32 shrink-0"
            >
              <option value="">Currency…</option>
              {CURRENCIES.filter((c) => c.code !== settleCurrency).map((c) => (
                <option key={c.code} value={c.code}>{c.code}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-on-surface-variant whitespace-nowrap">1 {settleCurrency} =</span>
            <span className="flex items-center gap-2 shrink-0">
              <input
                type="text"
                inputMode="decimal"
                value={rateShown}
                onChange={(e) => onChange({ ...value, rate: clean(e.target.value), source: 'rate' })}
                aria-label="Rate"
                placeholder="rate"
                className="mat-input w-28 text-right"
              />
              <span className="text-xs text-on-surface-variant w-9">{value.currency}</span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-on-surface-variant truncate min-w-0">{receivedLabel}</span>
            <span className="flex items-center gap-2 shrink-0">
              <input
                type="text"
                inputMode="decimal"
                value={receivedShown}
                onChange={(e) => onChange({ ...value, received: clean(e.target.value), source: 'received' })}
                aria-label="Amount received"
                placeholder="amount"
                className="mat-input w-28 text-right"
              />
              <span className="text-xs text-on-surface-variant w-9">{value.currency}</span>
            </span>
          </div>
          {daily && (
            <p className="text-[11px] text-on-surface-variant">
              {daily.live
                ? `Daily rate${daily.rateDate ? ` on ${shortDate(daily.rateDate)}` : ''}: ${rateInput(daily.rate)}.`
                : `Approximate built-in rate: ${rateInput(daily.rate)}.`}{' '}
              Change it to the rate you agreed.
            </p>
          )}
          {Math.abs(off) > 0.1 && (
            <p className="text-[11px] text-amber-700">
              {`That's ${Math.round(Math.abs(off) * 100)}% ${off > 0 ? 'above' : 'below'} the daily rate. Check the numbers before recording.`}
            </p>
          )}
          {resolved && 'error' in resolved && (
            <p className="text-[11px] text-red-600">{resolved.error}</p>
          )}
        </div>
      )}
    </div>
  )
}
