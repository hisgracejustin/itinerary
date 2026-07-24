"use client";

import { usePathname } from "next/navigation";
import { useTripContext } from "../lib/trip-context";

// Centered section title on phones — the screens hide their own title rows
// below lg, saving a full row of vertical space.
const SECTION_TITLES = {
  "/": "Calendar",
  "/todos": "To-dos",
  "/costs": "Costs",
  "/settle": "Settle up",
  "/settings": "Settings",
  "/bookings/flight": "Flights",
  "/bookings/train": "Trains",
  "/bookings/bus": "Buses",
  "/bookings/rental": "Rentals",
  "/bookings/cruise": "Cruises",
  "/bookings/hotel": "Accommodation",
  "/bookings/activity": "Activities",
};

export default function Header({ onToggleSidebar, onAddBooking }) {
  const { tripMetas } = useTripContext();
  const pathname = usePathname();
  const sectionTitle = SECTION_TITLES[pathname];
  // 0 selected = the All Trips view; 1 = its name; 2+ = the joined names.
  const tripLabel =
    tripMetas.length === 0 ? "All trips" : tripMetas.map((t) => t.name).join(" + ");
  return (
    <header className="relative px-4 sm:px-6 h-14 flex items-center justify-between shrink-0">
      {sectionTitle && (
        <h1
          className="absolute inset-x-0 text-center text-base font-semibold text-on-surface
                     pointer-events-none truncate px-24 m-0"
        >
          {sectionTitle}
        </h1>
      )}
      <button
        onClick={onToggleSidebar}
        className="mat-icon-btn"
        aria-label="Toggle sidebar"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs font-medium bg-primary-light text-accent-ink px-3 py-1 rounded-full truncate max-w-[55vw]">
          {tripLabel}
        </span>
        <button
          onClick={onAddBooking}
          aria-label="Add booking"
          className="w-10 h-10 rounded-full bg-primary text-white shadow-md shadow-primary/25
                     hover:bg-primary-dark hover:shadow-lg hover:shadow-primary/30
                     active:scale-[0.97] transition-all duration-200
                     flex items-center justify-center shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>
    </header>
  )
}
