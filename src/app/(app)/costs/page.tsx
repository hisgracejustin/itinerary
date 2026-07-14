import { requirePageUser } from "@/lib/page-auth";
import { getBookingsForUser } from "@/lib/queries";
import Costs from "@/screens/Costs";

export const dynamic = "force-dynamic";

export default async function CostsRoute({
  searchParams,
}: {
  searchParams: Promise<{ trip?: string }>;
}) {
  const { trip } = await searchParams;
  const user = await requirePageUser();
  const bookings = await getBookingsForUser(user.id, trip ?? null);
  return <Costs key={trip ?? "all"} bookings={bookings} />;
}
