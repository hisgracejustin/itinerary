"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "../actions/auth";
import { hrefWithTrips } from "../lib/trip-params";

const BOOKING_TYPES = [
  { id: "flight", label: "Flights", color: "bg-flight", icon: "✈️" },
  { id: "train", label: "Trains", color: "bg-train", icon: "🚂" },
  { id: "bus", label: "Buses", color: "bg-bus", icon: "🚌" },
  { id: "rental", label: "Rentals", color: "bg-rental", icon: "🚗" },
  { id: "cruise", label: "Cruises", color: "bg-cruise", icon: "🚢" },
  { id: "hotel", label: "Accomm", color: "bg-hotel", icon: "🏡" },
  { id: "activity", label: "Activities", color: "bg-activity", icon: "🎯" },
];

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";

export default function Sidebar({ user, trips, selectedTrips: selectedTripsProp, onNavigate }) {
  const pathname = usePathname();
  // Default in the body, not the signature: a `= []` default narrows the prop to
  // never[] at the .tsx call site (same reason as the Todos screen).
  const selectedTrips = selectedTripsProp ?? [];
  const selectedSet = new Set(selectedTrips);

  // The other nav links carry the whole current selection along.
  const navHref = (path) => hrefWithTrips(path, selectedTrips);

  // Clicking anywhere on a trip row toggles it in/out of the selection — the
  // checkbox is a state indicator, not a separate control. (Shipped first as
  // row = "only this trip" + checkbox = toggle; the split behavior proved
  // surprising in use.) "All Trips" clears the selection.
  //
  // Selection changes are plain <a> anchors, NOT next/link: Next 16's client
  // router can commit a stale RSC payload when a navigation changes only the
  // search params, and even router.refresh() then refetches with the stale
  // params (vercel/next.js#88535, #92187). A full document navigation is the
  // only path that reliably renders the new selection; these pages are
  // force-dynamic anyway.
  const toggledHref = (tripId) =>
    hrefWithTrips(
      pathname,
      selectedSet.has(tripId)
        ? selectedTrips.filter((id) => id !== tripId)
        : trips.filter((t) => selectedSet.has(t.id) || t.id === tripId).map((t) => t.id),
    );

  const tripRowClass = (active) =>
    `flex items-center rounded-full text-sm transition-all duration-150 ${
      active
        ? "bg-primary-light text-primary font-medium"
        : "text-on-surface hover:bg-surface-container"
    }`;

  return (
    <aside className="w-full h-full overflow-y-auto shrink-0 bg-white border-r border-outline/40 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {/* Navigation */}
      <nav className="p-3 pt-4">
        <NavItem
          to={navHref("/")}
          active={pathname === "/"}
          onClick={onNavigate}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
          label="Calendar"
        />
        <NavItem
          to={navHref("/todos")}
          active={pathname === "/todos"}
          onClick={onNavigate}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          }
          label="To-dos"
        />
        <NavItem
          to={navHref("/costs")}
          active={pathname === "/costs"}
          onClick={onNavigate}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          label="Costs"
        />
        <NavItem
          to={navHref("/settings")}
          active={pathname === "/settings"}
          onClick={onNavigate}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
          label="Settings"
        />
      </nav>

      <div className="mx-4 border-t border-outline/40" />

      {/* Trips */}
      <div className="p-3">
        <div className="flex items-center justify-between px-3 py-2">
          <h2 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Trips</h2>
          {/* Creating/editing trips lives in Settings — the sidebar just selects. */}
          <Link
            href="/settings"
            onClick={onNavigate}
            className="text-xs text-primary hover:text-primary/80 font-medium"
          >
            Manage
          </Link>
        </div>
        {selectedTrips.length > 0 && (
          <div className="flex items-center justify-between px-3 pb-1.5 text-[11px] text-on-surface-variant">
            <span>{selectedTrips.length} trip{selectedTrips.length === 1 ? "" : "s"} selected</span>
            <a
              href={hrefWithTrips(pathname, [])}
              onClick={onNavigate}
              className="text-primary hover:text-primary/80 font-medium"
            >
              Clear
            </a>
          </div>
        )}
        <ul className="space-y-0.5">
          <li>
            <a
              href={hrefWithTrips(pathname, [])}
              onClick={onNavigate}
              className={`block w-full text-left px-3 py-2 ${tripRowClass(selectedTrips.length === 0)}`}
            >
              All Trips
            </a>
          </li>
          {trips.map((trip) => {
            const active = selectedSet.has(trip.id);
            return (
              <li key={trip.id}>
                <a
                  href={toggledHref(trip.id)}
                  onClick={onNavigate}
                  aria-label={`${active ? "Remove" : "Add"} ${trip.name}`}
                  className={tripRowClass(active)}
                >
                  <span className="shrink-0 w-10 h-10 flex items-center justify-center">
                    <span
                      className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                        active ? "bg-primary border-primary text-white" : "border-outline/60 text-transparent"
                      }`}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </span>
                  <span className="flex-1 min-w-0 truncate pr-3 py-2">{trip.name}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mx-4 border-t border-outline/40" />

      {/* Booking Types */}
      <div className="p-3">
        <h2 className="px-3 py-2 text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Booking Types</h2>
        <ul className="space-y-0.5">
          {BOOKING_TYPES.map(({ id, label, icon }) => {
            const isActive = pathname === `/bookings/${id}`;
            return (
              <li key={id}>
                <Link
                  href={navHref(`/bookings/${id}`)}
                  onClick={onNavigate}
                  className={`flex items-center gap-3 px-3 py-2 rounded-full text-sm transition-all duration-150 ${
                    isActive
                      ? "bg-primary-light text-primary font-medium"
                      : "text-on-surface hover:bg-surface-container"
                  }`}
                >
                  <span className="text-base">{icon}</span>
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {/* User + Version */}
      <div className="mt-auto p-3 px-4 space-y-2">
        {user && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-on-surface-variant truncate max-w-[160px]">{user.email}</span>
            <button
              onClick={() => signOutAction()}
              className="text-[10px] text-on-surface-variant/60 hover:text-red-500 transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-on-surface-variant/50">v{APP_VERSION}</span>
          <button
            onClick={async () => {
              const regs = await navigator.serviceWorker?.getRegistrations();
              if (regs) await Promise.all(regs.map((r) => r.unregister()));
              if ("caches" in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map((k) => caches.delete(k)));
              }
              window.location.reload();
            }}
            className="text-on-surface-variant/40 hover:text-primary transition-colors"
            title="Check for updates"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}

function NavItem({ to, active, onClick, icon, label }) {
  return (
    <Link
      href={to}
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-full text-sm transition-all duration-150 mb-0.5 ${
        active
          ? "bg-primary-light text-primary font-medium"
          : "text-on-surface hover:bg-surface-container"
      }`}
    >
      <span className={active ? "text-primary" : "text-on-surface-variant"}>{icon}</span>
      {label}
    </Link>
  );
}
