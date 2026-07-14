import { auth } from "@/auth";
import { dbReady } from "@/db";
import { ZodError } from "zod";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  await dbReady();
  return session.user as typeof session.user & { id: string };
}

export type SessionUser = Awaited<ReturnType<typeof requireUser>>;

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string };

/**
 * Uniform action wrapper: resolves the user once, hands it to `fn`, and maps
 * validation errors → friendly messages. Actions no longer call `requireUser()`
 * themselves — they receive the resolved `user`.
 */
export async function runAction<T = undefined>(
  fn: (user: SessionUser) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const user = await requireUser();
    const data = await fn(user);
    return { ok: true, data } as ActionResult<T>;
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) throw err; // Next redirects
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return { ok: false, error: `${first.path.join(".")}: ${first.message}` };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}
