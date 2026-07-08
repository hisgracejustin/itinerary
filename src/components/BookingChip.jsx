import { TYPE_COLORS, TYPE_ICONS, formatTime } from '../lib/calendar'

export default function BookingChip({ booking, compact = false, onClick }) {
  const colors = TYPE_COLORS[booking.type] || TYPE_COLORS.activity
  const icon = TYPE_ICONS[booking.type] || '📌'

  if (compact) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onClick?.(booking) }}
        className={`w-full text-left px-1.5 py-0.5 rounded text-[11px] truncate border-l-2 ${colors.border} ${colors.bg} ${colors.text} hover:shadow-elevation-1 transition-all duration-150`}
        title={booking.title}
      >
        <span className="mr-0.5 text-[10px]">{icon}</span>
        {booking.title}
      </button>
    )
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.(booking) }}
      className={`w-full text-left p-3.5 rounded-xl border-l-4 ${colors.border} bg-white shadow-elevation-1 hover:shadow-elevation-2 transition-all duration-200 mat-press`}
    >
      <div className="flex items-center gap-2.5 mb-1.5">
        <span className="text-base">{icon}</span>
        <span className="font-medium text-sm text-on-surface">{booking.title}</span>
      </div>
      <div className="text-xs text-on-surface-variant flex items-center gap-2">
        {booking.start_date && <span>{formatTime(booking.start_date)}</span>}
        {booking.end_date && (
          <>
            <span className="text-outline">→</span>
            <span>{formatTime(booking.end_date)}</span>
          </>
        )}
      </div>
      {booking.provider && (
        <div className="text-[11px] text-on-surface-variant/70 mt-1">{booking.provider}</div>
      )}
    </button>
  )
}
