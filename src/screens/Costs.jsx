"use client";

import { useTripContext } from '../lib/trip-context'
import { toHKD, formatCurrency } from '../lib/currencies'
import { TYPE_ICONS } from '../lib/calendar'

export default function Costs({ bookings }) {
  const { tripMeta } = useTripContext()

  // Only bookings with costs
  const withCosts = bookings.filter((b) => b.cost_amount && b.cost_currency)

  // Effective cost = amount * share
  const effectiveCost = (b) => b.cost_amount * (b.cost_share != null ? b.cost_share : 1)

  // Total in HKD
  const totalHKD = withCosts.reduce((sum, b) => sum + toHKD(effectiveCost(b), b.cost_currency), 0)

  // Breakdown by currency
  const byCurrency = {}
  withCosts.forEach((b) => {
    if (!byCurrency[b.cost_currency]) byCurrency[b.cost_currency] = 0
    byCurrency[b.cost_currency] += effectiveCost(b)
  })
  const currencyBreakdown = Object.entries(byCurrency).sort((a, b) => {
    // Sort by HKD equivalent descending
    return toHKD(b[1], b[0]) - toHKD(a[1], a[0])
  })

  // Individual bookings sorted by cost descending (in HKD)
  const sorted = [...withCosts].sort((a, b) => toHKD(effectiveCost(b), b.cost_currency) - toHKD(effectiveCost(a), a.cost_currency))

  return (
    <div className="h-full flex flex-col w-full max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-medium text-on-surface">Costs</h2>
        {tripMeta && (
          <span className="text-xs font-medium bg-primary-light text-primary px-3 py-1 rounded-full">
            {tripMeta.name}
          </span>
        )}
      </div>

      {withCosts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
          <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4">
            <span className="text-2xl">💰</span>
          </div>
          <p className="text-sm font-medium">No costs recorded yet</p>
          <p className="text-xs mt-1 text-on-surface-variant/70">Add costs to your bookings to see the breakdown here</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto grid gap-4 lg:grid-cols-2 auto-rows-min content-start">
          {/* Total */}
          <div className="mat-surface p-6 lg:col-span-2">
            <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-1">Total (approx. HKD)</div>
            <div className="text-3xl font-medium text-on-surface">
              ~HK${totalHKD.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            {/* Currency breakdown */}
            <div className="mt-4 flex flex-wrap gap-2">
              {currencyBreakdown.map(([currency, amount]) => (
                <div key={currency} className="text-sm text-on-surface-variant bg-surface-container px-3 py-1.5 rounded-full font-medium">
                  {formatCurrency(amount, currency)}
                </div>
              ))}
            </div>
          </div>

          {/* By type summary */}
          <div className="mat-surface p-6">
            <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-4">By Type</div>
            <div className="space-y-3">
              {Object.entries(
                withCosts.reduce((acc, b) => {
                  if (!acc[b.type]) acc[b.type] = 0
                  acc[b.type] += toHKD(effectiveCost(b), b.cost_currency)
                  return acc
                }, {})
              )
                .sort((a, b) => b[1] - a[1])
                .map(([type, hkdAmount]) => {
                  const pct = totalHKD > 0 ? (hkdAmount / totalHKD) * 100 : 0
                  return (
                    <div key={type} className="flex items-center gap-3">
                      <span className="text-base w-7">{TYPE_ICONS[type] || '📌'}</span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="capitalize text-on-surface font-medium">{type}s</span>
                          <span className="text-on-surface-variant">
                            ~HK${hkdAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 bg-surface-container rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all duration-500 ease-material"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>

          {/* Individual bookings */}
          <div className="mat-surface p-6">
            <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-4">All Bookings (by cost)</div>
            <div className="space-y-1">
              {sorted.map((booking) => (
                <div key={booking.id} className="flex items-center justify-between py-3 border-b border-outline/20 last:border-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-base">{TYPE_ICONS[booking.type] || '📌'}</span>
                    <div className="min-w-0">
                      <div className="text-sm text-on-surface font-medium truncate">{booking.title}</div>
                      <div className="text-xs text-on-surface-variant">{booking.provider}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className="text-sm font-medium text-on-surface">
                      {formatCurrency(effectiveCost(booking), booking.cost_currency)}
                      {booking.cost_share != null && booking.cost_share !== 1 && (
                        <span className="text-[10px] text-on-surface-variant ml-1">(×{parseFloat(booking.cost_share.toFixed(2))})</span>
                      )}
                    </div>
                    {booking.cost_currency !== 'HKD' && (
                      <div className="text-[11px] text-on-surface-variant">
                        ~HK${toHKD(effectiveCost(booking), booking.cost_currency).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
