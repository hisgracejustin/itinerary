import { requirePageUser } from "@/lib/page-auth";
import { getBookingsForUser } from "@/lib/queries";
import { parseTripParam, tripKey } from "@/lib/trip-params";
import BookingsByType from "@/screens/BookingsByType";

export const dynamic = "force-dynamic";

export default async function BookingsByTypeRoute({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ trip?: string | string[] }>;
}) {
  const { type } = await params;
  const { trip } = await searchParams;
  const tripIds = parseTripParam(trip);
  const user = await requirePageUser();
  const bookings = await getBookingsForUser(user.id, tripIds);
  return <BookingsByType key={`${type}-${tripKey(tripIds)}`} type={type} bookings={bookings} />;
}
