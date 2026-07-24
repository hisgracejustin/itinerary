import { requirePageUser } from "@/lib/page-auth";
import { getAssignableUsers, getTodosForUser } from "@/lib/queries";
import Todos from "@/screens/Todos";

export const dynamic = "force-dynamic";

// Union fetch; the screen filters todos and the assignee roster by the
// client-side trip selection (trip members ride on TripContext).
export default async function TodosRoute() {
  const user = await requirePageUser();
  const [todos, members] = await Promise.all([
    getTodosForUser(user.id, null),
    getAssignableUsers(user.id, null),
  ]);
  return <Todos initialTodos={todos} members={members} currentUserId={user.id} />;
}
