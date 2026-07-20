import { requirePageUser } from "@/lib/page-auth";
import { getAssignableUsers, getTodosForUser } from "@/lib/queries";
import Todos from "@/screens/Todos";

export const dynamic = "force-dynamic";

export default async function TodosRoute({
  searchParams,
}: {
  searchParams: Promise<{ trip?: string }>;
}) {
  const { trip } = await searchParams;
  const user = await requirePageUser();
  const [todos, members] = await Promise.all([
    getTodosForUser(user.id, trip ?? null),
    getAssignableUsers(user.id, trip ?? null),
  ]);
  return (
    <Todos
      key={trip ?? "all"}
      initialTodos={todos}
      members={members}
      currentUserId={user.id}
    />
  );
}
