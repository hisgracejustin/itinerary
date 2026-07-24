"use client";

import { createContext, useContext } from "react";

/** A trip member as carried on TripSummary (matches getTripsWithMembers). */
export type TripMember = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: string;
  /** Settlement unit this member belongs to, or null when solo. */
  party_id: string | null;
  /** True if the member has ever signed in (≥1 row in the accounts table). */
  has_account: boolean;
};

/** A settlement unit (couple/group) on a trip. */
export type TripParty = {
  id: string;
  name: string;
};

/** The trip fields the shell + screens actually read (matches getTripsWithMembers). */
export type TripSummary = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  members: TripMember[];
  parties: TripParty[];
  myRole: string | null;
};

export type TripContextValue = {
  /**
   * Selected trip ids, in the trips list's order. Selection is pure client
   * state: pages always load the union of every accessible trip's data, and
   * screens filter it by this selection — so toggling a trip re-renders
   * instantly with no navigation. (This also sidesteps the Next 16 router
   * regression that made search-param navigations serve stale payloads —
   * vercel/next.js#88535, #92187.)
   */
  selectedTrips: string[];
  /** The selected trips' summaries, same order as `selectedTrips`. */
  tripMetas: TripSummary[];
  /** Earliest start / latest end across the selected trips (the journey span). */
  spanStart: string | null;
  spanEnd: string | null;
  /** All the user's trips (from the layout) — for pickers that need the full list. */
  trips: TripSummary[];

  /**
   * Live FX rates for the approximate ~HKD conversions (Costs/Settle only —
   * never settlement math). Fetched by the layout; `rates` maps currency →
   * "1 <ccy> = Y HKD". Empty `rates`/null `rateDate` means the cache is empty
   * and callers fall back to the static built-in table. `fetchedAt` may arrive
   * as a Date (server) — stringify/reparse at the display site.
   */
  fx: { rates: Record<string, number>; rateDate: string | null; fetchedAt: string | Date | null };

  /** Toggle one trip in/out of the selection. */
  toggleTrip: (tripId: string) => void;
  /** Replace the selection ([] = All Trips). Unknown ids are dropped. */
  setSelectedTrips: (tripIds: string[]) => void;

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
