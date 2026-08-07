"use client";

const ACTIONS = [
  { kind: "booking", icon: "✈️", title: "Booking", detail: "Flight, stay, activity, or transport" },
  { kind: "todo", icon: "☑️", title: "To-do", detail: "Add something that needs doing" },
  { kind: "expense", icon: "🧾", title: "Expense", detail: "Record and split a shared cost" },
  { kind: "payment", icon: "💸", title: "Payment", detail: "Record money paid between people" },
];

export default function GlobalAddMenu({ onSelect, onClose }) {
  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-label="Close add menu"
      />
      <div className="absolute inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-auto sm:right-5 sm:top-14 w-auto sm:w-80 rounded-2xl bg-white border border-outline/20 shadow-elevation-4 p-2 animate-scale-in">
        <div className="flex items-center justify-between px-3 py-2">
          <h2 className="text-sm font-semibold text-on-surface">Add something</h2>
          <button type="button" onClick={onClose} className="mat-icon-btn" aria-label="Close">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-1 gap-1">
          {ACTIONS.map((action) => (
            <button
              key={action.kind}
              type="button"
              onClick={() => onSelect(action.kind)}
              className="flex items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-surface-container transition-colors"
            >
              <span className="text-xl shrink-0" aria-hidden>{action.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-on-surface">{action.title}</span>
                <span className="block text-[11px] leading-snug text-on-surface-variant mt-0.5">{action.detail}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
