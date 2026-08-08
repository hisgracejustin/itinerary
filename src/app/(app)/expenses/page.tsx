import { requirePageUser } from "@/lib/page-auth";
import { getExpensesForUser } from "@/lib/queries";
import Expenses from "@/screens/Expenses";

export const dynamic = "force-dynamic";

export default async function ExpensesRoute() {
  const user = await requirePageUser();
  const expenses = await getExpensesForUser(user.id, null);
  return <Expenses expenses={expenses} />;
}
