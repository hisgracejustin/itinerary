import { requirePageUser } from "@/lib/page-auth";
import { getBookingsForUser } from "@/lib/queries";
import BookingsByType from "@/screens/BookingsByType";

export const dynamic = "force-dynamic";

// Union fetch; the screen filters by the client-side trip selection.
export default async function BookingsByTypeRoute({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  const user = await requirePageUser();
  const bookings = await getBookingsForUser(user.id, null);
  return <BookingsByType key={type} type={type} bookings={bookings} />;
}
