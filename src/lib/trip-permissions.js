export function isTripWritable(trip) {
  return trip?.myRole === "owner" || trip?.myRole === "editor";
}

/** Writable trips inside the active filter; [] selection means All Trips. */
export function writableTripsInSelection(trips = [], selectedTrips = []) {
  const selected = new Set(selectedTrips);
  return trips.filter(
    (trip) => isTripWritable(trip) && (selected.size === 0 || selected.has(trip.id)),
  );
}
