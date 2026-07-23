"use client";

// Small pill button for the filter rows (assignee/trip on the To-dos board,
// trip on the per-type booking lists). `warn` renders the amber "needs
// attention" variant used by the Unassigned chip.
export default function FilterChip({ active, onClick, label, count, avatar, warn = false }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap transition-colors shrink-0 ${
        active
          ? 'bg-primary text-white border-primary'
          : warn && count > 0
          ? 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
          : 'bg-white text-on-surface-variant border-outline/30 hover:bg-surface-container'
      }`}
    >
      {avatar}
      {label}
      {count > 0 && (
        <span className={active ? 'opacity-80' : 'opacity-60'}>{count}</span>
      )}
    </button>
  )
}
