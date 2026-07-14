"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Header from "./Header";
import Sidebar from "./Sidebar";
import { TripContext, type TripSummary } from "@/lib/trip-context";

type Props = {
  user: { email: string; name: string | null };
  trips: TripSummary[];
  children: React.ReactNode;
};

export function AppShell({ user, trips, children }: Props) {
  // Selected trip lives in the URL (?trip=<id>) so RSC pages can read it and
  // fetch server-side; the shell just reflects it. tripMeta is derived from the
  // already-fetched trips list — no extra query.
  const router = useRouter();
  const pathname = usePathname();
  const selectedTrip = useSearchParams().get("trip");
  const tripMeta = useMemo(
    () => trips.find((t) => t.id === selectedTrip) ?? null,
    [trips, selectedTrip],
  );

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const onOpenAdd = useRef<(() => void) | null>(null);

  // A ?trip= that isn't one of the user's trips (revoked access, stale/shared
  // link) would otherwise show an empty, chip-less dead end — fall back to All
  // Trips instead.
  useEffect(() => {
    if (selectedTrip && !tripMeta) router.replace(pathname);
  }, [selectedTrip, tripMeta, pathname, router]);

  // Collapse the sidebar on small screens (client-only; guards SSR).
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 768) setSidebarOpen(false);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const closeOnMobile = () => {
    if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false);
  };

  return (
    <div className="fixed inset-0 flex flex-row bg-surface-dim pb-[env(safe-area-inset-bottom)]">
      {/* Mobile overlay */}
      <div
        className={`fixed inset-0 bg-black/40 z-20 md:hidden transition-opacity duration-300 ease-material ${
          sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setSidebarOpen(false)}
      />
      {/* Sidebar */}
      <div
        className={`fixed md:relative z-30 inset-y-0 left-0 md:inset-auto md:h-full transition-all duration-300 ease-material ${
          sidebarOpen
            ? "translate-x-0"
            : "-translate-x-full md:-translate-x-full md:w-0 md:overflow-hidden"
        }`}
      >
        <Sidebar
          user={user}
          trips={trips}
          selectedTrip={selectedTrip}
          onNavigate={closeOnMobile}
        />
      </div>
      {/* Right: header + content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onAddBooking={() => onOpenAdd.current?.()}
        />
        <main className="flex-1 overflow-auto bg-surface-dim p-3 sm:p-5">
          <TripContext.Provider value={{ selectedTrip, tripMeta, trips, onOpenAdd }}>
            {children}
          </TripContext.Provider>
        </main>
      </div>
    </div>
  );
}
