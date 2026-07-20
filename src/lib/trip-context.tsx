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
  selectedTrip: string | null;
  tripMeta: TripSummary | null;
  /** All the user's trips (from the layout) — for pickers that need the full list. */
  trips: TripSummary[];
};

export const TripContext = createContext<TripContextValue | null>(null);

export function useTripContext(): TripContextValue {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error("useTripContext must be used within AppShell");
  return ctx;
}
