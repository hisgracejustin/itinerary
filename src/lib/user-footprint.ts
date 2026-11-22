import { eq, or } from "drizzle-orm";
import { db, tables, type Db } from "@/db";

// Server-only helpers shared by the member actions and invite redemption. Kept
// out of the "use server" action files on purpose: anything exported from one
// of those becomes callable from the browser.

/**
 * Everything pointing at this `users` row, named for a human. One probe per
 * table that references `users.id` with real content — the deliberate superset
 * of "would deleting this row lose or orphan anything?". Empty ⇒ the row is
 * hollow and can be absorbed or deleted outright.
 */
export async function userFootprint(userId: string, q: Db = db): Promise<string[]> {
  const probes: [string, Promise<unknown[]>][] = [
    [
      "a trip membership",
      q
        .select({ x: tables.tripMembers.user_id })
        .from(tables.tripMembers)
        .where(eq(tables.tripMembers.user_id, userId))
        .limit(1),
    ],
    [
      "booking splits",
      q
        .select({ x: tables.bookingSplits.user_id })
        .from(tables.bookingSplits)
        .where(eq(tables.bookingSplits.user_id, userId))
        .limit(1),
    ],
    [
      "expense splits",
      q
        .select({ x: tables.expenseSplits.user_id })
        .from(tables.expenseSplits)
        .where(eq(tables.expenseSplits.user_id, userId))
        .limit(1),
    ],
    [
      "bookings they paid for",
      q
        .select({ x: tables.bookings.id })
        .from(tables.bookings)
        .where(eq(tables.bookings.paid_by, userId))
        .limit(1),
    ],
    [
      "expenses they paid for",
      q
        .select({ x: tables.expenses.id })
        .from(tables.expenses)
        .where(eq(tables.expenses.paid_by, userId))
        .limit(1),
    ],
    [
      "settlements",
      q
        .select({ x: tables.settlements.id })
        .from(tables.settlements)
        .where(
          or(eq(tables.settlements.from_user, userId), eq(tables.settlements.to_user, userId)),
        )
        .limit(1),
    ],
    [
      "to-dos assigned to them",
      q
        .select({ x: tables.todos.id })
        .from(tables.todos)
        .where(eq(tables.todos.assignee_id, userId))
        .limit(1),
    ],
    [
      "uploaded attachments",
      q
        .select({ x: tables.bookingAttachments.id })
        .from(tables.bookingAttachments)
        .where(eq(tables.bookingAttachments.uploaded_by, userId))
        .limit(1),
    ],
  ];
  const results = await Promise.all(probes.map(([, q]) => q));
  return probes.filter((_, i) => results[i].length > 0).map(([label]) => label);
}

/**
 * Zero rows anywhere that would make this `users` row worth keeping? Signup is
 * open, so a person can sign in with their NEW address before an admin moves it
 * onto their real row, leaving a hollow duplicate that then blocks the edit.
 * Such a row is safe to absorb only if nothing at all points at it.
 */
export async function userHasFootprint(userId: string, q: Db = db) {
  return (await userFootprint(userId, q)).length > 0;
}
