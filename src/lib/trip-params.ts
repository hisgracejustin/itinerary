/**
 * Trip selection travels in the URL as repeated `?trip=a&trip=b` params. Next's
 * RSC `searchParams` collapses a single occurrence to a string and repeats to a
 * string[], so every page normalizes through here.
 */

/** Normalize the raw `trip` searchParam to a clean id array, or null for "All Trips". */
export function parseTripParam(trip?: string | string[]): string[] | null {
  if (!trip) return null;
  const arr = (Array.isArray(trip) ? trip : [trip]).filter(Boolean);
  return arr.length ? arr : null;
}

/**
 * Stable remount key for a screen given its selected trips: order-independent so
 * `?trip=a&trip=b` and `?trip=b&trip=a` don't needlessly remount.
 */
export function tripKey(ids: string[] | null): string {
  return ids && ids.length ? [...ids].sort().join("+") : "all";
}

/** Build a path carrying the selected trips as repeated `?trip=` params. */
export function hrefWithTrips(path: string, tripIds: string[]): string {
  if (tripIds.length === 0) return path;
  const qs = tripIds.map((id) => `trip=${encodeURIComponent(id)}`).join("&");
  return `${path}?${qs}`;
}
