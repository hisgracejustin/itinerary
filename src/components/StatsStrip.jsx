/**
 * Compact per-type summary above a booking list. Deliberately dumb: every stat
 * arrives pre-formatted from getBookingStats(), so there is no per-type logic
 * here. Scrolls horizontally on narrow screens rather than wrapping, so it
 * stays one row tall everywhere.
 */
export default function StatsStrip({ stats }) {
  if (!stats?.length) return null

  return (
    <div className="mat-surface mb-4 shrink-0 py-3 flex overflow-x-auto divide-x divide-outline/20">
      {stats.map((s) => (
        <div key={s.key} className="px-4 min-w-[92px] shrink-0" title={s.hint}>
          <div className="text-lg font-medium text-on-surface whitespace-nowrap">
            {/* '~' marks a figure we know is approximate (unknown airport
                timezone, or a cross-currency conversion at static rates). */}
            {s.approx && <span className="text-on-surface-variant">~</span>}
            {s.value}
          </div>
          <div className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider whitespace-nowrap">
            {s.label}
          </div>
        </div>
      ))}
    </div>
  )
}
