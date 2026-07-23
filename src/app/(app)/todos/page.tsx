import { requirePageUser } from "@/lib/page-auth";
import { getAssignableUsers, getTodosForUser } from "@/lib/queries";
import { parseTripParam, tripKey } from "@/lib/trip-params";
import Todos from "@/screens/Todos";

export const dynamic = "force-dynamic";

export default async function TodosRoute({
  searchParams,
}: {
  searchParams: Promise<{ trip?: string | string[] }>;
}) {
  const { trip } = await searchParams;
  const tripIds = parseTripParam(trip);
  const user = await requirePageUser();
  const [todos, members] = await Promise.all([
    getTodosForUser(user.id, tripIds),
    getAssignableUsers(user.id, tripIds),
  ]);
  return (
    <Todos
      key={tripKey(tripIds)}
      initialTodos={todos}
      members={members}
      currentUserId={user.id}
    />
  );
}
