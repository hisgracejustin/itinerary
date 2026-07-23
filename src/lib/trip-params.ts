/**
 * Trip selection travels in the URL as repeated `?trip=a&trip=b` params. Next's
 * RSC `searchParams` collapses a single occurrence to a string and repeats to a
 * string[], so every page normalizes through here.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalize the raw `trip` searchParam to a clean id array, or null for "All
 * Trips". Non-UUID junk is dropped here, not just client-side: trips.id is a
 * Postgres uuid column, so a malformed id would crash the server render with a
 * cast error before the AppShell URL cleanup ever runs.
 */
export function parseTripParam(trip?: string | string[]): string[] | null {
  if (!trip) return null;
  const arr = (Array.isArray(trip) ? trip : [trip]).filter((id) => UUID_RE.test(id));
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
