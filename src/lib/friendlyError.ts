import type { ActionResult } from "./action-utils";

const RLS_PATTERN = /row-level security|violates.*policy|forbidden/i;

export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (RLS_PATTERN.test(msg)) {
    return "You don't have permission to make changes to this trip";
  }
  return msg;
}

/** Unwrap a Server Action result: return the data or throw a friendly error. */
export function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(friendlyError(new Error(result.error)));
  return result.data as T;
}
