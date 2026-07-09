"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTrips } from "../hooks/useBookings";
import { createTripAction } from "@/actions/bookings";
import { unwrap } from "@/lib/friendlyError";
import { signOutAction } from "../actions/auth";

const createTrip = async (input) => unwrap(await createTripAction(input));

const BOOKING_TYPES = [
  { id: "flight", label: "Flights", color: "bg-flight", icon: "✈️" },
  { id: "train", label: "Trains", color: "bg-train", icon: "🚂" },
  { id: "bus", label: "Buses", color: "bg-bus", icon: "🚌" },
  { id: "cruise", label: "Cruises", color: "bg-cruise", icon: "🚢" },
  { id: "hotel", label: "Accomm", color: "bg-hotel", icon: "🏡" },
  { id: "activity", label: "Activities", color: "bg-activity", icon: "🎯" },
];

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";

export default function Sidebar({ user, selectedTrip, onSelectTrip, onNavigate }) {
  const { trips, loading, refetch } = useTrips();
  const pathname = usePathname();
  const [showAddTrip, setShowAddTrip] = useState(false);
  const [newTrip, setNewTrip] = useState({ name: "", start_date: "", end_date: "" });
  const [saving, setSaving] = useState(false);

  const handleAddTrip = async (e) => {
    e.preventDefault();
    if (!newTrip.name.trim() || !newTrip.start_date || !newTrip.end_date) return;
    setSaving(true);
    try {
      await createTrip(newTrip);
      await refetch();
      setNewTrip({ name: "", start_date: "", end_date: "" });
      setShowAddTrip(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="w-72 bg-white h-full overflow-y-auto shrink-0 border-r border-outline/40 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {/* Navigation */}
      <nav className="p-3 pt-4">
        <NavItem
          to="/"
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
          to="/todos"
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
          to="/costs"
          active={pathname === "/costs"}
          onClick={onNavigate}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          label="Costs"
        />
      </nav>

      <div className="mx-4 border-t border-outline/40" />

      {/* Trips */}
      <div className="p-3">
        <div className="flex items-center justify-between px-3 py-2">
          <h2 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider">Trips</h2>
          <button
            onClick={() => setShowAddTrip(!showAddTrip)}
            className="text-xs text-primary hover:text-primary/80 font-medium"
          >
            {showAddTrip ? "Cancel" : "+ Add"}
          </button>
        </div>
        {showAddTrip && (
          <form onSubmit={handleAddTrip} className="px-3 pb-3 space-y-2">
            <input
              type="text"
              placeholder="Trip name"
              value={newTrip.name}
              onChange={(e) => setNewTrip({ ...newTrip, name: e.target.value })}
              className="mat-input text-sm w-full"
            />
            <div className="flex flex-col gap-1.5">
              <div>
                <label className="text-[10px] text-on-surface-variant font-medium uppercase tracking-wide block mb-0.5">Start</label>
                <input
                  type="date"
                  value={newTrip.start_date}
                  onChange={(e) => setNewTrip({ ...newTrip, start_date: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary h-9 appearance-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-on-surface-variant font-medium uppercase tracking-wide block mb-0.5">End</label>
                <input
                  type="date"
                  value={newTrip.end_date}
                  onChange={(e) => setNewTrip({ ...newTrip, end_date: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary h-9 appearance-none"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full py-1.5 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Creating..." : "Create Trip"}
            </button>
          </form>
        )}
        {loading ? (
          <p className="text-xs text-gray-400 px-3 py-2">Loading...</p>
        ) : (
          <ul className="space-y-0.5">
            <li>
              <button
                onClick={() => onSelectTrip(null)}
                className={`w-full text-left px-3 py-2 rounded-full text-sm transition-all duration-150 ${
                  !selectedTrip
                    ? "bg-primary-light text-primary font-medium"
                    : "text-on-surface hover:bg-surface-container"
                }`}
              >
                All Trips
              </button>
            </li>
            {trips.map((trip) => {
              const isActive = selectedTrip === trip.id;
              return (
                <li key={trip.id}>
                  <button
                    onClick={() => onSelectTrip(trip.id)}
                    className={`w-full text-left px-3 py-2 rounded-full text-sm transition-all duration-150 ${
                      isActive
                        ? "bg-primary-light text-primary font-medium"
                        : "text-on-surface hover:bg-surface-container"
                    }`}
                  >
                    {trip.name}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
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
                  href={`/bookings/${id}`}
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
