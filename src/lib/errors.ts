/**
 * An error whose message is written for the user and safe to show verbatim.
 * runAction returns AppError messages as-is; anything else (driver errors, bugs)
 * is logged server-side and replaced with a generic message plus a ref id, so a
 * stack trace or a connection string can never reach the browser.
 *
 * Lives here rather than in action-utils.ts because a "use server" module may
 * only export async functions — a class exported from one is a build error.
 */
export class AppError extends Error {}
