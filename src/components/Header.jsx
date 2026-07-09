"use client";

export default function Header({ onToggleSidebar, onAddBooking }) {
  return (
    <header className="bg-white border-b border-outline/60 px-4 sm:px-6 h-16 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleSidebar}
          className="mat-icon-btn"
          aria-label="Toggle sidebar"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <h1 className="text-lg font-medium text-on-surface tracking-tight">Itinerary</h1>
      </div>
      <button
        onClick={onAddBooking}
        className="mat-btn-filled"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
        </svg>
        <span className="hidden sm:inline">Add Booking</span>
      </button>
    </header>
  )
}
