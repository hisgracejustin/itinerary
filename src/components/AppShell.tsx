"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Header from "./Header";
import Sidebar from "./Sidebar";
import BookingModal from "./BookingModal";
import { createBooking, updateBooking, deleteBooking } from "@/lib/client-actions";
import { TripContext, type TripSummary } from "@/lib/trip-context";
import { parseTripParam } from "@/lib/trip-params";

type Props = {
  user: { email: string; name: string | null };
  trips: TripSummary[];
  fx: { rates: Record<string, number>; rateDate: string | null; fetchedAt: string | Date | null };
  children: React.ReactNode;
};

const MIN_SIDEBAR_WIDTH = 208;
const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SIDEBAR_WIDTH = 288; // matches the old w-72

export function AppShell({ user, trips, fx, children }: Props) {
  // Trip selection is pure client state: pages always load the union of every
  // accessible trip's data and screens filter it by this selection, so a
  // toggle is one instant React render — no navigation, no refetch. (Also the
  // reason: Next 16 serves stale payloads on search-param navigations,
  // vercel/next.js#88535/#92187, so selection can't live in the router.)
  //
  // ?trip= deep links still work: they seed the INITIAL state (read during
  // SSR, so the first paint is already filtered), get persisted, and the URL
  // is then cleaned up. With no deep link, the last selection is restored
  // from localStorage after hydration.
  const searchParams = useSearchParams();
  const [selectedTrips, setSelectedTripsState] = useState<string[]>(() => {
    const fromUrl = parseTripParam(searchParams.getAll("trip")) ?? [];
    return trips.filter((t) => fromUrl.includes(t.id)).map((t) => t.id);
  });
  const hadUrlSelection = useRef(selectedTrips.length > 0);

  const persistSelection = (ids: string[]) => {
    try {
      window.localStorage.setItem("selectedTrips", JSON.stringify(ids));
    } catch {
      /* storage unavailable — selection just won't survive a restart */
    }
  };
  const setSelectedTrips = useCallback(
    (ids: string[]) => {
      const valid = trips.filter((t) => ids.includes(t.id)).map((t) => t.id);
      setSelectedTripsState(valid);
      persistSelection(valid);
    },
    [trips],
  );
  const toggleTrip = useCallback(
    (tripId: string) => {
      setSelectedTripsState((prev) => {
        const next = prev.includes(tripId)
          ? prev.filter((id) => id !== tripId)
          : trips.filter((t) => prev.includes(t.id) || t.id === tripId).map((t) => t.id);
        persistSelection(next);
        return next;
      });
    },
    [trips],
  );

  // After hydration: restore the saved selection when no deep link seeded one,
  // and strip consumed params from the URL. (Plain history API — by this point
  // nothing reads the router's search params, so a stale re-commit is a no-op.)
  useEffect(() => {
    if (hadUrlSelection.current) {
      persistSelection(selectedTrips);
    } else {
      try {
        const saved: unknown = JSON.parse(window.localStorage.getItem("selectedTrips") ?? "[]");
        if (Array.isArray(saved) && saved.length) {
          const valid = trips.filter((t) => saved.includes(t.id)).map((t) => t.id);
          if (valid.length) setSelectedTripsState(valid);
        }
      } catch {
        /* bad/absent saved state — stay on All Trips */
      }
    }
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("trip") || url.searchParams.has("view")) {
        url.searchParams.delete("trip");
        url.searchParams.delete("view");
        window.history.replaceState(window.history.state, "", url);
      }
    } catch {
      /* leave the URL as-is */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only init
  }, []);

  const tripMetas = useMemo(
    () => trips.filter((t) => selectedTrips.includes(t.id)),
    [trips, selectedTrips],
  );
  const spanStart = useMemo(
    () => tripMetas.reduce<string | null>((min, t) => (!min || t.start_date < min ? t.start_date : min), null),
    [tripMetas],
  );
  const spanEnd = useMemo(
    () => tripMetas.reduce<string | null>((max, t) => (!max || t.end_date > max ? t.end_date : max), null),
    [tripMetas],
  );
  // Compatibility single-trip view for screens not yet multi-aware.
  const selectedTrip = selectedTrips.length === 1 ? selectedTrips[0] : null;
  const tripMeta = tripMetas.length === 1 ? tripMetas[0] : null;

  // On real document loads (first visit, refresh) the initial paint must
  // already be correct or the sidebar visibly animates open→closed on phones
  // and default→persisted width on desktop. Three pieces settle it motionless:
  //  - `sidebarOpen` starts null = "let CSS decide": the null classes render
  //    closed on mobile and open on md+, so the pre-hydration paint is right on
  //    both. Hydration then resolves it to a real boolean.
  //  - width initializes straight from localStorage (lazy, SSR-guarded).
  //  - transitions are disabled until after hydration (`hydrated` below).
  const [sidebarOpen, setSidebarOpen] = useState<boolean | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_SIDEBAR_WIDTH;
    const stored = Number(window.localStorage.getItem("sidebarWidth"));
    return stored >= MIN_SIDEBAR_WIDTH && stored <= MAX_SIDEBAR_WIDTH
      ? stored
      : DEFAULT_SIDEBAR_WIDTH;
  });
  const [hydrated, setHydrated] = useState(false);
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

  // Resolve the CSS-decided null to a real boolean, and enable layout
  // transitions only after hydration so the server-rendered defaults never
  // animate into the client state on load.
  useEffect(() => {
    setSidebarOpen((v) => v ?? window.innerWidth >= 768);
    setHydrated(true);
  }, []);

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
    <TripContext.Provider
      value={{ selectedTrips, tripMetas, spanStart, spanEnd, selectedTrip, tripMeta, trips, fx, toggleTrip, setSelectedTrips }}
    >
    <div className="fixed inset-0 flex flex-row bg-surface-dim pb-[env(safe-area-inset-bottom)]">
      {/* Mobile overlay */}
      <div
        className={`fixed inset-0 bg-black/40 z-20 md:hidden transition-opacity duration-300 ease-material ${
          sidebarOpen === true ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setSidebarOpen(false)}
      />
      {/* Sidebar. Width rides a CSS var so the null ("let CSS decide") state
          can be responsive: closed on mobile, open at the persisted width on
          md+. suppressHydrationWarning: the var is 288px in server HTML and the
          persisted width on the client — hydration patches it, deliberately. */}
      <div
        suppressHydrationWarning
        style={{ "--sbw": `${sidebarWidth}px` } as React.CSSProperties}
        className={`fixed md:relative z-30 inset-y-0 left-0 md:inset-auto md:h-full overflow-hidden ${
          hydrated && !resizing ? "transition-[width,transform] duration-300 ease-material" : ""
        } ${
          sidebarOpen === null
            ? "w-0 md:w-[var(--sbw)] -translate-x-full md:translate-x-0"
            : sidebarOpen
              ? "w-[var(--sbw)] translate-x-0"
              : "w-0 -translate-x-full md:translate-x-0"
        }`}
      >
        <Sidebar
          user={user}
          trips={trips}
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
        {/* flex-col so full-height screens (the To-dos board) can size themselves
            with flex-1 instead of a percentage height — h-full against a flex-item
            scroll container is exactly the chain Safari resolves inconsistently,
            which let the board's columns run past the viewport. */}
        <main className="flex-1 overflow-auto bg-surface-dim p-3 sm:p-5 flex flex-col">{children}</main>
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
