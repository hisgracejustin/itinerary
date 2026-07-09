import { and, eq } from "drizzle-orm";
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

/** All trip ids the user can see (RLS `SELECT` equivalent). */
export async function accessibleTripIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ trip_id: tables.tripMembers.trip_id })
    .from(tables.tripMembers)
    .where(eq(tables.tripMembers.user_id, userId));
  return rows.map((r) => r.trip_id);
}
