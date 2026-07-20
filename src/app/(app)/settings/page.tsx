import { requirePageUser } from "@/lib/page-auth";
import { getTripsWithMembers } from "@/lib/queries";
import Settings from "@/screens/Settings";

export const dynamic = "force-dynamic";

export default async function SettingsRoute() {
  const user = await requirePageUser();
  const trips = await getTripsWithMembers(user.id);
  return <Settings trips={trips} currentUserId={user.id} />;
}
