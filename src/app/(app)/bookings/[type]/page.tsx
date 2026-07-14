import { requirePageUser } from "@/lib/page-auth";
import { getBookingsForUser } from "@/lib/queries";
import BookingsByType from "@/screens/BookingsByType";

export const dynamic = "force-dynamic";

export default async function BookingsByTypeRoute({
  params,
  searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ trip?: string }>;
}) {
  const { type } = await params;
  const { trip } = await searchParams;
  const user = await requirePageUser();
  const bookings = await getBookingsForUser(user.id, trip ?? null);
  return <BookingsByType key={`${type}-${trip ?? "all"}`} type={type} bookings={bookings} />;
}
