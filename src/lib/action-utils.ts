import { auth } from "@/auth";
import { dbReady } from "@/db";
import { AppError } from "./errors";
import { ZodError } from "zod";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new AppError("Unauthorized");
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
 *
 * Only AppError messages reach the client verbatim. Everything else is a bug or
 * a driver failure whose message may carry internals, so it's logged with a
 * short ref the user can quote and replaced with a generic line.
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
    if (err instanceof AppError) return { ok: false, error: err.message };
    const ref = crypto.randomUUID().slice(0, 8);
    console.error(`[action:${ref}]`, err);
    return { ok: false, error: `Something went wrong (ref ${ref})` };
  }
}
