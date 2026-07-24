const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalize raw `?trip=` values (repeated params) to a clean id array, or null
 * for none. Trip selection is client state (see TripContext) — the URL's only
 * remaining role is seeding the initial selection from a deep link. Non-UUID
 * junk is dropped so it can never reach a uuid column comparison.
 */
export function parseTripParam(trip?: string | string[] | null): string[] | null {
  if (!trip) return null;
  const arr = (Array.isArray(trip) ? trip : [trip]).filter((id) => UUID_RE.test(id));
  return arr.length ? arr : null;
}
