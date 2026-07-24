import { after } from "next/server";
import { requirePageUser } from "@/lib/page-auth";
import { getTripsWithMembers } from "@/lib/queries";
import { getLatestFxRates, refreshFxRatesIfStale } from "@/lib/fx";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sessionUser = await requirePageUser();
  // Members ride along on each trip so member pickers (to-do assignees, and
  // later cost splitting) can filter client-side without extra queries.
  const [trips, fx] = await Promise.all([
    getTripsWithMembers(sessionUser.id),
    getLatestFxRates(),
  ]);

  // Refresh live FX rates AFTER the response is sent — the page load must never
  // await the external Frankfurter fetch. refreshFxRatesIfStale() no-ops when
  // the cache is fresh and never throws.
  after(() => refreshFxRatesIfStale());

  const user = {
    email: sessionUser.email ?? "",
    name: sessionUser.name ?? null,
  };

  return (
    <AppShell user={user} trips={trips} fx={fx}>
      {children}
    </AppShell>
  );
}
