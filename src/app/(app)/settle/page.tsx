import { requirePageUser } from "@/lib/page-auth";
import { getSettleData } from "@/lib/queries";
import Settle from "@/screens/Settle";

export const dynamic = "force-dynamic";

// Union fetch across every accessible trip; the screen filters by the
// client-side trip selection and recomputes balances, so toggling trips
// re-settles instantly.
export default async function SettleRoute() {
  const user = await requirePageUser();
  const data = await getSettleData(user.id);
  return (
    <Settle
      members={data.members}
      parties={data.parties}
      bookings={data.bookings}
      expenses={data.expenses}
      settlements={data.settlements}
      currentUserId={user.id}
    />
  );
}
