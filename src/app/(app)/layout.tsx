import { requirePageUser } from "@/lib/page-auth";
import { getTripsForUser } from "@/lib/queries";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sessionUser = await requirePageUser();
  const trips = await getTripsForUser(sessionUser.id);

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
