"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTripContext } from "../lib/trip-context";

// Centered section title on phones — the screens hide their own title rows
// below lg, saving a full row of vertical space.
const SECTION_TITLES = {
  "/": "Calendar",
  "/todos": "To-dos",
  "/considering": "Considering",
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

// 2+ trips selected: a compact "N trips" chip that opens a list of the
// selected names, instead of a long joined pill that collides with the
// centered section title and risks horizontal overflow on phones.
function TripChip({ tripMetas }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={tripMetas.map((t) => t.name).join(" + ")}
        className="inline-flex items-center gap-1 text-xs font-medium bg-primary-light text-accent-ink
                   pl-3 pr-2 py-1 rounded-full max-w-[45vw]"
      >
        <span className="truncate">{tripMetas.length} trips</span>
        <svg
          className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-1 min-w-[10rem] max-w-[70vw] max-h-64 overflow-y-auto
                     rounded-xl bg-white border border-outline/30 shadow-elevation-2 py-1"
        >
          <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-on-surface-variant">
            Selected trips
          </p>
          {tripMetas.map((t) => (
            <span
              key={t.id}
              role="option"
              aria-selected="true"
              className="block truncate px-3 py-1.5 text-xs text-on-surface"
              title={t.name}
            >
              {t.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Header({ onToggleSidebar, onAddBooking }) {
  const { tripMetas } = useTripContext();
  const pathname = usePathname();
  const sectionTitle = SECTION_TITLES[pathname];
  // 0 selected = the All Trips view; 1 = its name; 2+ = a compact count chip.
  const tripLabel =
    tripMetas.length === 0 ? "All trips" : tripMetas[0]?.name;
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
        {tripMetas.length >= 2 ? (
          <TripChip tripMetas={tripMetas} />
        ) : (
          <span className="text-xs font-medium bg-primary-light text-accent-ink px-3 py-1 rounded-full truncate max-w-[45vw]">
            {tripLabel}
          </span>
        )}
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
