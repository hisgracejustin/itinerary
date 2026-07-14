import { and, asc, eq, getTableColumns, isNotNull, isNull, or } from "drizzle-orm";
import { db, tables } from "@/db";

/**
 * Read queries, userId-scoped. Authorization is folded INTO the data query via a
 * membership JOIN, so each read is a single DB round trip (the old code did a
 * separate `requireTripAccess` / `accessibleTripIds` SELECT first). A row comes
 * back only if the user is a member of its trip — a non-member simply sees an
 * empty result, which is the correct read-side behavior.
 *
 * These are pure (no `auth()` inside) so both RSC pages and Server Actions can
 * share them: the caller passes the already-resolved `userId`.
 */

const bookingCols = getTableColumns(tables.bookings);
const todoCols = getTableColumns(tables.todos);
const dayNoteCols = getTableColumns(tables.dayNotes);

/** Trips the user is a member of (the sidebar list; also carries each trip's dates). */
export function getTripsForUser(userId: string) {
  return db
    .select({
      id: tables.trips.id,
      name: tables.trips.name,
      start_date: tables.trips.start_date,
      end_date: tables.trips.end_date,
    })
    .from(tables.trips)
    .innerJoin(
      tables.tripMembers,
      and(eq(tables.tripMembers.trip_id, tables.trips.id), eq(tables.tripMembers.user_id, userId)),
    )
    .orderBy(asc(tables.trips.start_date));
}

/** A single trip the user can access, or null. */
export async function getTripForUser(userId: string, tripId: string) {
  const [trip] = await db
    .select(getTableColumns(tables.trips))
    .from(tables.trips)
    .innerJoin(
      tables.tripMembers,
      and(eq(tables.tripMembers.trip_id, tables.trips.id), eq(tables.tripMembers.user_id, userId)),
    )
    .where(eq(tables.trips.id, tripId))
    .limit(1);
  return trip ?? null;
}

/** Bookings for one trip, or across every accessible trip when `tripId` is null. */
export function getBookingsForUser(userId: string, tripId?: string | null) {
  const base = db
    .select(bookingCols)
    .from(tables.bookings)
    .innerJoin(
      tables.tripMembers,
      and(
        eq(tables.tripMembers.trip_id, tables.bookings.trip_id),
        eq(tables.tripMembers.user_id, userId),
      ),
    );
  if (tripId) {
    return base
      .where(eq(tables.bookings.trip_id, tripId))
      .orderBy(asc(tables.bookings.start_date));
  }
  return base.orderBy(asc(tables.bookings.start_date));
}

/** Todos for one trip, or (tripless + every accessible trip) when `tripId` is null. */
export function getTodosForUser(userId: string, tripId?: string | null) {
  if (tripId) {
    return db
      .select(todoCols)
      .from(tables.todos)
      .innerJoin(
        tables.tripMembers,
        and(
          eq(tables.tripMembers.trip_id, tables.todos.trip_id),
          eq(tables.tripMembers.user_id, userId),
        ),
      )
      .where(eq(tables.todos.trip_id, tripId))
      .orderBy(asc(tables.todos.due_date), asc(tables.todos.created_at));
  }
  // Tripless todos plus todos of any trip the user belongs to. LEFT JOIN so
  // tripless rows survive; the WHERE keeps tripless OR matched-membership rows.
  return db
    .select(todoCols)
    .from(tables.todos)
    .leftJoin(
      tables.tripMembers,
      and(
        eq(tables.tripMembers.trip_id, tables.todos.trip_id),
        eq(tables.tripMembers.user_id, userId),
      ),
    )
    .where(or(isNull(tables.todos.trip_id), isNotNull(tables.tripMembers.user_id)))
    .orderBy(asc(tables.todos.due_date), asc(tables.todos.created_at));
}

/** Day notes for one trip, or (tripless + every accessible trip) when `tripId` is null. */
export function getDayNotesForUser(userId: string, tripId?: string | null) {
  if (tripId) {
    return db
      .select(dayNoteCols)
      .from(tables.dayNotes)
      .innerJoin(
        tables.tripMembers,
        and(
          eq(tables.tripMembers.trip_id, tables.dayNotes.trip_id),
          eq(tables.tripMembers.user_id, userId),
        ),
      )
      .where(eq(tables.dayNotes.trip_id, tripId))
      .orderBy(asc(tables.dayNotes.date));
  }
  return db
    .select(dayNoteCols)
    .from(tables.dayNotes)
    .leftJoin(
      tables.tripMembers,
      and(
        eq(tables.tripMembers.trip_id, tables.dayNotes.trip_id),
        eq(tables.tripMembers.user_id, userId),
      ),
    )
    .where(or(isNull(tables.dayNotes.trip_id), isNotNull(tables.tripMembers.user_id)))
    .orderBy(asc(tables.dayNotes.date));
}
