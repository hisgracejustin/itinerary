import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/page-auth";
import { getBookingsForUser } from "@/lib/queries";
import { bookingTypeSchema } from "@/lib/schemas";
import BookingsByType from "@/screens/BookingsByType";

export const dynamic = "force-dynamic";

// Union fetch; the screen filters by the client-side trip selection.
export default async function BookingsByTypeRoute({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  // The segment reaches the screen as a raw string; anything outside the enum
  // would render an empty, permanently-broken type page.
  if (!bookingTypeSchema.safeParse(type).success) notFound();
  const user = await requirePageUser();
  const bookings = await getBookingsForUser(user.id, null);
  return <BookingsByType key={type} type={type} bookings={bookings} />;
}
