import { requirePageUser } from "@/lib/page-auth";
import { getTripsWithMembers } from "@/lib/queries";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sessionUser = await requirePageUser();
  // Members ride along on each trip so member pickers (to-do assignees, and
  // later cost splitting) can filter client-side without extra queries.
  const trips = await getTripsWithMembers(sessionUser.id);

  const user = {
    email: sessionUser.email ?? "",
    name: sessionUser.name ?? null,
  };

  return (
    <AppShell user={user} trips={trips}>
      {children}
    </AppShell>
  );
}
