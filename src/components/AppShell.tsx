"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Header from "./Header";
import Sidebar from "./Sidebar";
import BookingModal from "./BookingModal";
import { createBooking, updateBooking, deleteBooking } from "@/lib/client-actions";
import { TripContext, type TripSummary } from "@/lib/trip-context";

type Props = {
  user: { email: string; name: string | null };
  trips: TripSummary[];
  children: React.ReactNode;
};

const MIN_SIDEBAR_WIDTH = 208;
const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SIDEBAR_WIDTH = 288; // matches the old w-72

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
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [resizing, setResizing] = useState(false);
  const resizingRef = useRef(false);
  // Keep the latest width available to the (stable) mouseup handler.
  const sidebarWidthRef = useRef(sidebarWidth);

  // "Add Booking" is a shell-level action so it works on every page (Calendar,
  // Todos, Costs, per-type lists) — not just wherever a screen happened to
  // register a handler. createBookingAction revalidates the layout, so the
  // active RSC page refreshes with the new booking on its own.
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  // Restore persisted sidebar width (client-only; guards SSR).
  useEffect(() => {
    const stored = Number(window.localStorage.getItem("sidebarWidth"));
    if (stored >= MIN_SIDEBAR_WIDTH && stored <= MAX_SIDEBAR_WIDTH) {
      setSidebarWidth(stored);
    }
  }, []);

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

  // Drag-to-resize the sidebar (desktop only). The handle sits at the sidebar's
  // right edge, so the pointer's clientX is the desired width.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const w = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX));
      setSidebarWidth(w);
    };
    const stop = () => {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      setResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.localStorage.setItem("sidebarWidth", String(sidebarWidthRef.current));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stop);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stop);
    };
  }, []);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    setResizing(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  const closeOnMobile = () => {
    if (typeof window !== "undefined" && window.innerWidth < 768) setSidebarOpen(false);
  };

  return (
    // The provider wraps the WHOLE shell, not just <main>: the Add Booking modal
    // below is rendered by the shell itself, and BookingForm calls
    // useTripContext() (which throws when there is no provider above it).
    <TripContext.Provider value={{ selectedTrip, tripMeta, trips }}>
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
        style={{ width: sidebarOpen ? sidebarWidth : 0 }}
        className={`fixed md:relative z-30 inset-y-0 left-0 md:inset-auto md:h-full overflow-hidden ${
          resizing ? "" : "transition-[width,transform] duration-300 ease-material"
        } ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <Sidebar
          user={user}
          trips={trips}
          selectedTrip={selectedTrip}
          onNavigate={closeOnMobile}
        />
        {/* Resize handle (desktop only) */}
        {sidebarOpen && (
          <div
            onMouseDown={startResize}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            className="hidden md:block absolute top-0 right-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-primary/30 active:bg-primary/50 transition-colors z-40"
          />
        )}
      </div>
      {/* Right: header + content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onAddBooking={() => setAddOpen(true)}
        />
        <main className="flex-1 overflow-auto bg-surface-dim p-3 sm:p-5">{children}</main>
      </div>

      {/* Global "Add Booking" modal — available on every page. */}
      {addOpen && (
        <BookingModal
          booking={null}
          selectedTrip={selectedTrip}
          tripName={tripMeta?.name}
          onClose={() => setAddOpen(false)}
          onSave={async (data: unknown, existingId: string | null) =>
            existingId ? await updateBooking(existingId, data) : await createBooking(data)
          }
          onDelete={async (id: string) => {
            await deleteBooking(id);
          }}
        />
      )}
    </div>
    </TripContext.Provider>
  );
}
