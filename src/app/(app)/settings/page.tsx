import { isAdmin } from "@/lib/authz";
import { requirePageUser } from "@/lib/page-auth";
import { getAllPeopleForAdmin, getTripsWithMembers } from "@/lib/queries";
import Settings from "@/screens/Settings";

export const dynamic = "force-dynamic";

export default async function SettingsRoute() {
  const user = await requirePageUser();
  const admin = isAdmin(user);
  // Admins additionally see every account on the instance — including people who
  // signed in but were never added to a trip, who are invisible in the
  // trip-derived roster. Never fetched for anyone else.
  const [trips, allPeople] = await Promise.all([
    getTripsWithMembers(user.id),
    admin ? getAllPeopleForAdmin() : Promise.resolve(null),
  ]);
  return <Settings trips={trips} currentUserId={user.id} isAdmin={admin} allPeople={allPeople} />;
}
