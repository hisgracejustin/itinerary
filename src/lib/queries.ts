import { and, asc, eq, getTableColumns, inArray, isNotNull, isNull, or } from "drizzle-orm";
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

// Each todo carries its assignee's display fields (flattened, snake_case to
// match the rest of the row shape) so the list renders avatars/names without a
// second query or a client-side user lookup. Null across the board = unassigned.
const assigneeCols = {
  assignee_name: tables.users.name,
  assignee_email: tables.users.email,
  assignee_image: tables.users.image,
};

/** Todos for one trip, or (tripless + every accessible trip) when `tripId` is null. */
export function getTodosForUser(userId: string, tripId?: string | null) {
  if (tripId) {
    return db
      .select({ ...todoCols, ...assigneeCols })
      .from(tables.todos)
      .innerJoin(
        tables.tripMembers,
        and(
          eq(tables.tripMembers.trip_id, tables.todos.trip_id),
          eq(tables.tripMembers.user_id, userId),
        ),
      )
      .leftJoin(tables.users, eq(tables.users.id, tables.todos.assignee_id))
      .where(eq(tables.todos.trip_id, tripId))
      .orderBy(asc(tables.todos.position), asc(tables.todos.created_at));
  }
  // Tripless todos plus todos of any trip the user belongs to. LEFT JOIN so
  // tripless rows survive; the WHERE keeps tripless OR matched-membership rows.
  return db
    .select({ ...todoCols, ...assigneeCols })
    .from(tables.todos)
    .leftJoin(
      tables.tripMembers,
      and(
        eq(tables.tripMembers.trip_id, tables.todos.trip_id),
        eq(tables.tripMembers.user_id, userId),
      ),
    )
    .leftJoin(tables.users, eq(tables.users.id, tables.todos.assignee_id))
    .where(or(isNull(tables.todos.trip_id), isNotNull(tables.tripMembers.user_id)))
    .orderBy(asc(tables.todos.position), asc(tables.todos.created_at));
}

/**
 * Every trip the user belongs to, each with its full member list and the user's
 * own role on it — the Settings screen's data. One membership query plus one
 * member/user join, stitched in memory rather than N queries per trip.
 */
export async function getTripsWithMembers(userId: string) {
  const trips = await getTripsForUser(userId);
  if (trips.length === 0) return [];

  const rows = await db
    .select({
      trip_id: tables.tripMembers.trip_id,
      role: tables.tripMembers.role,
      id: tables.users.id,
      name: tables.users.name,
      email: tables.users.email,
      image: tables.users.image,
    })
    .from(tables.tripMembers)
    .innerJoin(tables.users, eq(tables.users.id, tables.tripMembers.user_id))
    .where(
      inArray(
        tables.tripMembers.trip_id,
        trips.map((t) => t.id),
      ),
    )
    .orderBy(asc(tables.users.name), asc(tables.users.email));

  const byTrip = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byTrip.get(r.trip_id) ?? [];
    list.push(r);
    byTrip.set(r.trip_id, list);
  }

  return trips.map((trip) => {
    const members = (byTrip.get(trip.id) ?? []).map(({ trip_id: _t, ...m }) => m);
    return {
      ...trip,
      members,
      myRole: members.find((m) => m.id === userId)?.role ?? null,
    };
  });
}

/**
 * People a to-do can be assigned to, mirroring `requireAssignable`:
 *  - a specific trip → its members.
 *  - no trip selected → everyone the user shares any trip with (themselves
 *    included), deduped, since tripless to-dos aren't scoped to one trip.
 */
export async function getAssignableUsers(userId: string, tripId?: string | null) {
  if (tripId) {
    return db
      .select({
        id: tables.users.id,
        name: tables.users.name,
        email: tables.users.email,
        image: tables.users.image,
        role: tables.tripMembers.role,
      })
      .from(tables.tripMembers)
      .innerJoin(tables.users, eq(tables.users.id, tables.tripMembers.user_id))
      .where(eq(tables.tripMembers.trip_id, tripId))
      .orderBy(asc(tables.users.name), asc(tables.users.email));
  }

  const mine = db
    .select({ trip_id: tables.tripMembers.trip_id })
    .from(tables.tripMembers)
    .where(eq(tables.tripMembers.user_id, userId));

  const rows = await db
    .selectDistinct({
      id: tables.users.id,
      name: tables.users.name,
      email: tables.users.email,
      image: tables.users.image,
    })
    .from(tables.tripMembers)
    .innerJoin(tables.users, eq(tables.users.id, tables.tripMembers.user_id))
    .where(inArray(tables.tripMembers.trip_id, mine))
    .orderBy(asc(tables.users.name), asc(tables.users.email));

  // The user always belongs in the list even with no trips yet.
  if (rows.some((r) => r.id === userId)) return rows;
  const [self] = await db
    .select({
      id: tables.users.id,
      name: tables.users.name,
      email: tables.users.email,
      image: tables.users.image,
    })
    .from(tables.users)
    .where(eq(tables.users.id, userId))
    .limit(1);
  return self ? [self, ...rows] : rows;
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

const dayReminderCols = getTableColumns(tables.dayReminders);

/** Per-day reminders, ordered by date then manual position, then insertion. */
export function getDayRemindersForUser(userId: string, tripId?: string | null) {
  const order = [
    asc(tables.dayReminders.date),
    asc(tables.dayReminders.position),
    asc(tables.dayReminders.created_at),
  ];
  if (tripId) {
    return db
      .select(dayReminderCols)
      .from(tables.dayReminders)
      .innerJoin(
        tables.tripMembers,
        and(
          eq(tables.tripMembers.trip_id, tables.dayReminders.trip_id),
          eq(tables.tripMembers.user_id, userId),
        ),
      )
      .where(eq(tables.dayReminders.trip_id, tripId))
      .orderBy(...order);
  }
  return db
    .select(dayReminderCols)
    .from(tables.dayReminders)
    .leftJoin(
      tables.tripMembers,
      and(
        eq(tables.tripMembers.trip_id, tables.dayReminders.trip_id),
        eq(tables.tripMembers.user_id, userId),
      ),
    )
    .where(or(isNull(tables.dayReminders.trip_id), isNotNull(tables.tripMembers.user_id)))
    .orderBy(...order);
}
