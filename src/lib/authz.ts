import { and, eq, inArray } from "drizzle-orm";
import { db, tables } from "@/db";
import type { TripRole } from "@/db/schema";

const ALL_ROLES: TripRole[] = ["owner", "editor", "viewer"];
export const WRITE_ROLES: TripRole[] = ["owner", "editor"];

/**
 * Code replacement for the old Supabase RLS policies. Throws "Forbidden" unless
 * `userId` is a member of `tripId` with one of `roles`.
 *  - read  → any role (default)
 *  - write (booking/todo/day_note create/update/delete) → owner|editor
 *  - trip delete + member management → owner
 */
export async function requireTripAccess(
  userId: string,
  tripId: string,
  roles: TripRole[] = ALL_ROLES,
) {
  const rows = await db
    .select()
    .from(tables.tripMembers)
    .where(and(eq(tables.tripMembers.trip_id, tripId), eq(tables.tripMembers.user_id, userId)))
    .limit(1);
  const member = rows[0];
  if (!member || !roles.includes(member.role)) throw new Error("Forbidden");
  return member;
}

/**
 * Guard for to-do assignment. Throws unless `assigneeId` is a legitimate target:
 *  - null/undefined → unassigned, always allowed.
 *  - trip-bound to-do → the assignee must be a member of that trip.
 *  - tripless to-do (visible to everyone) → the assignee must be the actor
 *    themselves or someone they already share a trip with, so this can't be used
 *    to probe for or assign work to arbitrary accounts.
 */
export async function requireAssignable(
  actorId: string,
  assigneeId: string | null | undefined,
  tripId: string | null | undefined,
) {
  if (!assigneeId) return;

  if (tripId) {
    const rows = await db
      .select({ user_id: tables.tripMembers.user_id })
      .from(tables.tripMembers)
      .where(
        and(eq(tables.tripMembers.trip_id, tripId), eq(tables.tripMembers.user_id, assigneeId)),
      )
      .limit(1);
    if (!rows[0]) throw new Error("That person isn't a member of this trip");
    return;
  }

  if (assigneeId === actorId) return;
  const mine = await db
    .select({ trip_id: tables.tripMembers.trip_id })
    .from(tables.tripMembers)
    .where(eq(tables.tripMembers.user_id, actorId));
  const tripIds = mine.map((r) => r.trip_id);
  if (tripIds.length === 0) throw new Error("That person isn't on any of your trips");
  const shared = await db
    .select({ user_id: tables.tripMembers.user_id })
    .from(tables.tripMembers)
    .where(
      and(
        inArray(tables.tripMembers.trip_id, tripIds),
        eq(tables.tripMembers.user_id, assigneeId),
      ),
    )
    .limit(1);
  if (!shared[0]) throw new Error("That person isn't on any of your trips");
}

/**
 * Guard that every id in `userIds` is a member of `tripId`. The split/expense/
 * settlement write paths use this to reject a payer or split participant who
 * doesn't belong to the target trip (mirrors `requireAssignable`'s per-trip
 * membership check, batched via `inArray`). Null/undefined ids are ignored, so
 * callers can pass an optional payer alongside the split ids.
 */
export async function requireTripMembers(
  tripId: string,
  userIds: (string | null | undefined)[],
) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  const rows = await db
    .select({ user_id: tables.tripMembers.user_id })
    .from(tables.tripMembers)
    .where(
      and(eq(tables.tripMembers.trip_id, tripId), inArray(tables.tripMembers.user_id, ids)),
    );
  const found = new Set(rows.map((r) => r.user_id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) throw new Error("That person isn't a member of this trip");
}
