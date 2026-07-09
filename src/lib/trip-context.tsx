"use client";

import { createContext, useContext, type MutableRefObject } from "react";
import type { Trip } from "@/db/schema";

export type TripContextValue = {
  selectedTrip: string | null;
  tripMeta: Trip | null;
  /** Calendar registers its "open add booking" handler here; Header calls it. */
  onOpenAdd: MutableRefObject<(() => void) | null>;
};

export const TripContext = createContext<TripContextValue | null>(null);

export function useTripContext(): TripContextValue {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error("useTripContext must be used within AppShell");
  return ctx;
}
