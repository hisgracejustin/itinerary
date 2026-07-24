import { requirePageUser } from "@/lib/page-auth";
import { getBookingsForUser } from "@/lib/queries";
import Costs from "@/screens/Costs";

export const dynamic = "force-dynamic";

// Union fetch; the screen filters by the client-side trip selection.
export default async function CostsRoute() {
  const user = await requirePageUser();
  const bookings = await getBookingsForUser(user.id, null);
  return <Costs bookings={bookings} />;
}
