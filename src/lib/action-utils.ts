import { auth } from "@/auth";
import { dbReady } from "@/db";
import { ZodError } from "zod";

export async function requireUser() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  await dbReady();
  return session.user;
}

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string };

/** Uniform action wrapper: auth, validation errors → friendly messages. */
export async function runAction<T = undefined>(
  fn: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    await requireUser();
    const data = await fn();
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
