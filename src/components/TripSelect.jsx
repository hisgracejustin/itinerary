"use client";

export default function TripSelect({ trips = [], value, onChange, label = "Trip" }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-on-surface-variant uppercase tracking-wide block mb-1">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="mat-select w-full"
      >
        <option value="">Select a trip…</option>
        {trips.map((trip) => (
          <option key={trip.id} value={trip.id}>{trip.name}</option>
        ))}
      </select>
    </label>
  );
}
