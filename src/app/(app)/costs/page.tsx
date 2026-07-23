import { requirePageUser } from "@/lib/page-auth";
import { getBookingsForUser } from "@/lib/queries";
import { parseTripParam, tripKey } from "@/lib/trip-params";
import Costs from "@/screens/Costs";

export const dynamic = "force-dynamic";

export default async function CostsRoute({
  searchParams,
}: {
  searchParams: Promise<{ trip?: string | string[] }>;
}) {
  const { trip } = await searchParams;
  const tripIds = parseTripParam(trip);
  const user = await requirePageUser();
  const bookings = await getBookingsForUser(user.id, tripIds);
  return <Costs key={tripKey(tripIds)} bookings={bookings} />;
}
