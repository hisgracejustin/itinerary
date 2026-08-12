import { requirePageUser } from "@/lib/page-auth";
import { getBookingsForUser } from "@/lib/queries";
import Refund from "@/screens/Refund";

export const dynamic = "force-dynamic";

// Union fetch; the screen filters by the client-side trip selection. Expenses
// aren't fetched at all — there is nothing to cancel on an ad-hoc cost.
export default async function RefundRoute() {
  const user = await requirePageUser();
  const bookings = await getBookingsForUser(user.id, null);
  return <Refund bookings={bookings} currentUserId={user.id} />;
}
