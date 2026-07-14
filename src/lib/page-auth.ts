import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { dbReady } from "@/db";

/**
 * Resolve the signed-in user inside an RSC page/layout. Redirects to /login if
 * there's no session (the `(app)` layout already gates, but each page renders
 * independently and needs the id for userId-scoped queries). Applies pending
 * migrations once per process before any query, same as `requireUser()`.
 */
export async function requirePageUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  await dbReady();
  return session.user as typeof session.user & { id: string };
}
