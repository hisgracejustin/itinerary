"use client";

import { useEffect, useRef, useState } from "react";
import Header from "./Header";
import Sidebar from "./Sidebar";
import { useTripMeta } from "@/hooks/useBookings";
import { TripContext } from "@/lib/trip-context";

type Props = {
  user: { email: string; name: string | null };
  children: React.ReactNode;
};

export function AppShell({ user, children }: Props) {
  const [selectedTrip, setSelectedTrip] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const onOpenAdd = useRef<(() => void) | null>(null);
  const { tripMeta } = useTripMeta(selectedTrip);

  // Collapse the sidebar on small screens (client-only; guards SSR).
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 768) setSidebarOpen(false);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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
          selectedTrip={selectedTrip}
          onSelectTrip={(trip: string | null) => {
            setSelectedTrip(trip);
            if (window.innerWidth < 768) setSidebarOpen(false);
          }}
          onNavigate={() => {
            if (window.innerWidth < 768) setSidebarOpen(false);
          }}
        />
      </div>
      {/* Right: header + content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onAddBooking={() => onOpenAdd.current?.()}
        />
        <main className="flex-1 overflow-auto bg-surface-dim p-3 sm:p-5">
          <TripContext.Provider value={{ selectedTrip, tripMeta, onOpenAdd }}>
            {children}
          </TripContext.Provider>
        </main>
      </div>
    </div>
  );
}
