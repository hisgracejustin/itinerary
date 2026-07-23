"use client";

import { createContext, useContext } from "react";

/** The trip fields the shell + screens actually read (matches getTripsForUser). */
export type TripSummary = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
};

export type TripContextValue = {
  /** All selected trip ids (the `?trip=` params), in the trips list's order. */
  selectedTrips: string[];
  /** The selected trips' summaries, same order as `selectedTrips`. */
  tripMetas: TripSummary[];
  /** Earliest start / latest end across the selected trips (the journey span). */
  spanStart: string | null;
  spanEnd: string | null;
  /** All the user's trips (from the layout) — for pickers that need the full list. */
  trips: TripSummary[];

  /**
   * Compatibility shims for screens that still think in terms of one trip
   * (Costs, BookingsByType, BookingForm, BookingModal). They resolve to the
   * single selection when exactly one trip is selected, and null otherwise —
   * so a multi-selection reads as "All Trips" to those screens.
   */
  selectedTrip: string | null;
  tripMeta: TripSummary | null;
};

export const TripContext = createContext<TripContextValue | null>(null);

export function useTripContext(): TripContextValue {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error("useTripContext must be used within AppShell");
  return ctx;
}
